"""
SymbolicValidator: Post-generation music theory audit and validation of
a `midigpt.Score` against its `TheoreticalPlan`.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

from midigpt import Note, Score, Track

from music_ai_module.schemas import TheoreticalPlan, ValidationReport


def _extract_chord_slices(track: Track) -> List[List[int]]:
    """
    Extract chronologically ordered chord pitch lists from a melodic/harmonic track.
    Notes within 60 ticks of each other in a bar are grouped into a chord slice.
    """
    slices: List[List[int]] = []
    for bar in track.bars:
        if not bar.notes:
            continue
        clusters: Dict[int, List[int]] = defaultdict(list)
        for note in bar.notes:
            bucket = int(note.onset_ticks) // 60
            clusters[bucket].append(int(note.pitch))
        for bucket in sorted(clusters):
            pitches = sorted(set(clusters[bucket]))
            if len(pitches) >= 2:
                slices.append(pitches)
    return slices


def _compute_voice_leading_score(melodic_tracks: List[Track]) -> Tuple[float, float]:
    """
    Evaluate voice-leading smoothness across consecutive chord slices (or
    monophonic melodic contour if no polyphonic chord track exists).
    Returns (voice_leading_score in [0.0, 1.0], average_semitone_leap).
    """
    # Prefer polyphonic tracks (chords / pad) for chordal voice-leading evaluation
    chord_leaps: List[float] = []
    for track in melodic_tracks:
        slices = _extract_chord_slices(track)
        if len(slices) < 2:
            continue
        for prev_c, curr_c in zip(slices, slices[1:]):
            if len(prev_c) == len(curr_c):
                leap = sum(abs(a - b) for a, b in zip(prev_c, curr_c)) / len(curr_c)
            else:
                leap = sum(min(abs(a - b) for b in prev_c) for a in curr_c) / len(curr_c)
            chord_leaps.append(leap)

    if chord_leaps:
        avg_leap = sum(chord_leaps) / len(chord_leaps)
        if avg_leap <= 2.0:
            score = 1.0
        else:
            score = max(0.0, min(1.0, 1.0 - (avg_leap - 2.0) / 10.0))
        return round(score, 4), round(avg_leap, 3)

    # Fallback: evaluate monophonic melodic contour smoothness
    melodic_leaps: List[float] = []
    for track in melodic_tracks:
        all_pitches: List[int] = []
        for bar in track.bars:
            for note in sorted(bar.notes, key=lambda n: (n.onset_ticks, n.pitch)):
                all_pitches.append(int(note.pitch))
        if len(all_pitches) >= 2:
            for a, b in zip(all_pitches, all_pitches[1:]):
                melodic_leaps.append(float(abs(b - a)))

    if not melodic_leaps:
        return 1.0, 0.0

    avg_leap = sum(melodic_leaps) / len(melodic_leaps)
    if avg_leap <= 3.0:
        score = 1.0
    else:
        score = max(0.0, min(1.0, 1.0 - (avg_leap - 3.0) / 12.0))
    return round(score, 4), round(avg_leap, 3)


class SymbolicValidator:
    """
    Validates generated or primer `midigpt.Score` objects against a `TheoreticalPlan`.
    """

    OUT_OF_SCALE_BAR_THRESHOLD: float = 0.35

    @staticmethod
    def validate_score(score: Score, plan: TheoreticalPlan) -> ValidationReport:
        """
        Audit melodic/harmonic tracks (`track_type != 'drum'`) for:
        - `scale_adherence`: duration-weighted fraction of notes inside `plan.scale_pitches`
        - `voice_leading_score`: smoothness between consecutive chords
        - `out_of_scale_bars`: bar indices where >35% of notes are outside the target scale
        """
        scale_pcs = {int(p) % 12 for p in plan.scale_pitches}
        melodic_tracks = [t for t in score.tracks if getattr(t, "track_type", "melodic") != "drum"]
        drum_tracks = [t for t in score.tracks if getattr(t, "track_type", "melodic") == "drum"]

        if not melodic_tracks:
            if drum_tracks:
                return ValidationReport(
                    is_valid=True,
                    scale_adherence=1.0,
                    voice_leading_score=1.0,
                    out_of_scale_bars=[],
                    warnings=["Only drum tracks present; harmonic scale validation skipped."],
                )
            return ValidationReport(
                is_valid=False,
                scale_adherence=0.0,
                voice_leading_score=0.0,
                out_of_scale_bars=[],
                warnings=["Score contains no tracks or notes to validate."],
            )

        total_weight = 0.0
        in_scale_weight = 0.0
        bar_total_weight: Dict[int, float] = defaultdict(float)
        bar_out_weight: Dict[int, float] = defaultdict(float)

        for track in melodic_tracks:
            for bar_idx, bar in enumerate(track.bars):
                for note in bar.notes:
                    weight = float(max(1, int(note.duration_ticks)))
                    pc = int(note.pitch) % 12
                    total_weight += weight
                    bar_total_weight[bar_idx] += weight
                    if pc in scale_pcs:
                        in_scale_weight += weight
                    else:
                        bar_out_weight[bar_idx] += weight

        if total_weight <= 0.0:
            return ValidationReport(
                is_valid=False,
                scale_adherence=0.0,
                voice_leading_score=0.0,
                out_of_scale_bars=[],
                warnings=["Melodic/harmonic tracks contain zero notes."],
            )

        scale_adherence = round(in_scale_weight / total_weight, 4)

        out_of_scale_bars: List[int] = []
        for bar_idx in sorted(bar_total_weight):
            b_total = bar_total_weight[bar_idx]
            if b_total > 0.0:
                out_ratio = bar_out_weight[bar_idx] / b_total
                if out_ratio > SymbolicValidator.OUT_OF_SCALE_BAR_THRESHOLD:
                    out_of_scale_bars.append(bar_idx)

        voice_leading_score, avg_leap = _compute_voice_leading_score(melodic_tracks)

        warnings: List[str] = []
        if out_of_scale_bars:
            warnings.append(
                f"Bars {out_of_scale_bars} exceed 35% out-of-scale notes for "
                f"{plan.tonic_name} {plan.scale_id} ({plan.camelot_key.value}); "
                "recommended for targeted inpainting."
            )
        if scale_adherence < 0.85:
            warnings.append(
                f"Low scale adherence ({scale_adherence:.1%}) relative to {plan.tonic_name} {plan.scale_id}."
            )
        if voice_leading_score < 0.60:
            warnings.append(
                f"Large average chord/voice leaps ({avg_leap:.2f} semitones; "
                f"voice_leading_score={voice_leading_score:.2f})."
            )

        max_bars = max((len(t.bars) for t in melodic_tracks), default=0)
        if max_bars != plan.total_bars:
            warnings.append(
                f"Score bar count ({max_bars}) differs from planned total_bars ({plan.total_bars})."
            )

        is_valid = len(out_of_scale_bars) == 0 and scale_adherence >= 0.65

        return ValidationReport(
            is_valid=is_valid,
            scale_adherence=scale_adherence,
            voice_leading_score=voice_leading_score,
            out_of_scale_bars=out_of_scale_bars,
            warnings=warnings,
        )
