"""
music_ai_module - ChordPlanner Music AI generation & theoretical planning module.
"""

from music_ai_module.config import Settings, settings
from music_ai_module.orchestrator import MusicAIOrchestrator
from music_ai_module.schemas import (
    CamelotKey,
    TrackRole,
    NoteEvent,
    ChordSymbolEvent,
    TrackInput,
    InpaintRange,
    GenerationRequest,
    TheoreticalPlan,
    ValidationReport,
    GeneratedTrack,
    GenerationResult,
    CAMELOT_TO_KEY,
    camelot_to_tonic_scale,
    tonic_scale_to_camelot,
)

__all__ = [
    "Settings",
    "settings",
    "MusicAIOrchestrator",
    "CamelotKey",
    "TrackRole",
    "NoteEvent",
    "ChordSymbolEvent",
    "TrackInput",
    "InpaintRange",
    "GenerationRequest",
    "TheoreticalPlan",
    "ValidationReport",
    "GeneratedTrack",
    "GenerationResult",
    "CAMELOT_TO_KEY",
    "camelot_to_tonic_scale",
    "tonic_scale_to_camelot",
]

__version__ = "0.1.0"
