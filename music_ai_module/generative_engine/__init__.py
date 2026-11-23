"""
Generative engine package wrapping MIDI-GPT 0.4.2.
"""

from music_ai_module.generative_engine.controls_mapper import (
    CANONICAL_ROLE_ORDER,
    ROLE_PITCH_RANGES,
    ROLE_TO_PROGRAM,
    VALID_GENRES,
    ControlsMapper,
    choose_model_dim,
    normalize_genre,
    resolve_scale_pitch_classes,
    role_for_program,
)
from music_ai_module.generative_engine.midi_gpt_wrapper import MidiGPTWrapper
from music_ai_module.generative_engine.model_manager import KNOWN_MODEL_SPECS, ModelManager

__all__ = [
    "CANONICAL_ROLE_ORDER",
    "KNOWN_MODEL_SPECS",
    "ROLE_PITCH_RANGES",
    "ROLE_TO_PROGRAM",
    "VALID_GENRES",
    "ControlsMapper",
    "MidiGPTWrapper",
    "ModelManager",
    "choose_model_dim",
    "normalize_genre",
    "resolve_scale_pitch_classes",
    "role_for_program",
]
