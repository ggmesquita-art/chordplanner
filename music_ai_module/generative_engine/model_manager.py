"""
Thread-safe singleton manager for MIDI-GPT InferenceEngine instances.
Prioritizes local HuggingFace cache checkpoints without requiring network access.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Dict, List, Optional

import huggingface_hub
from huggingface_hub.errors import (
    GatedRepoError,
    HfHubHTTPError,
    RepositoryNotFoundError,
)
import torch
from midigpt.inference.engine import InferenceEngine

from music_ai_module.config import settings
from music_ai_module.schemas import ModelDownloadResponse

logger = logging.getLogger(__name__)

KNOWN_MODEL_SPECS: Dict[str, dict] = {
    "expressive_medium": {
        "num_bars_map": [4, 8, 12, 16],
        "supports_velocity": True,
        "switchable_velocity": True,
        "supports_microtiming": True,
        "supports_genre": True,
    },
    "prism_medium": {
        "num_bars_map": [4, 8, 12, 16],
        "supports_velocity": True,
        "switchable_velocity": False,
        "supports_microtiming": False,
        "supports_genre": True,
    },
    "yellow_medium": {
        "num_bars_map": [4, 8],
        "supports_velocity": True,
        "switchable_velocity": False,
        "supports_microtiming": False,
        "supports_genre": False,
    },
    "yellow_small": {
        "num_bars_map": [4, 8],
        "supports_velocity": True,
        "switchable_velocity": False,
        "supports_microtiming": False,
        "supports_genre": False,
    },
}


class ModelManager:
    """
    Thread-safe singleton managing cached MIDI-GPT InferenceEngine instances.
    """

    _instance: Optional["ModelManager"] = None
    _instance_lock: threading.Lock = threading.Lock()

    def __new__(cls) -> "ModelManager":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    instance = super().__new__(cls)
                    instance._initialized = False
                    cls._instance = instance
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._lock = threading.RLock()
        self._engines: Dict[str, InferenceEngine] = {}
        self._device: str = "cuda" if torch.cuda.is_available() else "cpu"
        self._initialized = True

    @classmethod
    def get_instance(cls) -> "ModelManager":
        """Return the singleton ModelManager instance."""
        return cls()

    @property
    def device(self) -> str:
        """Return the active inference device ('cuda' or 'cpu')."""
        return self._device

    def get_device(self) -> str:
        """Return the active inference device ('cuda' or 'cpu')."""
        return self._device

    def get_engine(self, model_name: str = "expressive_medium") -> InferenceEngine:
        """
        Return a cached InferenceEngine for `model_name`, loading it lazily if needed.
        Prefers local checkpoints resolved via `settings.resolve_checkpoint_path`.
        """
        with self._lock:
            if model_name in self._engines:
                return self._engines[model_name]

            ckpt_path: Optional[Path] = settings.resolve_checkpoint_path(model_name)
            if ckpt_path is not None and ckpt_path.exists():
                engine = InferenceEngine.from_checkpoint(str(ckpt_path), device=self._device)
            else:
                engine = InferenceEngine.from_pretrained(
                    model_name,
                    hf_repo=settings.HF_REPO,
                    device=self._device,
                )

            self._engines[model_name] = engine
            return engine

    def is_loaded(self, model_name: str) -> bool:
        """Check whether an InferenceEngine for `model_name` is already cached."""
        with self._lock:
            return model_name in self._engines

    def unload_model(self, model_name: str) -> bool:
        """Remove a cached engine from memory. Returns True if it was loaded."""
        with self._lock:
            removed = self._engines.pop(model_name, None) is not None
        if removed and torch.cuda.is_available():
            torch.cuda.empty_cache()
        return removed

    def clear_cache(self) -> None:
        """Clear all cached engines."""
        with self._lock:
            self._engines.clear()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def list_available_models(self) -> List[dict]:
        """
        List MIDI-GPT checkpoints found locally in MODEL_PATH or HF_CACHE_DIR.
        """
        discovered_names: List[str] = list(KNOWN_MODEL_SPECS.keys())

        for base_dir in (settings.MODEL_PATH, settings.HF_CACHE_DIR / "snapshots"):
            if not base_dir.is_dir():
                continue
            pattern = "*-final.safetensors" if base_dir == settings.MODEL_PATH else "*/*-final.safetensors"
            for candidate in sorted(base_dir.glob(pattern)):
                stem = candidate.name.removesuffix("-final.safetensors")
                if stem not in discovered_names:
                    discovered_names.append(stem)

        results: List[dict] = []
        with self._lock:
            loaded_keys = set(self._engines.keys())

        for name in discovered_names:
            ckpt_path = settings.resolve_checkpoint_path(name)
            if ckpt_path is None or not ckpt_path.is_file():
                continue
            spec = KNOWN_MODEL_SPECS.get(
                name,
                {
                    "num_bars_map": [4, 8],
                    "supports_velocity": True,
                    "switchable_velocity": False,
                    "supports_microtiming": False,
                    "supports_genre": False,
                },
            )
            results.append(
                {
                    "name": name,
                    "path": str(ckpt_path),
                    "size_mb": round(ckpt_path.stat().st_size / (1024.0 * 1024.0), 2),
                    "loaded": name in loaded_keys,
                    "device": self._device,
                    **spec,
                }
            )
        return results

    def get_vram_usage(self) -> float:
        """
        Return current PyTorch CUDA VRAM usage in megabytes (0.0 on CPU).
        """
        if torch.cuda.is_available():
            return round(float(torch.cuda.memory_allocated()) / (1024.0 * 1024.0), 2)
        return 0.0

    def is_hf_authenticated(self) -> bool:
        """
        Check whether a Hugging Face token is available in HF_TOKEN env var
        or stored via huggingface_hub.
        """
        if os.environ.get("HF_TOKEN", "").strip():
            return True
        try:
            token = huggingface_hub.get_token()
            return bool(token and str(token).strip())
        except Exception:
            return False

    def download_model(
        self,
        model_name: str,
        hf_token: Optional[str] = None,
        save_token: bool = False,
    ) -> ModelDownloadResponse:
        """
        Download <model_name>-final.safetensors from Hugging Face if missing locally.
        Handles gated repository / auth errors cleanly without exposing tokens in logs.
        """
        repo_url = f"https://huggingface.co/{settings.HF_REPO}"
        existing = settings.resolve_checkpoint_path(model_name)
        if existing is not None and existing.is_file():
            return ModelDownloadResponse(
                success=True,
                model_name=model_name,
                message=f"Pesos de {model_name} já disponíveis localmente.",
                path=str(existing),
                already_present=True,
                repo_url=repo_url,
            )

        clean_token: Optional[str] = (
            hf_token.strip() if hf_token and hf_token.strip() else None
        )
        filename = f"{model_name}-final.safetensors"

        try:
            downloaded_path = huggingface_hub.hf_hub_download(
                repo_id=settings.HF_REPO,
                filename=filename,
                token=clean_token,
            )
            if save_token and clean_token:
                try:
                    huggingface_hub.login(
                        token=clean_token,
                        add_to_git_credential=False,
                    )
                except Exception as login_exc:
                    logger.warning(
                        "Could not persist Hugging Face token (%s)",
                        type(login_exc).__name__,
                    )
            return ModelDownloadResponse(
                success=True,
                model_name=model_name,
                message=f"Download de {model_name} concluído com sucesso.",
                path=str(downloaded_path),
                already_present=False,
                auth_required=False,
                repo_url=repo_url,
            )
        except (GatedRepoError, RepositoryNotFoundError):
            return ModelDownloadResponse(
                success=False,
                model_name=model_name,
                message=(
                    f"Acesso negado ao repositório gated {settings.HF_REPO}. "
                    "Aceite os termos no Hugging Face e informe seu Access Token (read)."
                ),
                auth_required=True,
                repo_url=repo_url,
            )
        except HfHubHTTPError as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in (401, 403):
                return ModelDownloadResponse(
                    success=False,
                    model_name=model_name,
                    message=(
                        f"Acesso negado ao repositório gated {settings.HF_REPO}. "
                        "Aceite os termos no Hugging Face e informe seu Access Token (read)."
                    ),
                    auth_required=True,
                    repo_url=repo_url,
                )
            return ModelDownloadResponse(
                success=False,
                model_name=model_name,
                message=str(exc),
                auth_required=False,
                repo_url=repo_url,
            )
        except Exception as exc:
            return ModelDownloadResponse(
                success=False,
                model_name=model_name,
                message=str(exc),
                auth_required=False,
                repo_url=repo_url,
            )
