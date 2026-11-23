"""
Imports generated midigpt.Score objects back into ChordPlanner GeneratedTrack
lists with absolute PPQ=480 NoteEvents and extracted ChordSymbolEvents.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Sequence, Set, Tuple

from midigpt import Bar, Score
from music21 import chord as m21_chord, harmony as m21_harmony

from music_ai_module.generative_engine.controls_mapper import (
    ROLE_TO_PROGRAM,
    role_for_program,
)
from music_ai_module.generative_engine.midi_gpt_wrapper import _resample_score_to_resolution
from music_ai_module.io_bridge.app_exporter import APP_PPQ
from music_ai_module.schemas import (
    ChordSymbolEvent,
    GeneratedTrack,
    NoteEvent,
    TheoreticalPlan,
    TrackInput,
    TrackRole,
)

_SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")
_DEFAULT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")

_SHARP_CAMELOTS = {"9A", "10A", "11A", "12A", "9B", "10B", "11B", "12B", "1B", "2B"}
_FLAT_CAMELOTS = {"1A", "2A", "3A", "4A", "5A", "6A", "7A", "3B", "4B", "5B", "6B", "7B"}

# (relative_pitch_classes_tuple, symbol_suffix, quality_label, base_cost)
_CHORD_TEMPLATES: Tuple[Tuple[Tuple[int, ...], str, str, int], ...] = (
    ((0, 4, 7), "", "major", 0),
    ((0, 3, 7), "m", "minor", 0),
    ((0, 4, 7, 11), "maj7", "major7", 1),
    ((0, 3, 7, 10), "m7", "minor7", 1),
    ((0, 4, 7, 10), "7", "dominant7", 1),
    ((0, 3, 6), "dim", "diminished", 2),
    ((0, 3, 6, 10), "m7b5", "half-diminished", 2),
    ((0, 3, 6, 9), "dim7", "diminished7", 2),
    ((0, 4, 8), "aug", "augmented", 3),
    ((0, 5, 7), "sus4", "suspended4", 2),
    ((0, 2, 7), "sus2", "suspended2", 3),
    ((0, 4, 7, 9), "6", "major6", 3),
    ((0, 3, 7, 9), "m6", "minor6", 3),
    ((0, 2, 4, 7), "add9", "major", 3),
    ((0, 4, 7, 10, 2), "9", "dominant9", 3),
    ((0, 4, 7, 11, 2), "maj9", "major9", 3),
    ((0, 3, 7, 10, 2), "m9", "minor9", 3),
    # Shell voicings (omitted 5th)
    ((0, 4, 11), "maj7", "major7", 4),
    ((0, 3, 10), "m7", "minor7", 4),
    ((0, 4, 10), "7", "dominant7", 4),
    # Dyads
    ((0, 7), "5", "power", 5),
    ((0, 4), "", "major", 6),
    ((0, 3), "m", "minor", 6),
)


def _pc_to_name(pc: int, plan: Optional[TheoreticalPlan] = None) -> str:
    idx = int(pc) % 12
    if plan is not None:
        ck = plan.camelot_key.value
        if ck in _SHARP_CAMELOTS:
            return _SHARP_NAMES[idx]
        if ck in _FLAT_CAMELOTS:
            return _FLAT_NAMES[idx]
    return _DEFAULT_NAMES[idx]


def _normalize_m21_symbol(raw: str) -> str:
    s = raw.strip()
    if not s or "Cannot Be Identified" in s:
        return ""
    # Replace music21 flat '-' (after note letter) with 'b'
    out: List[str] = []
    for i, ch in enumerate(s):
        if ch == "-" and i > 0 and s[i - 1].isalpha():
            out.append("b")
        else:
            out.append(ch)
    cleaned = "".join(out)
    cleaned = cleaned.replace("ø", "m7b5").replace("o7", "dim7").replace("o", "dim")
    if cleaned.endswith("sus"):
        cleaned += "4"
    # Replace B#, E#, Cb, Fb roots/bass if produced
    cleaned = (
        cleaned.replace("B#", "C")
        .replace("E#", "F")
        .replace("Cb", "B")
        .replace("Fb", "E")
    )
    return cleaned


def _recognize_chord_from_pitches(
    weighted_pitches: Sequence[Tuple[int, int]],
    plan: Optional[TheoreticalPlan] = None,
) -> Optional[Tuple[str, int, str]]:
    """
    Identify `(symbol, root_pc, quality)` from a list of `(midi_pitch, duration_ticks)` pairs.
    """
    if not weighted_pitches:
        return None

    bass_pitch = min(p for p, _ in weighted_pitches)
    bass_pc = bass_pitch % 12

    pc_weights: Dict[int, float] = defaultdict(float)
    for pitch, dur in weighted_pitches:
        pc_weights[int(pitch) % 12] += max(1, int(dur))

    distinct_pcs = set(pc_weights.keys())
    if len(distinct_pcs) == 1:
        root_pc = next(iter(distinct_pcs))
        return _pc_to_name(root_pc, plan), root_pc, "single"

    # If too many passing tones (> 5 distinct PCs), focus on top 4 weighted PCs + bass
    candidate_pc_sets: List[Set[int]] = [distinct_pcs]
    if len(distinct_pcs) > 5:
        top_pcs = {
            pc
            for pc, _ in sorted(pc_weights.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
        }
        top_pcs.add(bass_pc)
        candidate_pc_sets.append(top_pcs)

    scale_pcs: Set[int] = (
        {int(p) % 12 for p in plan.scale_pitches}
        if (plan is not None and plan.scale_pitches)
        else set()
    )

    best_score: Optional[float] = None
    best_result: Optional[Tuple[str, int, str]] = None

    for pc_set in candidate_pc_sets:
        for root_pc in sorted(pc_set):
            rel_set = {(pc - root_pc) % 12 for pc in pc_set}
            for tmpl_ivs, suffix, quality, base_cost in _CHORD_TEMPLATES:
                tmpl_set = set(tmpl_ivs)
                if rel_set == tmpl_set:
                    score = float(base_cost)
                    if root_pc != bass_pc:
                        score += 3.5
                    if scale_pcs:
                        if root_pc in scale_pcs:
                            score -= 1.0
                        if pc_set.issubset(scale_pcs):
                            score -= 1.0
                    if best_score is None or score < best_score:
                        best_score = score
                        root_name = _pc_to_name(root_pc, plan)
                        symbol = f"{root_name}{suffix}"
                        if root_pc != bass_pc and len(tmpl_set) >= 3 and bass_pc in pc_set:
                            # Include slash bass only for inversions of triads/sevenths when distinct
                            if (bass_pc - root_pc) % 12 in tmpl_set:
                                pass  # keep clean symbol by default unless needed
                        best_result = (symbol, root_pc, quality)

    if best_result is not None:
        return best_result

    # Fallback: music21 chord analysis
    try:
        unique_sorted_pitches = sorted({int(p) for p, _ in weighted_pitches})
        c = m21_chord.Chord(unique_sorted_pitches)
        raw_fig = m21_harmony.chordSymbolFigureFromChord(c)
        norm_fig = _normalize_m21_symbol(raw_fig)
        if norm_fig:
            root_pc = int(c.root().pitchClass) % 12
            quality = str(c.quality or "other")
            return norm_fig, root_pc, quality
    except Exception:
        pass

    # Ultimate fallback: pick highest-weight pitch class as root
    top_pc = max(pc_weights.items(), key=lambda kv: (kv[1], 1 if kv[0] == bass_pc else 0))[0]
    return _pc_to_name(top_pc, plan), top_pc, "unknown"


def extract_chord_symbols_from_bars(
    bars: Sequence[Bar],
    resolution: int = APP_PPQ,
    plan: Optional[TheoreticalPlan] = None,
) -> List[ChordSymbolEvent]:
    """
    Extract one ChordSymbolEvent per populated bar using pitch-class template
    analysis and music21 chord recognition.
    """
    events: List[ChordSymbolEvent] = []
    bar_start_tick = 0

    for bar in bars:
        ts_num = getattr(bar, "ts_numerator", 4) or 4
        ts_den = getattr(bar, "ts_denominator", 4) or 4
        bar_ticks = max(1, int(round(resolution * ts_num * (4.0 / ts_den))))
        bar_end_tick = bar_start_tick + bar_ticks

        if bar.notes:
            weighted = [(int(n.pitch), max(1, int(n.duration_ticks))) for n in bar.notes]
            recognized = _recognize_chord_from_pitches(weighted, plan=plan)
            if recognized is not None:
                symbol, root_pc, quality = recognized
                events.append(
                    ChordSymbolEvent(
                        symbol=symbol,
                        root_pc=root_pc,
                        quality=quality,
                        start_tick=bar_start_tick,
                        end_tick=bar_end_tick,
                    )
                )

        bar_start_tick = bar_end_tick

    return events


class AppImporter:
    """
    Converts generated `midigpt.Score` objects into ChordPlanner `GeneratedTrack` lists.
    """

    @staticmethod
    def score_to_app_tracks(
        score: Score,
        track_roles: List[TrackRole],
        original_tracks: List[TrackInput],
        plan: Optional[TheoreticalPlan] = None,
    ) -> List[GeneratedTrack]:
        """
        Convert each Track and its Bars in `score` into `GeneratedTrack` with
        absolute PPQ=480 `NoteEvent`s and extracted `ChordSymbolEvent`s.
        """
        src_res = int(getattr(score, "resolution", APP_PPQ) or APP_PPQ)
        work_score = (
            _resample_score_to_resolution(score, APP_PPQ)
            if src_res != APP_PPQ
            else score
        )

        orig_by_role: Dict[TrackRole, TrackInput] = {t.role: t for t in original_tracks}
        generated_tracks: List[GeneratedTrack] = []

        for idx, track in enumerate(work_score.tracks):
            role = (
                track_roles[idx]
                if idx < len(track_roles)
                else role_for_program(track.instrument, track.track_type)
            )

            is_drum = role == TrackRole.DRUMS or track.track_type == "drum"
            if is_drum:
                program = 128
            elif role in orig_by_role and 0 <= orig_by_role[role].program <= 127:
                program = orig_by_role[role].program
            elif 0 <= int(track.instrument) <= 127:
                program = int(track.instrument)
            else:
                program = ROLE_TO_PROGRAM.get(role, 0)

            note_events: List[NoteEvent] = []
            bar_start_tick = 0
            for bar in track.bars:
                ts_num = getattr(bar, "ts_numerator", 4) or 4
                ts_den = getattr(bar, "ts_denominator", 4) or 4
                bar_ticks = max(1, int(round(APP_PPQ * ts_num * (4.0 / ts_den))))

                for note in bar.notes:
                    start_tick = max(0, int(bar_start_tick + note.onset_ticks + note.delta))
                    end_tick = max(start_tick + 1, start_tick + max(1, int(note.duration_ticks)))
                    pitch = max(0, min(127, int(note.pitch)))
                    velocity = max(1, min(127, int(note.velocity)))
                    note_events.append(
                        NoteEvent(
                            pitch=pitch,
                            start_tick=start_tick,
                            end_tick=end_tick,
                            velocity=velocity,
                        )
                    )
                bar_start_tick += bar_ticks

            note_events.sort(key=lambda n: (n.start_tick, n.pitch))

            chord_symbols: List[ChordSymbolEvent] = []
            if role in (TrackRole.CHORDS, TrackRole.PAD):
                chord_symbols = extract_chord_symbols_from_bars(
                    track.bars, resolution=APP_PPQ, plan=plan
                )

            orig_track = orig_by_role.get(role)
            is_preserved_input = bool(
                orig_track is not None
                and len(orig_track.notes) > 0
                and len(orig_track.notes) == len(note_events)
            )
            label_suffix = "Input" if is_preserved_input else "AI"
            track_name = f"{role.value.capitalize()} ({label_suffix})"

            generated_tracks.append(
                GeneratedTrack(
                    role=role,
                    program=program,
                    name=track_name,
                    notes=note_events,
                    chord_symbols=chord_symbols,
                )
            )

        return generated_tracks
