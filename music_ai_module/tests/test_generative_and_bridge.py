"""
Tests for music_ai_module.generative_engine and music_ai_module.io_bridge,
including real end-to-end MIDI-GPT 0.4.2 inference with local HF cache checkpoints.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from midigpt import Bar, Note, Score, Track

from music_ai_module.generative_engine import (
    ROLE_PITCH_RANGES,
    ROLE_TO_PROGRAM,
    VALID_GENRES,
    ControlsMapper,
    MidiGPTWrapper,
    ModelManager,
    choose_model_dim,
    normalize_genre,
)
from music_ai_module.io_bridge import APP_PPQ, AppExporter, AppImporter
from music_ai_module.schemas import (
    CamelotKey,
    GenerationRequest,
    InpaintRange,
    NoteEvent,
    TheoreticalPlan,
    TrackInput,
    TrackRole,
)

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "sample_request.json"


def _make_sample_plan(total_bars: int = 4) -> TheoreticalPlan:
    return TheoreticalPlan(
        camelot_key=CamelotKey._8A,
        tonic_pc=9,
        tonic_name="A",
        scale_id="minor",
        scale_pitches=[9, 11, 0, 2, 4, 5, 7],
        genre="pop",
        total_bars=total_bars,
        chord_progression_per_bar=["Am", "F", "C", "G"][:total_bars],
        voice_leading_style="drop2",
        groove_style="straight",
        target_roles_order=[TrackRole.CHORDS, TrackRole.BASS],
        primer_python_code="def build_primer(): pass",
        theoretical_explanation="A minor pop progression i - VI - III - VII",
    )


def test_model_manager_singleton_and_discovery() -> None:
    m1 = ModelManager()
    m2 = ModelManager.get_instance()
    assert m1 is m2
    assert m1.device in ("cpu", "cuda")
    assert isinstance(m1.get_vram_usage(), float)
    assert m1.get_vram_usage() >= 0.0

    models = m1.list_available_models()
    names = {m["name"] for m in models}
    assert {"expressive_medium", "yellow_small"}.issubset(names)
    for info in models:
        assert Path(info["path"]).is_file()
        assert info["size_mb"] > 0.0


def test_controls_mapper_mappings_and_genre() -> None:
    assert ROLE_TO_PROGRAM == {
        TrackRole.CHORDS: 0,
        TrackRole.BASS: 33,
        TrackRole.DRUMS: 128,
        TrackRole.PAD: 88,
        TrackRole.MELODY: 80,
    }
    assert ROLE_PITCH_RANGES[TrackRole.BASS] == (28, 55)
    assert ROLE_PITCH_RANGES[TrackRole.CHORDS] == (48, 76)
    assert ROLE_PITCH_RANGES[TrackRole.PAD] == (48, 84)
    assert ROLE_PITCH_RANGES[TrackRole.MELODY] == (60, 84)

    for g in VALID_GENRES:
        assert normalize_genre(g) == g
    assert normalize_genre("EDM") == "dance-electronic"
    assert normalize_genre("Bossa Nova") == "latin"
    assert normalize_genre("Lo-Fi") == "hip-hop"
    assert normalize_genre("unknown_xyz_style") == "pop"

    assert choose_model_dim(2, [4, 8, 12, 16]) == 4
    assert choose_model_dim(4, [4, 8, 12, 16]) == 4
    assert choose_model_dim(10, [4, 8, 12, 16]) == 8
    assert choose_model_dim(16, [4, 8, 12, 16]) == 16

    mapper = ControlsMapper()
    req = GenerationRequest(
        camelot_key=CamelotKey._8B,
        tonic_pc=0,
        scale_id="major",
        genre="EDM",
        model_name="expressive_medium",
        target_tracks=[TrackRole.BASS, TrackRole.DRUMS],
    )
    plan = TheoreticalPlan(
        camelot_key=CamelotKey._8B,
        tonic_pc=0,
        tonic_name="C",
        scale_id="major",
        scale_pitches=[0, 2, 4, 5, 7, 9, 11],
        genre="EDM",
        total_bars=4,
        chord_progression_per_bar=["C", "G", "Am", "F"],
        target_roles_order=[TrackRole.BASS, TrackRole.DRUMS],
        primer_python_code="",
    )
    midigpt_req = mapper.build_midigpt_request(
        track_roles=[TrackRole.MELODY, TrackRole.BASS, TrackRole.DRUMS],
        bars_per_track={0: [], 1: [0, 1, 2, 3], 2: [0, 1, 2, 3]},
        request=req,
        plan=plan,
        total_bars=4,
    )
    assert midigpt_req.controls["genre"] == "dance-electronic"
    assert midigpt_req.controls["velocity"] is True
    assert midigpt_req.controls["microtiming"] is True

    # Context track 0 has no bars
    assert midigpt_req.tracks[0].bars == []
    assert midigpt_req.tracks[0].ignore is False
    # Bass track 1 has pitch_mask with C major scale and bass range
    bass_pm = midigpt_req.tracks[1].controls["pitch_mask"]
    assert bass_pm["pitch_classes"] == [0, 2, 4, 5, 7, 9, 11]
    assert bass_pm["shape"] == {"type": "uniform", "min": 28, "max": 55}
    # Drums track 2 MUST NOT have pitch_mask
    assert "pitch_mask" not in midigpt_req.tracks[2].controls


def test_app_exporter_and_importer_roundtrip_with_chords() -> None:
    req = GenerationRequest(
        bpm=120,
        time_signature=[4, 4],
        camelot_key=CamelotKey._8B,
        tonic_pc=0,
        scale_id="major",
        genre="jazz",
        section_lengths=[6],
        input_tracks=[
            TrackInput(
                role=TrackRole.MELODY,
                program=80,
                notes=[
                    NoteEvent(pitch=72, start_tick=0, end_tick=480, velocity=90),
                    NoteEvent(pitch=74, start_tick=1920, end_tick=2400, velocity=85),
                ],
            ),
            TrackInput(
                role=TrackRole.DRUMS,
                program=128,
                notes=[
                    NoteEvent(pitch=36, start_tick=0, end_tick=240, velocity=100),
                ],
            ),
        ],
    )
    ctx = AppExporter.request_to_skill_context(req)
    assert ctx["camelot_key"] == "8B"
    assert ctx["tonic_pc"] == 0
    assert ctx["total_bars"] == 6
    assert ctx["scale_pitches"] == [0, 2, 4, 5, 7, 9, 11]

    score, roles = AppExporter.request_to_score(req)
    assert score.resolution == APP_PPQ
    assert roles == [TrackRole.MELODY, TrackRole.DRUMS]
    assert len(score.tracks) == 2
    assert len(score.tracks[0].bars) == 6
    assert score.tracks[0].bars[0].notes[0].onset_ticks == 0
    assert score.tracks[0].bars[1].notes[0].onset_ticks == 0
    assert score.tracks[1].track_type == "drum"
    assert score.tracks[1].instrument == 0

    # Verify delta handling and chord extraction on a 6-bar synthetic CHORDS track
    chord_bars = [
        Bar(notes=[Note(pitch=p, velocity=80, onset_ticks=0, duration_ticks=1920, delta=0) for p in pitches])
        for pitches in (
            [60, 64, 67, 71],  # Cmaj7
            [57, 60, 64, 67],  # Am7
            [50, 53, 57, 60],  # Dm7
            [55, 59, 62, 65],  # G7
            [53, 56, 60],      # Fm
            [51, 55, 58],      # Eb
        )
    ]
    # Add delta=10 on bar 0 first note of melody to verify start_tick = bar_idx * bar_ticks + onset + delta
    score.tracks[0].bars[0].notes[0].delta = 10
    score_with_chords = Score(
        tracks=[score.tracks[0], Track(bars=chord_bars, instrument=0, track_type="melodic"), score.tracks[1]],
        resolution=480,
        tempo=score.tempo,
    )
    imported = AppImporter.score_to_app_tracks(
        score_with_chords,
        [TrackRole.MELODY, TrackRole.CHORDS, TrackRole.DRUMS],
        req.input_tracks,
    )
    assert len(imported) == 3
    assert imported[0].notes[0].start_tick == 10
    assert imported[0].notes[1].start_tick == 1920
    assert imported[2].program == 128

    extracted_symbols = [ev.symbol for ev in imported[1].chord_symbols]
    assert extracted_symbols == ["Cmaj7", "Am7", "Dm7", "G7", "Fm", "Eb"]


def test_real_midigpt_accompany_expressive_medium() -> None:
    """
    End-to-end real inference with local `expressive_medium` checkpoint:
    keeps user melody intact, generates CHORDS and BASS, and extracts chord_symbols.
    """
    raw = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    # Build a request with melody input and CHORDS + BASS targets using expressive_medium
    raw["input_tracks"] = [
        {
            "role": "melody",
            "program": 80,
            "notes": [
                {"pitch": 69, "start_tick": 0, "end_tick": 480, "velocity": 85},
                {"pitch": 72, "start_tick": 480, "end_tick": 960, "velocity": 82},
                {"pitch": 76, "start_tick": 960, "end_tick": 1920, "velocity": 88},
                {"pitch": 65, "start_tick": 1920, "end_tick": 2880, "velocity": 84},
                {"pitch": 67, "start_tick": 3840, "end_tick": 4800, "velocity": 86},
                {"pitch": 69, "start_tick": 5760, "end_tick": 7200, "velocity": 90},
            ],
            "chord_symbols": [],
        }
    ]
    req = GenerationRequest.model_validate_json(json.dumps(raw))
    plan = _make_sample_plan(total_bars=4)

    score, _ = AppExporter.request_to_score(req)
    wrapper = MidiGPTWrapper()
    out_score, out_roles = wrapper.accompany(score, req, plan=plan)

    assert out_roles == [TrackRole.MELODY, TrackRole.CHORDS, TrackRole.BASS]
    assert out_score.resolution == APP_PPQ
    assert len(out_score.tracks) == 3
    assert all(len(t.bars) == 4 for t in out_score.tracks)

    # Original melody track preserved
    mel_notes = [n for b in out_score.tracks[0].bars for n in b.notes]
    assert len(mel_notes) == 6

    # Chords and Bass generated with notes
    chord_notes = [n for b in out_score.tracks[1].bars for n in b.notes]
    bass_notes = [n for b in out_score.tracks[2].bars for n in b.notes]
    assert len(chord_notes) > 0
    assert len(bass_notes) > 0

    # Verify pitch_mask register constraints were respected
    assert all(48 <= n.pitch <= 76 for n in chord_notes)
    assert all(28 <= n.pitch <= 55 for n in bass_notes)

    app_tracks = AppImporter.score_to_app_tracks(out_score, out_roles, req.input_tracks, plan=plan)
    assert len(app_tracks) == 3
    assert len(app_tracks[1].chord_symbols) > 0
    assert all(ev.end_tick > ev.start_tick for ev in app_tracks[1].chord_symbols)


def test_real_midigpt_drums_and_short_bar_padding() -> None:
    """
    End-to-end real inference with `yellow_small` on a 2-bar request (tests padding to 4 bars
    and trimming back to 2 bars) including DRUMS track generation.
    """
    req = GenerationRequest(
        bpm=110,
        time_signature=[4, 4],
        camelot_key=CamelotKey._8A,
        tonic_pc=9,
        scale_id="minor",
        genre="rock",
        section_lengths=[2],
        input_tracks=[
            TrackInput(
                role=TrackRole.MELODY,
                program=80,
                notes=[
                    NoteEvent(pitch=69, start_tick=0, end_tick=960, velocity=85),
                    NoteEvent(pitch=71, start_tick=1920, end_tick=2880, velocity=85),
                ],
            )
        ],
        target_tracks=[TrackRole.CHORDS, TrackRole.DRUMS],
        seed=7,
        model_name="yellow_small",
    )
    score, _ = AppExporter.request_to_score(req)
    assert len(score.tracks[0].bars) == 2

    wrapper = MidiGPTWrapper()
    out_score, out_roles = wrapper.accompany(score, req)

    assert out_roles == [TrackRole.MELODY, TrackRole.CHORDS, TrackRole.DRUMS]
    assert all(len(t.bars) == 2 for t in out_score.tracks)
    assert out_score.tracks[2].track_type == "drum"
    assert sum(len(b.notes) for b in out_score.tracks[1].bars) > 0
    assert sum(len(b.notes) for b in out_score.tracks[2].bars) > 0

    app_tracks = AppImporter.score_to_app_tracks(out_score, out_roles, req.input_tracks)
    assert app_tracks[2].role == TrackRole.DRUMS
    assert app_tracks[2].program == 128
    assert all(n.end_tick <= 2 * 4 * APP_PPQ + 1920 for n in app_tracks[2].notes)


def test_real_midigpt_inpaint_preserves_boundary_bars() -> None:
    """
    Verify `MidiGPTWrapper.inpaint` regenerates only [start_bar, end_bar) while
    leaving surrounding bars untouched.
    """
    mel_bars = [
        Bar(notes=[Note(pitch=69, velocity=80, onset_ticks=0, duration_ticks=480)])
        for _ in range(4)
    ]
    chord_bars = [
        Bar(notes=[Note(pitch=p, velocity=80, onset_ticks=0, duration_ticks=960) for p in (57, 60, 64)])
        for _ in range(4)
    ]
    score = Score(
        tracks=[
            Track(bars=mel_bars, instrument=80, track_type="melodic"),
            Track(bars=chord_bars, instrument=0, track_type="melodic"),
        ],
        resolution=480,
        tempo=500000,
    )
    roles = [TrackRole.MELODY, TrackRole.CHORDS]
    req = GenerationRequest(
        camelot_key=CamelotKey._8A,
        tonic_pc=9,
        scale_id="minor",
        section_lengths=[4],
        target_tracks=[TrackRole.CHORDS],
        inpaint_range=InpaintRange(start_bar=1, end_bar=3, roles=[TrackRole.CHORDS]),
        seed=99,
        model_name="yellow_small",
    )

    wrapper = MidiGPTWrapper()
    inpainted = wrapper.inpaint(score, roles, start_bar=1, end_bar=3, request=req)

    # Boundary bars 0 and 3 on CHORDS must remain exact
    assert [(n.pitch, n.onset_ticks, n.duration_ticks) for n in inpainted.tracks[1].bars[0].notes] == [
        (57, 0, 960),
        (60, 0, 960),
        (64, 0, 960),
    ]
    assert [(n.pitch, n.onset_ticks, n.duration_ticks) for n in inpainted.tracks[1].bars[3].notes] == [
        (57, 0, 960),
        (60, 0, 960),
        (64, 0, 960),
    ]
    # Inpainted bars 1 and 2 must be non-empty
    assert len(inpainted.tracks[1].bars[1].notes) > 0
    assert len(inpainted.tracks[1].bars[2].notes) > 0
    # Untargeted melody track must remain exact across all 4 bars
    for b_idx in range(4):
        assert [(n.pitch, n.onset_ticks) for n in inpainted.tracks[0].bars[b_idx].notes] == [(69, 0)]


def test_sample_request_fixture_end_to_end() -> None:
    """
    Verify sample_request.json (which seeds bar 0 of CHORDS with Am and leaves bars 1..3 empty)
    runs cleanly through AppExporter -> MidiGPTWrapper.accompany -> AppImporter.
    """
    raw = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    raw["model_name"] = "yellow_small"  # fast real checkpoint
    req = GenerationRequest.model_validate_json(json.dumps(raw))

    score, _ = AppExporter.request_to_score(req)
    wrapper = MidiGPTWrapper()
    out_score, out_roles = wrapper.accompany(score, req, plan=_make_sample_plan(total_bars=4))

    assert out_roles == [TrackRole.CHORDS, TrackRole.BASS]
    # Seed bar 0 of CHORDS kept its Am triad pitches [57, 60, 64]
    assert sorted(n.pitch for n in out_score.tracks[0].bars[0].notes) == [57, 60, 64]
    # Remaining bars 1..3 and BASS track were populated
    assert all(len(out_score.tracks[0].bars[b].notes) > 0 for b in range(1, 4))
    assert all(len(out_score.tracks[1].bars[b].notes) > 0 for b in range(4))

    app_tracks = AppImporter.score_to_app_tracks(out_score, out_roles, req.input_tracks)
    assert len(app_tracks) == 2
    assert len(app_tracks[0].chord_symbols) == 4
    assert app_tracks[0].chord_symbols[0].symbol == "Am"
