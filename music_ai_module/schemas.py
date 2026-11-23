"""
Pydantic v2 strict schemas and domain models for music_ai_module.
"""

from __future__ import annotations

from enum import Enum
from typing import Dict, List, Literal, Optional, Tuple
from pydantic import BaseModel, ConfigDict, Field


class CamelotKey(str, Enum):
    """
    Camelot wheel notation keys (1A-12A for minor, 1B-12B for major).
    """
    _1A = "1A"
    _2A = "2A"
    _3A = "3A"
    _4A = "4A"
    _5A = "5A"
    _6A = "6A"
    _7A = "7A"
    _8A = "8A"
    _9A = "9A"
    _10A = "10A"
    _11A = "11A"
    _12A = "12A"

    _1B = "1B"
    _2B = "2B"
    _3B = "3B"
    _4B = "4B"
    _5B = "5B"
    _6B = "6B"
    _7B = "7B"
    _8B = "8B"
    _9B = "9B"
    _10B = "10B"
    _11B = "11B"
    _12B = "12B"


class TrackRole(str, Enum):
    """
    Musical role assigned to a MIDI/Score track.
    """
    MELODY = "melody"
    CHORDS = "chords"
    BASS = "bass"
    DRUMS = "drums"
    PAD = "pad"


class NoteEvent(BaseModel):
    """
    Single discrete MIDI note event.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    pitch: int = Field(ge=0, le=127, description="MIDI pitch number 0-127")
    start_tick: int = Field(ge=0, description="Start time in ticks from score origin")
    end_tick: int = Field(gt=0, description="End time in ticks (must be > start_tick)")
    velocity: int = Field(default=80, ge=1, le=127, description="MIDI note velocity")


class ChordSymbolEvent(BaseModel):
    """
    Harmonic label / chord symbol event anchored to a timeline range.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    symbol: str = Field(description="Chord symbol string, e.g. Am7, Cmaj7, G7/B")
    root_pc: Optional[int] = Field(default=None, ge=0, le=11, description="Root pitch class 0-11")
    quality: Optional[str] = Field(default=None, description="Chord quality category")
    start_tick: int = Field(ge=0, description="Start time in ticks")
    end_tick: int = Field(gt=0, description="End time in ticks")


class TrackInput(BaseModel):
    """
    Input track provided by the client as prompt/conditioning or reference.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    role: TrackRole = Field(description="Role for this track")
    program: int = Field(default=0, ge=0, le=128, description="General MIDI program number")
    notes: List[NoteEvent] = Field(default_factory=list, description="Pre-existing note events")
    chord_symbols: List[str] = Field(default_factory=list, description="Associated chord symbols")


class InpaintRange(BaseModel):
    """
    Bar range to inpaint/regenerate while preserving boundary bars.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    start_bar: int = Field(ge=0, description="0-indexed start bar of inpaint region")
    end_bar: int = Field(gt=0, description="0-indexed end bar (exclusive)")
    roles: List[TrackRole] = Field(
        default_factory=lambda: [TrackRole.CHORDS, TrackRole.MELODY],
        description="Track roles targeted for inpainting",
    )


class GenerationRequest(BaseModel):
    """
    Full generation request payload dispatched to music_ai_module.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    bpm: int = Field(default=120, ge=30, le=300, description="Tempo in beats per minute")
    time_signature: List[int] = Field(default_factory=lambda: [4, 4], description="Numerator and denominator")
    camelot_key: CamelotKey = Field(default=CamelotKey._8A, description="Camelot key notation")
    tonic_pc: Optional[int] = Field(default=None, ge=0, le=11, description="Optional tonic pitch class (0=C)")
    scale_id: str = Field(default="minor", description="Scale identifier, e.g. minor, major, dorian")
    style_prompt: str = Field(
        default="Modern Pop Ballad, emotional, piano driven",
        description="Natural language stylistic prompt",
    )
    genre: str = Field(default="pop", description="Musical genre identifier")
    form_structure: List[str] = Field(default_factory=lambda: ["A"], description="Song sections, e.g. ['A', 'B']")
    section_lengths: List[int] = Field(default_factory=lambda: [4], description="Lengths in bars per section")
    input_tracks: List[TrackInput] = Field(default_factory=list, description="Optional pre-existing prompt tracks")
    target_tracks: List[TrackRole] = Field(
        default_factory=lambda: [TrackRole.CHORDS, TrackRole.BASS],
        description="Tracks to generate",
    )
    generate_melody: bool = Field(default=False, description="Whether to include melodic topline generation")
    inpaint_range: Optional[InpaintRange] = Field(default=None, description="Inpaint boundaries if inpainting")
    density: Dict[str, int] = Field(
        default_factory=lambda: {"chords": 5, "bass": 4, "drums": 6, "pad": 3, "melody": 5},
        description="Rhythmic density per role (1-10 scale)",
    )
    polyphony: Dict[str, int] = Field(
        default_factory=lambda: {"chords": 4, "bass": 1, "drums": 3, "pad": 4, "melody": 1},
        description="Maximum simultaneous notes per role",
    )
    note_duration: Dict[str, float] = Field(
        default_factory=lambda: {"chords": 0.6, "bass": 0.8, "drums": 0.25, "pad": 0.9, "melody": 0.5},
        description="Average note duration in beats per role",
    )
    use_velocity: bool = Field(default=True, description="Whether to generate expressive MIDI velocity")
    use_microtiming: bool = Field(default=True, description="Whether to humanize tick microtiming")
    temperature: float = Field(default=1.0, ge=0.1, le=2.0, description="Sampling temperature")
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    model_name: str = Field(default="expressive_medium", description="MIDI-GPT checkpoint identifier")


class TheoreticalPlan(BaseModel):
    """
    Theoretical plan synthesized by LLM + music-composition knowledge base.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    camelot_key: CamelotKey
    tonic_pc: int = Field(ge=0, le=11)
    tonic_name: str
    scale_id: str
    scale_pitches: List[int]
    genre: str
    total_bars: int = Field(ge=1)
    chord_progression_per_bar: List[str]
    voice_leading_style: str = "drop2"
    groove_style: str = "straight"
    target_roles_order: List[TrackRole]
    primer_python_code: str
    theoretical_explanation: str = ""


class ValidationReport(BaseModel):
    """
    Post-generation music theory validation and audit report.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    is_valid: bool = True
    scale_adherence: float = 1.0
    voice_leading_score: float = 1.0
    out_of_scale_bars: List[int] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class GeneratedTrack(BaseModel):
    """
    Resulting generated track with notes and harmonic context.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    role: TrackRole
    program: int = Field(ge=0, le=128)
    name: str
    notes: List[NoteEvent] = Field(default_factory=list)
    chord_symbols: List[ChordSymbolEvent] = Field(default_factory=list)


class GenerationResult(BaseModel):
    """
    Final output response returned by the generation engine.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    success: bool
    message: str
    bpm: int
    time_signature: List[int]
    camelot_key: CamelotKey
    tracks: List[GeneratedTrack] = Field(default_factory=list)
    theoretical_plan: Optional[TheoreticalPlan] = None
    validation_report: Optional[ValidationReport] = None
    primer_midi_b64: Optional[str] = None
    generation_time_sec: float = 0.0
    vram_used_mb: float = 0.0
    model_used: str = "expressive_medium"


class ModelDownloadRequest(BaseModel):
    """
    Request payload to download MIDI-GPT weights from Hugging Face.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    model_name: Literal[
        "expressive_medium", "prism_medium", "yellow_medium", "yellow_small"
    ] = "expressive_medium"
    hf_token: Optional[str] = None
    save_token: bool = False


class ModelDownloadResponse(BaseModel):
    """
    Structured response for model weight download attempts.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    success: bool
    model_name: str
    message: str
    path: Optional[str] = None
    already_present: bool = False
    auth_required: bool = False
    repo_url: str = "https://huggingface.co/Metacreation/MIDI-GPT"


CAMELOT_TO_KEY: Dict[CamelotKey, Tuple[int, str, str]] = {
    # Minor keys (A series)
    CamelotKey._1A: (8, "Ab", "minor"),
    CamelotKey._2A: (3, "Eb", "minor"),
    CamelotKey._3A: (10, "Bb", "minor"),
    CamelotKey._4A: (5, "F", "minor"),
    CamelotKey._5A: (0, "C", "minor"),
    CamelotKey._6A: (7, "G", "minor"),
    CamelotKey._7A: (2, "D", "minor"),
    CamelotKey._8A: (9, "A", "minor"),
    CamelotKey._9A: (4, "E", "minor"),
    CamelotKey._10A: (11, "B", "minor"),
    CamelotKey._11A: (6, "F#", "minor"),
    CamelotKey._12A: (1, "Db", "minor"),
    # Major keys (B series)
    CamelotKey._1B: (11, "B", "major"),
    CamelotKey._2B: (6, "F#", "major"),
    CamelotKey._3B: (1, "Db", "major"),
    CamelotKey._4B: (8, "Ab", "major"),
    CamelotKey._5B: (3, "Eb", "major"),
    CamelotKey._6B: (10, "Bb", "major"),
    CamelotKey._7B: (5, "F", "major"),
    CamelotKey._8B: (0, "C", "major"),
    CamelotKey._9B: (7, "G", "major"),
    CamelotKey._10B: (2, "D", "major"),
    CamelotKey._11B: (9, "A", "major"),
    CamelotKey._12B: (4, "E", "major"),
}


def camelot_to_tonic_scale(camelot: CamelotKey | str) -> Tuple[int, str, str]:
    """
    Map a CamelotKey (e.g. CamelotKey._8A or '8A') to (tonic_pc, tonic_name, scale_id).
    """
    key = CamelotKey(camelot) if isinstance(camelot, str) and not isinstance(camelot, CamelotKey) else camelot
    if key in CAMELOT_TO_KEY:
        return CAMELOT_TO_KEY[key]
    raise ValueError(f"Unknown CamelotKey: {camelot}")


def tonic_scale_to_camelot(tonic_pc: int, scale_id: str) -> CamelotKey:
    """
    Map (tonic_pc, scale_id) to the corresponding CamelotKey.
    """
    normalized_pc = tonic_pc % 12
    sid = scale_id.strip().lower()
    norm_scale = "minor" if "min" in sid or sid in ("aeolian", "dorian", "phrygian") else "major"

    for ck, (tpc, _, sc) in CAMELOT_TO_KEY.items():
        if tpc == normalized_pc and sc == norm_scale:
            return ck
    raise ValueError(f"No CamelotKey mapping for tonic_pc={tonic_pc}, scale_id='{scale_id}'")
