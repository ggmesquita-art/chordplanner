"""
Thread-safe singleton manager for MIDI-GPT InferenceEngine instances.
Prioritizes local HuggingFace cache checkpoints without requiring network access.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Dict, List, Optional

import torch
from midigpt.inference.engine import InferenceEngine

from music_ai_module.config import settings

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
