"""
Configuration and settings for music_ai_module.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional
from pydantic import BaseModel, Field

_DEFAULT_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _get_default_skill_path(root: Path) -> Path:
    direct = root / "music-composition"
    if direct.exists():
        return direct
    agents_path = root / ".agents" / "skills" / "music-composition"
    if agents_path.exists():
        return agents_path
    return direct


class Settings(BaseModel):
    """
    Global application settings for music_ai_module.
    """
    PROJECT_ROOT: Path = Field(
        default_factory=lambda: Path(
            os.environ.get("PROJECT_ROOT", str(_DEFAULT_PROJECT_ROOT))
        ).resolve()
    )
    SKILL_PATH: Path = Field(
        default_factory=lambda: Path(
            os.environ.get("SKILL_PATH", str(_get_default_skill_path(_DEFAULT_PROJECT_ROOT)))
        ).resolve()
    )
    HF_REPO: str = "Metacreation/MIDI-GPT"
    HF_CACHE_DIR: Path = Field(
        default_factory=lambda: Path(
            os.environ.get(
                "HF_CACHE_DIR",
                str(Path.home() / ".cache" / "huggingface" / "hub" / "models--Metacreation--MIDI-GPT"),
            )
        ).resolve()
    )
    MODEL_PATH: Path = Field(
        default_factory=lambda: Path(
            os.environ.get("MODEL_PATH", str(_DEFAULT_PROJECT_ROOT / "models" / "midigpt"))
        ).resolve()
    )
    DEFAULT_MODEL_NAME: Literal[
        "expressive_medium", "prism_medium", "yellow_medium", "yellow_small"
    ] = "expressive_medium"
    LLM_MODEL: str = Field(
        default_factory=lambda: os.environ.get("LLM_MODEL", "gpt-4o")
    )
    OPENAI_API_KEY: Optional[str] = Field(
        default_factory=lambda: os.environ.get("OPENAI_API_KEY")
    )
    OPENAI_BASE_URL: Optional[str] = Field(
        default_factory=lambda: os.environ.get("OPENAI_BASE_URL")
    )
    SERVER_HOST: str = Field(
        default_factory=lambda: os.environ.get("SERVER_HOST", "127.0.0.1")
    )
    SERVER_PORT: int = Field(
        default_factory=lambda: int(os.environ.get("SERVER_PORT", "8765"))
    )

    def resolve_checkpoint_path(self, model_name: str = "expressive_medium") -> Optional[Path]:
        """
        Locate <model_name>-final.safetensors in MODEL_PATH or HF_CACHE_DIR / snapshots.
        Returns the resolved Path if found, otherwise None.
        """
        filename = f"{model_name}-final.safetensors"

        # 1. Check local MODEL_PATH
        local_cand = self.MODEL_PATH / filename
        if local_cand.is_file():
            return local_cand

        # 2. Check HF cache snapshots directory
        snapshots_dir = self.HF_CACHE_DIR / "snapshots"
        if snapshots_dir.is_dir():
            for snapshot_dir in sorted(snapshots_dir.iterdir(), reverse=True):
                if snapshot_dir.is_dir():
                    cand = snapshot_dir / filename
                    if cand.is_file():
                        return cand

        # 3. Check HF cache root directory
        root_cand = self.HF_CACHE_DIR / filename
        if root_cand.is_file():
            return root_cand

        return None


settings: Settings = Settings()
