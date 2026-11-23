"""
PrimerBuilder: Executes LLM/planner-generated primer code in an isolated
subprocess or constructs a deterministic `midigpt.Score` directly in Python.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional, Union

from midigpt import Bar, Note, Score, Track

from music_ai_module.schemas import (
    GenerationRequest,
    TheoreticalPlan,
    TrackRole,
)
from music_ai_module.symbolic_engine.llm_planner import (
    build_bass_notes_for_bar,
    voice_chord,
)

logger = logging.getLogger(__name__)


def _normalize_score(score: Score) -> Score:
    """
    Ensure every Bar has an accurate `beat_length` matching its time signature
    (since `midigpt.Score.from_dict` defaults beat_length to 4.0) and every Note
    has bar-relative `0 <= onset_ticks < bar_ticks`.
    """
    resolution = max(1, int(score.resolution or 480))
    for track in score.tracks:
        for bar in track.bars:
            ts_num = max(1, int(bar.ts_numerator or 4))
            ts_den = max(1, int(bar.ts_denominator or 4))
            bar.beat_length = ts_num * (4.0 / ts_den)
            bar_ticks = max(1, int(round(resolution * bar.beat_length)))
            for note in bar.notes:
                note.pitch = max(0, min(127, int(note.pitch)))
                note.velocity = max(1, min(127, int(note.velocity)))
                note.onset_ticks = max(0, min(bar_ticks - 1, int(note.onset_ticks)))
                note.duration_ticks = max(1, int(note.duration_ticks))
            bar.notes.sort(key=lambda n: (n.onset_ticks, n.pitch))
    return score


class PrimerBuilder:
    """
    Builds `midigpt.Score` primer objects either by safely executing generated
    `build_primer()` code in an isolated subprocess or deterministically.
    """

    @staticmethod
    def execute_primer_code(
        python_code: str,
        fallback_request: Optional[GenerationRequest] = None,
        plan: Optional[TheoreticalPlan] = None,
        timeout_sec: int = 20,
    ) -> Score:
        """
        Execute `python_code` in an isolated Python subprocess (`timeout=20s`)
        that invokes `build_primer() -> dict`, validates the returned schema,
        and converts it into a `midigpt.Score`.
        """
        if not python_code or "build_primer" not in python_code:
            if fallback_request is not None and plan is not None:
                logger.warning("Primer code missing build_primer(); using deterministic builder.")
                return PrimerBuilder.build_primer_score_deterministic(fallback_request, plan)
            raise RuntimeError("Invalid primer_python_code: missing `build_primer()` definition.")

        with tempfile.TemporaryDirectory(prefix="midigpt_primer_") as tmpdir:
            tmp_path = Path(tmpdir)
            user_mod_path = tmp_path / "primer_module.py"
            runner_path = tmp_path / "runner.py"
            output_json_path = tmp_path / "primer_output.json"

            user_mod_path.write_text(python_code, encoding="utf-8")

            runner_code = (
                "import json\n"
                "import sys\n"
                "from pathlib import Path\n"
                f"sys.path.insert(0, {repr(str(tmp_path))})\n"
                "import primer_module\n\n"
                "def main():\n"
                "    if not hasattr(primer_module, 'build_primer'):\n"
                "        raise RuntimeError('build_primer() function not found')\n"
                "    data = primer_module.build_primer()\n"
                "    if not isinstance(data, dict):\n"
                "        raise TypeError(f'build_primer() must return dict, got {type(data).__name__}')\n"
                "    if 'tracks' not in data or not isinstance(data['tracks'], list):\n"
                "        raise ValueError('build_primer() dict must contain a tracks list')\n"
                f"    Path({repr(str(output_json_path))}).write_text(json.dumps(data), encoding='utf-8')\n\n"
                "if __name__ == '__main__':\n"
                "    main()\n"
            )
            runner_path.write_text(runner_code, encoding="utf-8")

            try:
                proc = subprocess.run(
                    [sys.executable, str(runner_path)],
                    capture_output=True,
                    text=True,
                    timeout=timeout_sec,
                    cwd=str(tmp_path),
                )
                if proc.returncode != 0:
                    raise RuntimeError(
                        f"Primer subprocess failed (exit={proc.returncode}): {proc.stderr.strip()}"
                    )
                if not output_json_path.is_file():
                    raise RuntimeError("Primer subprocess did not emit output JSON.")

                score_dict = json.loads(output_json_path.read_text(encoding="utf-8"))
                score = Score.from_dict(score_dict)
                return _normalize_score(score)
            except Exception as exc:
                if fallback_request is not None and plan is not None:
                    logger.warning(
                        "Primer execution failed (%s); falling back to deterministic builder.",
                        exc,
                    )
                    return PrimerBuilder.build_primer_score_deterministic(fallback_request, plan)
                raise RuntimeError(f"Primer execution failed: {exc}") from exc

    @staticmethod
    def build_primer_score_deterministic(
        request: GenerationRequest,
        plan: TheoreticalPlan,
    ) -> Score:
        """
        Pure-Python deterministic construction of a `midigpt.Score` with:
        - resolution=480 and tempo=int(60_000_000 / bpm)
        - user `input_tracks` mapped with bar-relative `onset_ticks`
        - voice-led chords (`drop2`, `shell`, or `close`)
        - functional bass line (root, fifth, approach note)
        """
        resolution = 480
        tempo = int(round(60_000_000 / max(1, request.bpm)))
        total_bars = max(1, plan.total_bars or sum(request.section_lengths) or 4)
        ts_num = request.time_signature[0] if len(request.time_signature) >= 1 else 4
        ts_den = request.time_signature[1] if len(request.time_signature) >= 2 else 4
        beat_length = ts_num * (4.0 / ts_den)
        bar_ticks = max(1, int(round(resolution * beat_length)))

        progression = list(plan.chord_progression_per_bar)
        if not progression:
            progression = [f"{plan.tonic_name}{'m' if 'min' in plan.scale_id else ''}"]
        while len(progression) < total_bars:
            progression.append(progression[len(progression) % len(progression)])
        progression = progression[:total_bars]

        score = Score(resolution=resolution, tempo=tempo)
        has_chords_input = False
        has_bass_input = False

        for ti in request.input_tracks:
            if ti.role == TrackRole.CHORDS:
                has_chords_input = True
            elif ti.role == TrackRole.BASS:
                has_bass_input = True

            bars: List[Bar] = [
                Bar(
                    notes=[],
                    ts_numerator=ts_num,
                    ts_denominator=ts_den,
                    beat_length=beat_length,
                    future=False,
                )
                for _ in range(total_bars)
            ]

            for ev in ti.notes:
                bar_idx = ev.start_tick // bar_ticks
                if 0 <= bar_idx < total_bars:
                    onset_in_bar = ev.start_tick % bar_ticks
                    dur = max(1, ev.end_tick - ev.start_tick)
                    bars[bar_idx].notes.append(
                        Note(
                            pitch=max(0, min(127, int(ev.pitch))),
                            velocity=max(1, min(127, int(ev.velocity))),
                            onset_ticks=int(onset_in_bar),
                            duration_ticks=int(dur),
                            delta=0,
                        )
                    )

            # Fill empty bars on a partial CHORDS track with voice-led progression
            if ti.role == TrackRole.CHORDS:
                last_voicing: Optional[List[int]] = None
                dur = max(1, int(round(bar_ticks * 0.9)))
                for b_idx in range(total_bars):
                    if bars[b_idx].notes:
                        last_voicing = sorted({n.pitch for n in bars[b_idx].notes})
                    else:
                        voicing = voice_chord(
                            progression[b_idx],
                            style=plan.voice_leading_style,
                            prev_voicing=last_voicing,
                        )
                        last_voicing = voicing
                        for p in voicing:
                            bars[b_idx].notes.append(
                                Note(
                                    pitch=max(0, min(127, int(p))),
                                    velocity=78,
                                    onset_ticks=0,
                                    duration_ticks=dur,
                                    delta=0,
                                )
                            )

            for bar in bars:
                bar.notes.sort(key=lambda n: (n.onset_ticks, n.pitch))

            score.tracks.append(
                Track(
                    bars=bars,
                    instrument=int(ti.program),
                    track_type="drum" if ti.role == TrackRole.DRUMS else "melodic",
                )
            )

        # Build primer chords track if user didn't provide one
        if not has_chords_input:
            chord_bars: List[Bar] = []
            prev_voicing: Optional[List[int]] = None
            dur = max(1, int(round(bar_ticks * 0.9)))
            for b_idx in range(total_bars):
                voicing = voice_chord(
                    progression[b_idx],
                    style=plan.voice_leading_style,
                    prev_voicing=prev_voicing,
                )
                prev_voicing = voicing
                notes = [
                    Note(
                        pitch=max(0, min(127, int(p))),
                        velocity=78,
                        onset_ticks=0,
                        duration_ticks=dur,
                        delta=0,
                    )
                    for p in voicing
                ]
                chord_bars.append(
                    Bar(
                        notes=notes,
                        ts_numerator=ts_num,
                        ts_denominator=ts_den,
                        beat_length=beat_length,
                        future=False,
                    )
                )
            score.tracks.append(Track(bars=chord_bars, instrument=0, track_type="melodic"))

        # Build functional bass primer track if targeted or no input tracks were supplied
        wants_bass = TrackRole.BASS in plan.target_roles_order or not request.input_tracks
        if not has_bass_input and wants_bass:
            bass_instrument = 32 if "jazz" in plan.genre.lower() else 33
            bass_bars: List[Bar] = []
            for b_idx in range(total_bars):
                next_sym = progression[b_idx + 1] if b_idx + 1 < total_bars else progression[0]
                raw_notes = build_bass_notes_for_bar(
                    symbol=progression[b_idx],
                    next_symbol=next_sym,
                    bar_ticks=bar_ticks,
                    groove_style=plan.groove_style,
                    velocity=84,
                )
                notes = [
                    Note(
                        pitch=max(0, min(127, int(nd["pitch"]))),
                        velocity=max(1, min(127, int(nd["velocity"]))),
                        onset_ticks=int(nd["onset_ticks"]),
                        duration_ticks=max(1, int(nd["duration_ticks"])),
                        delta=0,
                    )
                    for nd in raw_notes
                ]
                bass_bars.append(
                    Bar(
                        notes=notes,
                        ts_numerator=ts_num,
                        ts_denominator=ts_den,
                        beat_length=beat_length,
                        future=False,
                    )
                )
            score.tracks.append(
                Track(bars=bass_bars, instrument=bass_instrument, track_type="melodic")
            )

        return _normalize_score(score)

    @staticmethod
    def save_primer_midi(score: Score, output_path: Union[str, Path]) -> Path:
        """
        Export a `midigpt.Score` to a standard `.mid` file on disk.
        """
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        _normalize_score(score).to_midi(str(out))
        return out
