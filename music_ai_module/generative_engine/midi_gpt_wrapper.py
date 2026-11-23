"""
High-level wrapper around midigpt InferenceEngine.session(...).run()
for multi-track accompaniment generation and bar-range inpainting.
"""

from __future__ import annotations

import copy
from typing import Dict, List, Optional, Tuple

from midigpt import Bar, Note, Score, Track

from music_ai_module.generative_engine.controls_mapper import (
    CANONICAL_ROLE_ORDER,
    ROLE_TO_PROGRAM,
    ControlsMapper,
    _extract_num_bars_map,
    role_for_program,
)
from music_ai_module.generative_engine.model_manager import ModelManager
from music_ai_module.schemas import (
    GenerationRequest,
    TheoreticalPlan,
    TrackRole,
)


def _bar_ticks(bar: Bar, resolution: int) -> int:
    ts_num = getattr(bar, "ts_numerator", 4) or 4
    ts_den = getattr(bar, "ts_denominator", 4) or 4
    return max(1, int(round(resolution * ts_num * (4.0 / ts_den))))


def _resample_score_to_resolution(score: Score, target_resolution: int = 480) -> Score:
    """
    Resample a Score from its current resolution (e.g. 1920 from midigpt decode)
    back to `target_resolution` (e.g. 480 PPQ), folding fractional `delta` into
    integer ticks and resetting `delta=0`.
    """
    src_res = int(getattr(score, "resolution", 480) or 480)
    if src_res == target_resolution and all(
        n.delta == 0 for t in score.tracks for b in t.bars for n in b.notes
    ):
        return copy.deepcopy(score)

    scale = float(target_resolution) / float(src_res)
    new_tracks: List[Track] = []
    for track in score.tracks:
        new_bars: List[Bar] = []
        for bar in track.bars:
            b_ticks = _bar_ticks(bar, target_resolution)
            new_notes: List[Note] = []
            for note in bar.notes:
                true_pos = (float(note.onset_ticks) + float(note.delta) / float(src_res)) * scale
                new_onset = max(0, min(b_ticks - 1, int(round(true_pos))))
                new_dur = max(1, int(round(float(note.duration_ticks) * scale)))
                new_notes.append(
                    Note(
                        pitch=int(note.pitch),
                        velocity=int(note.velocity),
                        onset_ticks=new_onset,
                        duration_ticks=new_dur,
                        delta=0,
                    )
                )
            new_notes.sort(key=lambda n: (n.onset_ticks, n.pitch))
            new_bars.append(
                Bar(
                    notes=new_notes,
                    ts_numerator=bar.ts_numerator,
                    ts_denominator=bar.ts_denominator,
                    beat_length=bar.beat_length,
                    future=bar.future,
                )
            )
        new_tracks.append(
            Track(
                bars=new_bars,
                instrument=track.instrument,
                track_type=track.track_type,
                attributes=dict(track.attributes),
            )
        )
    return Score(tracks=new_tracks, resolution=target_resolution, tempo=score.tempo)


def _pad_score_to_bars(score: Score, target_bars: int, default_ts: Tuple[int, int] = (4, 4)) -> Score:
    """
    Ensure every track in `score` has at least `target_bars` bars by appending empty Bars.
    """
    out = copy.deepcopy(score)
    for track in out.tracks:
        if len(track.bars) >= target_bars:
            continue
        if track.bars:
            ref = track.bars[-1]
            ts_num, ts_den, beat_len = ref.ts_numerator, ref.ts_denominator, ref.beat_length
        else:
            ts_num, ts_den = default_ts
            beat_len = float(ts_num)
        while len(track.bars) < target_bars:
            track.bars.append(
                Bar(
                    notes=[],
                    ts_numerator=ts_num,
                    ts_denominator=ts_den,
                    beat_length=beat_len,
                )
            )
    return out


def _trim_score_to_bars(score: Score, target_bars: int) -> Score:
    """Trim every track in `score` to at most `target_bars` bars."""
    out = copy.deepcopy(score)
    for track in out.tracks:
        track.bars = list(track.bars[:target_bars])
    return out


def _make_empty_track(
    role: TrackRole,
    num_bars: int,
    reference_bars: Optional[List[Bar]] = None,
    default_ts: Tuple[int, int] = (4, 4),
) -> Track:
    bars: List[Bar] = []
    for b_idx in range(num_bars):
        if reference_bars and b_idx < len(reference_bars):
            ref = reference_bars[b_idx]
            ts_num, ts_den, beat_len = ref.ts_numerator, ref.ts_denominator, ref.beat_length
        else:
            ts_num, ts_den = default_ts
            beat_len = float(ts_num)
        bars.append(
            Bar(
                notes=[],
                ts_numerator=ts_num,
                ts_denominator=ts_den,
                beat_length=beat_len,
            )
        )
    if role == TrackRole.DRUMS:
        return Track(bars=bars, instrument=0, track_type="drum")
    return Track(bars=bars, instrument=ROLE_TO_PROGRAM.get(role, 0), track_type="melodic")


class MidiGPTWrapper:
    """
    Orchestrates midigpt SamplingSession calls for accompaniment generation and bar inpainting.
    """

    def __init__(
        self,
        model_manager: Optional[ModelManager] = None,
        controls_mapper: Optional[ControlsMapper] = None,
    ) -> None:
        self.model_manager = model_manager or ModelManager.get_instance()
        self.controls_mapper = controls_mapper or ControlsMapper()

    @staticmethod
    def _infer_track_roles(score: Score, request: GenerationRequest) -> List[TrackRole]:
        roles: List[TrackRole] = []
        input_tracks = request.input_tracks
        for idx, track in enumerate(score.tracks):
            if idx < len(input_tracks):
                in_role = input_tracks[idx].role
                is_drum = track.track_type == "drum"
                if (in_role == TrackRole.DRUMS) == is_drum:
                    roles.append(in_role)
                    continue
            roles.append(role_for_program(track.instrument, track.track_type))
        return roles

    def accompany(
        self,
        score: Score,
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
    ) -> Tuple[Score, List[TrackRole]]:
        """
        Keep existing context tracks intact (or complete their empty bars if targeted),
        add any missing target tracks, run MIDI-GPT inference, and return `(Score, List[TrackRole])`.
        """
        work_score = copy.deepcopy(score)
        original_resolution = int(getattr(work_score, "resolution", 480) or 480)

        ts_num, ts_den = (
            (request.time_signature[0], request.time_signature[1])
            if len(request.time_signature) >= 2
            else (4, 4)
        )
        req_bars = sum(request.section_lengths) if request.section_lengths else 4
        original_bars = max(
            (len(t.bars) for t in work_score.tracks),
            default=max(1, req_bars),
        )
        work_score = _pad_score_to_bars(work_score, original_bars, default_ts=(ts_num, ts_den))

        track_roles = self._infer_track_roles(work_score, request)

        # Resolve ordered list of target roles
        target_roles: List[TrackRole] = list(request.target_tracks)
        if not target_roles and plan is not None and plan.target_roles_order:
            target_roles = list(plan.target_roles_order)
        if request.generate_melody and TrackRole.MELODY not in target_roles:
            target_roles.append(TrackRole.MELODY)
        if not target_roles:
            target_roles = [TrackRole.CHORDS, TrackRole.BASS]

        # Append missing target tracks in canonical order first, then any custom ordering
        ordered_missing = [r for r in CANONICAL_ROLE_ORDER if r in target_roles and r not in track_roles]
        for r in target_roles:
            if r not in track_roles and r not in ordered_missing:
                ordered_missing.append(r)

        ref_bars = work_score.tracks[0].bars if work_score.tracks else None
        for role in ordered_missing:
            work_score.tracks.append(
                _make_empty_track(
                    role=role,
                    num_bars=original_bars,
                    reference_bars=ref_bars,
                    default_ts=(ts_num, ts_den),
                )
            )
            track_roles.append(role)

        # Determine which bars need generation per track index
        bars_per_track: Dict[int, List[int]] = {}
        target_set = set(target_roles)
        for idx, role in enumerate(track_roles):
            if role not in target_set:
                bars_per_track[idx] = []
                continue
            track = work_score.tracks[idx]
            empty_bars = [b_i for b_i, bar in enumerate(track.bars) if len(bar.notes) == 0]
            if 0 < len(empty_bars) < len(track.bars):
                # Preserve existing seed/context bars and only fill empty bars
                bars_per_track[idx] = empty_bars
            else:
                # Either completely empty or explicitly requested for full regeneration
                bars_per_track[idx] = list(range(original_bars))

        engine = self.model_manager.get_engine(request.model_name)
        encoder_config = engine._tokenizer._vocab.config()
        analyzer = engine._analyzer

        nb_map = _extract_num_bars_map(encoder_config, request.model_name)
        min_window = min(nb_map) if nb_map else 4
        inference_bars = original_bars
        if original_bars < min_window:
            inference_bars = min_window
            work_score = _pad_score_to_bars(work_score, inference_bars, default_ts=(ts_num, ts_den))
            extra_bars = list(range(original_bars, inference_bars))
            for idx, b_list in list(bars_per_track.items()):
                if b_list:
                    bars_per_track[idx] = sorted(set(b_list) | set(extra_bars))

        midigpt_req = self.controls_mapper.build_midigpt_request(
            track_roles=track_roles,
            bars_per_track=bars_per_track,
            request=request,
            plan=plan,
            total_bars=inference_bars,
            encoder_config=encoder_config,
            analyzer=analyzer,
        )

        result_score = engine.session(work_score, midigpt_req).run()
        if inference_bars != original_bars:
            result_score = _trim_score_to_bars(result_score, original_bars)
        result_score = _resample_score_to_resolution(result_score, original_resolution)
        return result_score, track_roles

    def inpaint(
        self,
        score: Score,
        track_roles: List[TrackRole],
        start_bar: int,
        end_bar: int,
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
    ) -> Score:
        """
        Regenerate only bars in `range(start_bar, end_bar)` for the targeted tracks,
        preserving all surrounding bars and non-targeted tracks intact.
        """
        if start_bar < 0:
            raise ValueError(f"start_bar must be >= 0 (got {start_bar})")
        if end_bar <= start_bar:
            raise ValueError(f"end_bar ({end_bar}) must be > start_bar ({start_bar})")

        work_score = copy.deepcopy(score)
        original_resolution = int(getattr(work_score, "resolution", 480) or 480)
        ts_num, ts_den = (
            (request.time_signature[0], request.time_signature[1])
            if len(request.time_signature) >= 2
            else (4, 4)
        )
        original_bars = max((len(t.bars) for t in work_score.tracks), default=0)
        if original_bars == 0 or not work_score.tracks:
            return work_score

        clamped_end = min(end_bar, original_bars)
        if start_bar >= clamped_end:
            return work_score

        work_score = _pad_score_to_bars(work_score, original_bars, default_ts=(ts_num, ts_den))

        resolved_roles: List[TrackRole] = [
            track_roles[i]
            if i < len(track_roles)
            else role_for_program(t.instrument, t.track_type)
            for i, t in enumerate(work_score.tracks)
        ]

        if request.inpaint_range is not None and request.inpaint_range.roles:
            target_roles = set(request.inpaint_range.roles)
        elif request.target_tracks:
            target_roles = set(request.target_tracks)
        else:
            target_roles = set(resolved_roles)

        target_bars = list(range(start_bar, clamped_end))
        bars_per_track: Dict[int, List[int]] = {
            idx: (list(target_bars) if role in target_roles else [])
            for idx, role in enumerate(resolved_roles)
        }
        if not any(bars_per_track.values()):
            # Fallback: if none matched, inpaint all tracks in range
            bars_per_track = {idx: list(target_bars) for idx in range(len(resolved_roles))}

        engine = self.model_manager.get_engine(request.model_name)
        encoder_config = engine._tokenizer._vocab.config()
        analyzer = engine._analyzer

        nb_map = _extract_num_bars_map(encoder_config, request.model_name)
        min_window = min(nb_map) if nb_map else 4
        inference_bars = original_bars
        if original_bars < min_window:
            inference_bars = min_window
            work_score = _pad_score_to_bars(work_score, inference_bars, default_ts=(ts_num, ts_den))

        midigpt_req = self.controls_mapper.build_midigpt_request(
            track_roles=resolved_roles,
            bars_per_track=bars_per_track,
            request=request,
            plan=plan,
            total_bars=inference_bars,
            encoder_config=encoder_config,
            analyzer=analyzer,
        )

        result_score = engine.session(work_score, midigpt_req).run()
        if inference_bars != original_bars:
            result_score = _trim_score_to_bars(result_score, original_bars)
        return _resample_score_to_resolution(result_score, original_resolution)

    def generate(
        self,
        request: GenerationRequest,
        plan: Optional[TheoreticalPlan] = None,
    ) -> Tuple[Score, List[TrackRole]]:
        """
        Convenience entry point to generate directly from a GenerationRequest
        (builds an empty or input-seeded Score, then delegates to `accompany`).
        """
        from music_ai_module.io_bridge.app_exporter import AppExporter

        score, _ = AppExporter.request_to_score(request)
        return self.accompany(score, request, plan)
