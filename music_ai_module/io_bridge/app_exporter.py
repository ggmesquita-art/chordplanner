"""
Exports ChordPlanner GenerationRequest payloads into skill context dictionaries
and aligned midigpt.Score objects (PPQ = 480).
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from midigpt import Bar, Note, Score, Track

from music_ai_module.generative_engine.controls_mapper import (
    ROLE_TO_PROGRAM,
    resolve_scale_pitch_classes,
)
from music_ai_module.schemas import (
    GenerationRequest,
    TrackRole,
    camelot_to_tonic_scale,
)

APP_PPQ = 480


class AppExporter:
    """
    Converts ChordPlanner GenerationRequest objects into symbolic context and midigpt.Score.
    """

    @staticmethod
    def request_to_skill_context(request: GenerationRequest) -> Dict[str, object]:
        """
        Build a structured dictionary summarizing the musical theory and arrangement
        context of a GenerationRequest for the symbolic planner / skill loader.
        """
        cam_tonic, cam_name, cam_scale = camelot_to_tonic_scale(request.camelot_key)
        tonic_pc = int(request.tonic_pc) % 12 if request.tonic_pc is not None else cam_tonic
        scale_id = (request.scale_id or cam_scale).strip().lower()
        scale_pitches = resolve_scale_pitch_classes(request)

        ts_num, ts_den = (
            (int(request.time_signature[0]), int(request.time_signature[1]))
            if len(request.time_signature) >= 2
            else (4, 4)
        )
        total_bars = max(1, sum(request.section_lengths) if request.section_lengths else 4)

        input_chords: List[str] = []
        for tr in request.input_tracks:
            if tr.chord_symbols:
                input_chords.extend(tr.chord_symbols)

        return {
            "bpm": request.bpm,
            "time_signature": [ts_num, ts_den],
            "camelot_key": request.camelot_key.value,
            "tonic_pc": tonic_pc,
            "tonic_name": cam_name,
            "scale_id": scale_id,
            "scale_pitches": scale_pitches,
            "genre": request.genre,
            "style_prompt": request.style_prompt,
            "form_structure": list(request.form_structure),
            "section_lengths": list(request.section_lengths),
            "total_bars": total_bars,
            "target_tracks": [r.value for r in request.target_tracks],
            "generate_melody": request.generate_melody,
            "input_chord_symbols": input_chords,
            "density": dict(request.density),
            "polyphony": dict(request.polyphony),
            "note_duration": dict(request.note_duration),
            "use_velocity": request.use_velocity,
            "use_microtiming": request.use_microtiming,
            "model_name": request.model_name,
        }

    @staticmethod
    def request_to_score(request: GenerationRequest) -> Tuple[Score, List[TrackRole]]:
        """
        Convert `request.input_tracks` into an aligned `midigpt.Score` with
        `resolution = 480` and `total_bars` bars per track.
        """
        resolution = APP_PPQ
        tempo = int(round(60_000_000 / max(1, request.bpm)))
        ts_num, ts_den = (
            (int(request.time_signature[0]), int(request.time_signature[1]))
            if len(request.time_signature) >= 2
            else (4, 4)
        )
        bar_ticks = max(1, int(round(resolution * ts_num * (4.0 / ts_den))))
        total_bars = max(1, sum(request.section_lengths) if request.section_lengths else 4)

        tracks: List[Track] = []
        track_roles: List[TrackRole] = []

        for track_in in request.input_tracks:
            bars: List[Bar] = [
                Bar(
                    notes=[],
                    ts_numerator=ts_num,
                    ts_denominator=ts_den,
                    beat_length=float(ts_num),
                )
                for _ in range(total_bars)
            ]

            for note_ev in track_in.notes:
                bar_idx = int(note_ev.start_tick // bar_ticks)
                if 0 <= bar_idx < total_bars:
                    onset_in_bar = int(note_ev.start_tick % bar_ticks)
                    dur = max(1, int(note_ev.end_tick - note_ev.start_tick))
                    bars[bar_idx].notes.append(
                        Note(
                            pitch=int(note_ev.pitch),
                            velocity=int(note_ev.velocity),
                            onset_ticks=onset_in_bar,
                            duration_ticks=dur,
                            delta=0,
                        )
                    )

            for b in bars:
                b.notes.sort(key=lambda n: (n.onset_ticks, n.pitch))

            is_drum = track_in.role == TrackRole.DRUMS or track_in.program == 128
            if is_drum:
                tracks.append(Track(bars=bars, instrument=0, track_type="drum"))
            else:
                prog = (
                    int(track_in.program)
                    if 0 <= int(track_in.program) <= 127
                    else ROLE_TO_PROGRAM.get(track_in.role, 0)
                )
                tracks.append(Track(bars=bars, instrument=prog, track_type="melodic"))

            track_roles.append(track_in.role)

        score = Score(tracks=tracks, resolution=resolution, tempo=tempo)
        return score, track_roles
