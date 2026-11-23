"""
Maps ChordPlanner GenerationRequest and TheoreticalPlan into midigpt 0.4.2
TrackPrompt, InferenceConfig, and piece-level GenerationRequest controls.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

from midigpt.inference.config import (
    GenerationRequest as MidigptRequest,
    InferenceConfig,
    TrackPrompt,
)

from music_ai_module.generative_engine.model_manager import KNOWN_MODEL_SPECS
from music_ai_module.schemas import (
    GenerationRequest,
    TheoreticalPlan,
    TrackRole,
    camelot_to_tonic_scale,
)

ROLE_TO_PROGRAM: Dict[TrackRole, int] = {
    TrackRole.CHORDS: 0,
    TrackRole.BASS: 33,
    TrackRole.DRUMS: 128,
    TrackRole.PAD: 88,
    TrackRole.MELODY: 80,
}

ROLE_PITCH_RANGES: Dict[TrackRole, Tuple[int, int]] = {
    TrackRole.BASS: (28, 55),
    TrackRole.CHORDS: (48, 76),
    TrackRole.PAD: (48, 84),
    TrackRole.MELODY: (60, 84),
}

CANONICAL_ROLE_ORDER: Tuple[TrackRole, ...] = (
    TrackRole.CHORDS,
    TrackRole.BASS,
    TrackRole.DRUMS,
    TrackRole.PAD,
    TrackRole.MELODY,
)

VALID_GENRES: Tuple[str, ...] = (
    "asian",
    "baroque",
    "blues",
    "christian",
    "classical",
    "country",
    "dance-electronic",
    "european",
    "folk",
    "hip-hop",
    "jazz",
    "latin",
    "metal",
    "pop",
    "punk",
    "renaissance",
    "rock",
    "soundtrack",
)

GENRE_ALIASES: Dict[str, str] = {
    "edm": "dance-electronic",
    "electronic": "dance-electronic",
    "dance": "dance-electronic",
    "house": "dance-electronic",
    "techno": "dance-electronic",
    "trance": "dance-electronic",
    "synthwave": "dance-electronic",
    "dubstep": "dance-electronic",
    "dnb": "dance-electronic",
    "drum and bass": "dance-electronic",
    "electro": "dance-electronic",
    "hiphop": "hip-hop",
    "hip hop": "hip-hop",
    "rap": "hip-hop",
    "trap": "hip-hop",
    "r&b": "hip-hop",
    "rnb": "hip-hop",
    "lofi": "hip-hop",
    "lo-fi": "hip-hop",
    "boom bap": "hip-hop",
    "bossa": "latin",
    "bossa nova": "latin",
    "samba": "latin",
    "salsa": "latin",
    "mpb": "latin",
    "reggaeton": "latin",
    "tango": "latin",
    "afrobeat": "latin",
    "cinematic": "soundtrack",
    "film": "soundtrack",
    "score": "soundtrack",
    "orchestral": "soundtrack",
    "ambient": "soundtrack",
    "indie": "rock",
    "alternative": "rock",
    "grunge": "rock",
    "prog": "rock",
    "progressive": "rock",
    "gospel": "christian",
    "worship": "christian",
    "ballad": "pop",
    "synthpop": "pop",
    "k-pop": "pop",
    "kpop": "pop",
    "j-pop": "pop",
    "jpop": "pop",
    "funk": "pop",
    "soul": "blues",
    "swing": "jazz",
    "bebop": "jazz",
    "fusion": "jazz",
    "acoustic": "folk",
    "singer-songwriter": "folk",
    "bluegrass": "country",
    "americana": "country",
    "hardcore": "punk",
    "emo": "punk",
    "heavy metal": "metal",
    "death metal": "metal",
    "romantic": "classical",
    "opera": "classical",
}

SCALE_FORMULAS: Dict[str, Tuple[int, ...]] = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "ionian": (0, 2, 4, 5, 7, 9, 11),
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "natural_minor": (0, 2, 3, 5, 7, 8, 10),
    "aeolian": (0, 2, 3, 5, 7, 8, 10),
    "harmonic_minor": (0, 2, 3, 5, 7, 8, 11),
    "melodic_minor": (0, 2, 3, 5, 7, 9, 11),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "locrian": (0, 1, 3, 5, 6, 8, 10),
    "major_pentatonic": (0, 2, 4, 7, 9),
    "minor_pentatonic": (0, 3, 5, 7, 10),
    "blues": (0, 3, 5, 6, 7, 10),
    "whole_tone": (0, 2, 4, 6, 8, 10),
    "chromatic": tuple(range(12)),
}

_MINOR_SCALE_IDS = {
    "minor",
    "natural_minor",
    "aeolian",
    "harmonic_minor",
    "melodic_minor",
    "dorian",
    "phrygian",
    "locrian",
    "minor_pentatonic",
    "blues",
}


def normalize_genre(genre: str) -> str:
    """
    Normalize an arbitrary genre/style label into one of the 18 valid MIDI-GPT encoder genres.
    """
    cleaned = genre.strip().lower().replace("_", "-")
    if cleaned in VALID_GENRES:
        return cleaned

    spaced = cleaned.replace("-", " ")
    if cleaned in GENRE_ALIASES:
        return GENRE_ALIASES[cleaned]
    if spaced in GENRE_ALIASES:
        return GENRE_ALIASES[spaced]

    for g in VALID_GENRES:
        if g in cleaned or g.replace("-", " ") in spaced:
            return g

    for alias, target in GENRE_ALIASES.items():
        if alias in spaced or alias in cleaned:
            return target

    return "pop"


def resolve_tonic_and_scale(
    request: GenerationRequest, plan: Optional[TheoreticalPlan] = None
) -> Tuple[int, str]:
    """
    Resolve (tonic_pc, scale_id) from TheoreticalPlan or GenerationRequest.
    """
    if plan is not None:
        return int(plan.tonic_pc) % 12, plan.scale_id

    cam_tonic, _, cam_scale = camelot_to_tonic_scale(request.camelot_key)
    tonic = int(request.tonic_pc) % 12 if request.tonic_pc is not None else cam_tonic
    scale_id = (request.scale_id or cam_scale).strip().lower()
    return tonic, scale_id


def resolve_scale_pitch_classes(
    request: GenerationRequest, plan: Optional[TheoreticalPlan] = None
) -> List[int]:
    """
    Resolve sorted unique pitch classes (0..11) for the target key/scale.
    """
    if plan is not None and plan.scale_pitches:
        pcs = sorted({int(p) % 12 for p in plan.scale_pitches})
        if pcs:
            return pcs

    tonic, scale_id = resolve_tonic_and_scale(request, plan=None)
    formula = SCALE_FORMULAS.get(scale_id)
    if formula is None:
        formula = SCALE_FORMULAS["minor"] if "min" in scale_id else SCALE_FORMULAS["major"]
    return sorted({(tonic + iv) % 12 for iv in formula})


def resolve_key_signature_index(tonic_pc: int, scale_id: str) -> int:
    """
    Map (tonic_pc, scale_id) to MIDI-GPT KeySignature token index:
      0..11 = Major (C..B), 12..23 = Minor (Cm..Bm).
    """
    pc = int(tonic_pc) % 12
    sid = scale_id.strip().lower()
    is_minor = sid in _MINOR_SCALE_IDS or "min" in sid
    return pc + 12 if is_minor else pc


def quantize_density(density: int) -> int:
    """Map 1..10 density scale to MIDI-GPT 0..9 quantile bin."""
    return max(0, min(9, int(density) - 1))


def quantize_polyphony(polyphony: int) -> int:
    """Map 1..10 polyphony count to MIDI-GPT 0..9 bin (0 = 1 voice)."""
    return max(0, min(9, int(polyphony) - 1))


def quantize_duration(beats: float) -> int:
    """
    Map note duration in beats to MIDI-GPT NoteDurationQuantile bin (0..5):
      0=32nd, 1=16th, 2=8th, 3=quarter, 4=half, 5=whole.
    """
    b = float(beats)
    if b <= 0.125:
        return 0
    if b <= 0.25:
        return 1
    if b <= 0.5:
        return 2
    if b <= 1.0:
        return 3
    if b <= 2.0:
        return 4
    return 5


def choose_model_dim(
    total_bars: int,
    num_bars_map: Optional[Sequence[int]] = None,
    model_name: str = "expressive_medium",
) -> int:
    """
    Select a compatible `model_dim` from the model's `num_bars_map`.
    """
    if num_bars_map:
        dims = sorted({int(d) for d in num_bars_map if int(d) > 0})
    else:
        dims = list(KNOWN_MODEL_SPECS.get(model_name, {}).get("num_bars_map", [4, 8, 12, 16]))
    if not dims:
        return 4
    fits = [d for d in dims if d <= total_bars]
    return max(fits) if fits else min(dims)


def role_for_program(program: int, track_type: str = "melodic") -> TrackRole:
    """
    Infer a ChordPlanner TrackRole from a General MIDI program and track_type.
    """
    if track_type == "drum" or program == 128:
        return TrackRole.DRUMS
    for role, prog in ROLE_TO_PROGRAM.items():
        if role != TrackRole.DRUMS and prog == program:
            return role
    if 32 <= program <= 39:
        return TrackRole.BASS
    if 88 <= program <= 95:
        return TrackRole.PAD
    if 0 <= program <= 7:
        return TrackRole.CHORDS
    return TrackRole.MELODY


def _extract_num_bars_map(encoder_config: Any, model_name: str) -> List[int]:
    if encoder_config is not None:
        try:
            cfg_dict = json.loads(encoder_config.to_json())
            nb = cfg_dict.get("num_bars_map")
            if nb:
                return [int(x) for x in nb]
        except Exception:
            pass
    return list(KNOWN_MODEL_SPECS.get(model_name, {}).get("num_bars_map", [4, 8, 12, 16]))


class ControlsMapper:
    """
    Converts GenerationRequest + TheoreticalPlan into MIDI-GPT request structures.
    """

    def build_piece_controls(
        self,
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
        encoder_config: Any = None,
    ) -> Dict[str, Any]:
        """
        Build piece-level controls (`velocity`, `microtiming`, `genre`) respecting
        what the target model's encoder_config supports.
        """
        controls: Dict[str, Any] = {}
        raw_genre = plan.genre if (plan is not None and plan.genre) else request.genre
        norm_genre = normalize_genre(raw_genre)

        if encoder_config is not None:
            try:
                cfg_dict = json.loads(encoder_config.to_json())
            except Exception:
                cfg_dict = {}
            has_vel = int(cfg_dict.get("velocity_levels", 0)) > 0
            switch_vel = bool(cfg_dict.get("switchable_velocity", False))
            has_delta = bool(cfg_dict.get("emit_delta_tokens", False))
            switch_mt = bool(cfg_dict.get("switchable_microtiming", False))
            genre_grouping = getattr(encoder_config, "genre_grouping", None)

            if switch_vel:
                controls["velocity"] = bool(request.use_velocity)
            elif has_vel and request.use_velocity:
                controls["velocity"] = True

            if switch_mt:
                controls["microtiming"] = bool(request.use_microtiming)
            elif has_delta and request.use_microtiming:
                controls["microtiming"] = True

            if genre_grouping is not None and genre_grouping.contains(norm_genre):
                controls["genre"] = norm_genre
            return controls

        spec = KNOWN_MODEL_SPECS.get(request.model_name, {})
        if spec.get("switchable_velocity", False):
            controls["velocity"] = bool(request.use_velocity)
        elif spec.get("supports_velocity", False) and request.use_velocity:
            controls["velocity"] = True

        if spec.get("supports_microtiming", False):
            controls["microtiming"] = bool(request.use_microtiming)

        if spec.get("supports_genre", False):
            controls["genre"] = norm_genre

        return controls

    def build_pitch_mask(
        self,
        role: TrackRole,
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Build `pitch_mask` control for melodic roles; returns None for DRUMS.
        """
        if role == TrackRole.DRUMS:
            return None
        pitch_classes = resolve_scale_pitch_classes(request, plan)
        lo, hi = ROLE_PITCH_RANGES.get(role, (48, 84))
        return {
            "pitch_classes": pitch_classes,
            "shape": {"type": "uniform", "min": lo, "max": hi},
        }

    def build_rhythm_mask(
        self,
        role: TrackRole,
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Build soft `rhythm_mask` grid bias when microtiming is disabled.
        When microtiming is enabled, returns None so humanized timings are unconstrained.
        """
        if request.use_microtiming:
            return None
        if plan is not None and "swing" in plan.groove_style.lower():
            return {"grid": {"unit": "eighth_triplet", "strength": 0.6}}
        if role in (TrackRole.CHORDS, TrackRole.PAD):
            return {"grid": {"unit": "eighth", "strength": 0.7}}
        return {"grid": {"unit": "sixteenth", "strength": 0.7}}

    def build_track_attributes(
        self,
        role: TrackRole,
        bars_to_generate: List[int],
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
        analyzer: Any = None,
    ) -> Tuple[Dict[str, int], Dict[int, Dict[str, int]]]:
        """
        Build track-level `attributes` and per-bar `bar_attributes` filtered to what
        the model's AttributeAnalyzer actually supports.
        """
        track_attrs: Dict[str, int] = {}
        bar_attrs: Dict[int, Dict[str, int]] = {}
        if not bars_to_generate:
            return track_attrs, bar_attrs

        role_key = role.value
        is_drum = role == TrackRole.DRUMS
        density_val = quantize_density(request.density.get(role_key, 5))
        poly_target = quantize_polyphony(request.polyphony.get(role_key, 1 if role in (TrackRole.BASS, TrackRole.MELODY) else 4))
        dur_bin = quantize_duration(request.note_duration.get(role_key, 0.5))

        tonic_pc, scale_id = resolve_tonic_and_scale(request, plan)
        ks_idx = resolve_key_signature_index(tonic_pc, scale_id)

        if role in (TrackRole.CHORDS, TrackRole.PAD):
            min_poly = min(1, poly_target)
            max_poly = max(min_poly, poly_target)
        elif role == TrackRole.BASS:
            min_poly = 0
            max_poly = max(0, min(poly_target, 1))
        else:
            min_poly = 0
            max_poly = poly_target

        # Candidate attribute values
        candidates: Dict[str, int] = {}
        if is_drum:
            candidates["note_density"] = density_val
            candidates["bar_note_density"] = density_val
        else:
            candidates["key_signature"] = ks_idx
            candidates["min_polyphony"] = min_poly
            candidates["max_polyphony"] = max_poly
            candidates["bar_min_polyphony"] = min_poly
            candidates["bar_max_polyphony"] = max_poly
            candidates["min_note_duration"] = max(0, dur_bin - 1)
            candidates["max_note_duration"] = min(5, max(dur_bin, dur_bin + 1))

        if analyzer is None:
            # Default fallback matching expressive_medium schema when no analyzer is provided
            if is_drum:
                for b in bars_to_generate:
                    bar_attrs[int(b)] = {"bar_note_density": density_val}
            else:
                track_attrs["key_signature"] = ks_idx
                track_attrs["max_note_duration"] = candidates["max_note_duration"]
                for b in bars_to_generate:
                    bar_attrs[int(b)] = {
                        "bar_min_polyphony": min_poly,
                        "bar_max_polyphony": max_poly,
                    }
            return track_attrs, bar_attrs

        sizes = analyzer.attribute_sizes()
        levels = analyzer.attribute_levels()
        track_types = analyzer.attribute_track_types()

        for attr_name, raw_val in candidates.items():
            if attr_name not in sizes:
                continue
            req_tt = track_types.get(attr_name, "both")
            if is_drum and req_tt == "melodic":
                continue
            if not is_drum and req_tt == "drum":
                continue
            sz = int(sizes[attr_name])
            clamped = max(0, min(sz - 1, int(raw_val)))
            lvl = levels.get(attr_name, "track")
            if lvl == "bar":
                for b in bars_to_generate:
                    bar_attrs.setdefault(int(b), {})[attr_name] = clamped
            else:
                track_attrs[attr_name] = clamped

        return track_attrs, bar_attrs

    def build_track_prompt(
        self,
        track_idx: int,
        role: TrackRole,
        bars_to_generate: List[int],
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
        *,
        autoregressive: bool = False,
        analyzer: Any = None,
    ) -> TrackPrompt:
        """
        Create a `midigpt.inference.config.TrackPrompt` for one track.
        Context-only tracks have `bars=[]` and `ignore=False`.
        """
        if not bars_to_generate:
            return TrackPrompt(id=track_idx, bars=[], autoregressive=False, ignore=False)

        controls: Dict[str, Any] = {}
        pitch_mask = self.build_pitch_mask(role, request, plan)
        if pitch_mask is not None:
            controls["pitch_mask"] = pitch_mask

        rhythm_mask = self.build_rhythm_mask(role, request, plan)
        if rhythm_mask is not None:
            controls["rhythm_mask"] = rhythm_mask

        track_attrs, bar_attrs = self.build_track_attributes(
            role=role,
            bars_to_generate=bars_to_generate,
            request=request,
            plan=plan,
            analyzer=analyzer,
        )

        return TrackPrompt(
            id=track_idx,
            bars=list(bars_to_generate),
            autoregressive=autoregressive,
            ignore=False,
            attributes=track_attrs,
            controls=controls,
            bar_attributes=bar_attrs,
        )

    def build_midigpt_request(
        self,
        track_roles: List[TrackRole],
        bars_per_track: Dict[int, List[int]],
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
        *,
        total_bars: int = 4,
        encoder_config: Any = None,
        analyzer: Any = None,
        autoregressive_tracks: Optional[set[int]] = None,
    ) -> MidigptRequest:
        """
        Assemble a complete `midigpt.inference.config.GenerationRequest` for all tracks in a Score.
        """
        ar_set = autoregressive_tracks or set()
        track_prompts: List[TrackPrompt] = []
        for idx, role in enumerate(track_roles):
            target_bars = bars_per_track.get(idx, [])
            tp = self.build_track_prompt(
                track_idx=idx,
                role=role,
                bars_to_generate=target_bars,
                request=request,
                plan=plan,
                autoregressive=(idx in ar_set),
                analyzer=analyzer,
            )
            track_prompts.append(tp)

        nb_map = _extract_num_bars_map(encoder_config, request.model_name)
        model_dim = choose_model_dim(total_bars, nb_map, request.model_name)

        inf_cfg = InferenceConfig(
            temperature=float(request.temperature),
            seed=int(request.seed) if request.seed is not None else -1,
            model_dim=model_dim,
            bars_per_step=0,  # auto: full model_dim window for infill
            tracks_per_step=1,  # keep per-track pitch_mask isolated cleanly
            max_attempts=3,
        )

        piece_controls = self.build_piece_controls(
            request=request,
            plan=plan,
            encoder_config=encoder_config,
        )

        return MidigptRequest(
            tracks=track_prompts,
            config=inf_cfg,
            controls=piece_controls,
        )
