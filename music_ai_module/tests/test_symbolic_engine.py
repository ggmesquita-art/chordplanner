"""
Comprehensive unit and integration tests for `music_ai_module.symbolic_engine`.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import tempfile

import pytest
from midigpt import Bar, Note, Score, Track

from music_ai_module.config import settings
from music_ai_module.schemas import (
    CamelotKey,
    GenerationRequest,
    NoteEvent,
    TheoreticalPlan,
    TrackInput,
    TrackRole,
)
from music_ai_module.symbolic_engine import (
    LLMPlanner,
    PrimerBuilder,
    SkillLoader,
    SymbolicValidator,
    parse_chord_symbol,
    roman_to_chord_symbol,
    voice_chord,
)


# ---------------------------------------------------------------------------
# SkillLoader Tests
# ---------------------------------------------------------------------------


def test_skill_loader_loads_core_context_and_genre_guides():
    loader = SkillLoader()
    assert settings.SKILL_PATH.is_dir(), f"Expected skill directory at {settings.SKILL_PATH}"

    pop_ctx = loader.load_core_context("pop")
    assert "SKILL.md" in pop_ctx
    assert "functional-harmony.md" in pop_ctx
    assert "voice-leading.md" in pop_ctx
    assert "progressions-catalog.md" in pop_ctx
    assert "jazz-voicings.md" in pop_ctx
    assert "modes-cheatsheet.md" in pop_ctx
    assert "form-templates.md" in pop_ctx
    assert "cadence-reference.md" in pop_ctx
    assert "pop-rock.md" in pop_ctx

    jazz_ctx = loader.load_core_context("jazz")
    assert "jazz-styles.md" in jazz_ctx
    assert "Drop 2" in jazz_ctx

    melody_files = [f for f in loader.get_loaded_files("pop") if f.startswith("references/melody/")]
    assert len(melody_files) >= 3


@pytest.mark.parametrize(
    "genre",
    [
        "pop",
        "jazz",
        "rock",
        "hip-hop",
        "latin",
        "blues",
        "classical",
        "dance-electronic",
        "soundtrack",
    ],
)
def test_skill_loader_genre_progressions_major_and_minor(genre: str):
    loader = SkillLoader()
    for is_minor in (False, True):
        progs = loader.get_genre_progressions(genre, is_minor=is_minor)
        assert isinstance(progs, list) and len(progs) >= 2
        for prog in progs:
            assert isinstance(prog, list) and len(prog) >= 3
            # Every Roman numeral token must convert to a parseable chord symbol
            for rn in prog:
                sym = roman_to_chord_symbol(rn, tonic_pc=9 if is_minor else 0, is_minor=is_minor)
                root_pc, intervals, _ = parse_chord_symbol(sym)
                assert 0 <= root_pc <= 11
                assert len(intervals) >= 2


def test_skill_loader_missing_path_fallback(tmp_path: Path):
    loader = SkillLoader(skill_path=tmp_path / "nonexistent_skill")
    ctx = loader.load_core_context("pop")
    assert "fallback" in ctx.lower() or len(ctx) > 20
    progs = loader.get_genre_progressions("jazz", is_minor=False)
    assert len(progs) >= 1


# ---------------------------------------------------------------------------
# LLMPlanner Tests
# ---------------------------------------------------------------------------


def test_llm_planner_offline_from_sample_request():
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "sample_request.json"
    req = GenerationRequest.model_validate_json(fixture_path.read_text(encoding="utf-8"))

    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    assert isinstance(plan, TheoreticalPlan)
    assert plan.camelot_key == CamelotKey._8A
    assert plan.tonic_pc == 9
    assert plan.tonic_name == "A"
    assert plan.scale_id == "minor"
    assert set(plan.scale_pitches) == {9, 11, 0, 2, 4, 5, 7}
    assert plan.total_bars == 4
    # sample_request has chord_symbols: ["Am"] -> preserved & expanded to 4 bars
    assert plan.chord_progression_per_bar == ["Am", "Am", "Am", "Am"]
    assert plan.voice_leading_style == "close"
    assert plan.target_roles_order == [TrackRole.CHORDS, TrackRole.BASS]
    assert "def build_primer()" in plan.primer_python_code


def test_llm_planner_preserves_and_expands_user_chord_symbols():
    req = GenerationRequest(
        bpm=110,
        camelot_key=CamelotKey._8B,
        genre="jazz",
        section_lengths=[4, 4],
        form_structure=["A", "B"],
        input_tracks=[
            TrackInput(
                role=TrackRole.CHORDS,
                chord_symbols=["Dm7", "G7", "Cmaj7", "A7"],
            )
        ],
        target_tracks=[TrackRole.MELODY, TrackRole.CHORDS, TrackRole.BASS],
        generate_melody=True,
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    assert plan.tonic_pc == 0
    assert plan.tonic_name == "C"
    assert plan.scale_id == "major"
    assert plan.total_bars == 8
    assert plan.chord_progression_per_bar == [
        "Dm7", "G7", "Cmaj7", "A7",
        "Dm7", "G7", "Cmaj7", "A7",
    ]
    assert plan.voice_leading_style == "drop2"
    # Canonical role order: CHORDS, BASS, DRUMS, PAD, MELODY
    assert plan.target_roles_order == [TrackRole.CHORDS, TrackRole.BASS, TrackRole.MELODY]


def test_llm_planner_harmonizes_melody_only_input():
    # C major melody clearly outlining C -> F -> G -> C over 4 bars (1920 ticks/bar)
    melody_notes = [
        NoteEvent(pitch=72, start_tick=0, end_tick=960, velocity=85),     # C5
        NoteEvent(pitch=76, start_tick=960, end_tick=1920, velocity=85),  # E5
        NoteEvent(pitch=69, start_tick=1920, end_tick=2880, velocity=85), # A4
        NoteEvent(pitch=77, start_tick=2880, end_tick=3840, velocity=85), # F5
        NoteEvent(pitch=71, start_tick=3840, end_tick=4800, velocity=85), # B4
        NoteEvent(pitch=74, start_tick=4800, end_tick=5760, velocity=85), # D5
        NoteEvent(pitch=72, start_tick=5760, end_tick=7680, velocity=88), # C5
    ]
    req = GenerationRequest(
        bpm=100,
        camelot_key=CamelotKey._8B,
        genre="pop",
        section_lengths=[4],
        input_tracks=[TrackInput(role=TrackRole.MELODY, program=80, notes=melody_notes)],
        target_tracks=[TrackRole.CHORDS, TrackRole.BASS],
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    assert len(plan.chord_progression_per_bar) == 4
    # First and last chords should resolve to tonic C
    assert plan.chord_progression_per_bar[0].startswith("C")
    assert plan.chord_progression_per_bar[-1].startswith("C")
    # Every chosen chord should have roots inside C major
    c_major_pcs = set(plan.scale_pitches)
    for sym in plan.chord_progression_per_bar:
        root_pc, _, _ = parse_chord_symbol(sym)
        assert root_pc in c_major_pcs


@pytest.mark.parametrize(
    "genre,expected_style",
    [
        ("jazz", "drop2"),
        ("latin", "drop2"),
        ("r&b", "drop2"),
        ("blues", "shell"),
        ("hip-hop", "shell"),
        ("pop", "close"),
        ("rock", "close"),
        ("dance-electronic", "close"),
    ],
)
def test_llm_planner_voice_leading_style_mapping(genre: str, expected_style: str):
    req = GenerationRequest(genre=genre, camelot_key=CamelotKey._5A, section_lengths=[4])
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))
    assert plan.voice_leading_style == expected_style


def test_llm_planner_falls_back_gracefully_if_openai_fails():
    req = GenerationRequest(camelot_key=CamelotKey._8A, genre="pop", section_lengths=[4])
    planner = LLMPlanner(api_key="sk-invalid-test-key", base_url="http://127.0.0.1:1/v1")
    plan = asyncio.run(planner.create_generation_plan(req))
    assert isinstance(plan, TheoreticalPlan)
    assert len(plan.chord_progression_per_bar) == 4
    assert "def build_primer()" in plan.primer_python_code


# ---------------------------------------------------------------------------
# PrimerBuilder & midigpt.Score Format Tests
# ---------------------------------------------------------------------------


def test_primer_builder_executes_generated_code_in_subprocess():
    req = GenerationRequest(
        bpm=120,
        camelot_key=CamelotKey._9B,
        genre="jazz",
        section_lengths=[4],
        target_tracks=[TrackRole.CHORDS, TrackRole.BASS],
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    score = PrimerBuilder.execute_primer_code(
        plan.primer_python_code,
        fallback_request=req,
        plan=plan,
    )
    assert isinstance(score, Score)
    assert score.resolution == 480
    assert score.tempo == int(round(60_000_000 / 120))
    assert len(score.tracks) >= 2
    for track in score.tracks:
        assert len(track.bars) == 4
        for bar in track.bars:
            bar_ticks = int(round(score.resolution * bar.beat_length))
            assert len(bar.notes) >= 1
            for note in bar.notes:
                assert 0 <= note.onset_ticks < bar_ticks
                assert note.duration_ticks >= 1


def test_primer_builder_handles_broken_code_with_and_without_fallback():
    req = GenerationRequest(camelot_key=CamelotKey._8A, section_lengths=[4])
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    bad_code = "def build_primer():\n    raise ValueError('boom')\n"

    with pytest.raises(RuntimeError):
        PrimerBuilder.execute_primer_code(bad_code)

    fallback_score = PrimerBuilder.execute_primer_code(
        bad_code,
        fallback_request=req,
        plan=plan,
    )
    assert isinstance(fallback_score, Score)
    assert len(fallback_score.tracks) >= 2


def test_primer_builder_bar_relative_onsets_for_multibar_input_and_odd_meter():
    # 3/4 time signature -> bar_ticks = 480 * 3 = 1440
    # Note at tick 1920 belongs to bar 1 with onset_in_bar = 480!
    melody_notes = [
        NoteEvent(pitch=69, start_tick=0, end_tick=480, velocity=80),     # bar 0, onset 0
        NoteEvent(pitch=72, start_tick=1920, end_tick=2400, velocity=85), # bar 1, onset 480
        NoteEvent(pitch=76, start_tick=3360, end_tick=3840, velocity=90), # bar 2, onset 480
    ]
    req = GenerationRequest(
        bpm=96,
        time_signature=[3, 4],
        camelot_key=CamelotKey._8A,
        genre="classical",
        section_lengths=[4],
        input_tracks=[TrackInput(role=TrackRole.MELODY, program=73, notes=melody_notes)],
        target_tracks=[TrackRole.CHORDS, TrackRole.BASS],
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    score = PrimerBuilder.build_primer_score_deterministic(req, plan)
    mel_track = score.tracks[0]
    assert mel_track.instrument == 73
    assert len(mel_track.bars) == 4
    assert mel_track.bars[0].ts_numerator == 3
    assert mel_track.bars[0].ts_denominator == 4
    assert mel_track.bars[0].beat_length == pytest.approx(3.0)

    assert [(n.pitch, n.onset_ticks) for n in mel_track.bars[0].notes] == [(69, 0)]
    assert [(n.pitch, n.onset_ticks) for n in mel_track.bars[1].notes] == [(72, 480)]
    assert [(n.pitch, n.onset_ticks) for n in mel_track.bars[2].notes] == [(76, 480)]

    # Verify MIDI file export + roundtrip via midigpt
    with tempfile.TemporaryDirectory() as tmpdir:
        midi_path = Path(tmpdir) / "primer.mid"
        saved = PrimerBuilder.save_primer_midi(score, midi_path)
        assert saved.is_file() and saved.stat().st_size > 0
        reloaded = Score.from_midi(str(saved))
        assert len(reloaded.tracks) == len(score.tracks)
        assert [(n.pitch, n.onset_ticks) for n in reloaded.tracks[0].bars[1].notes] == [(72, 480)]


def test_voice_leading_smoothness_between_chords():
    chords = ["Dm7", "G7", "Cmaj7", "Am7"]
    for style in ("drop2", "shell", "close"):
        prev = None
        leaps = []
        for sym in chords:
            v = voice_chord(sym, style=style, prev_voicing=prev)
            assert len(v) >= 2
            if prev is not None and len(prev) == len(v):
                leaps.append(sum(abs(a - b) for a, b in zip(prev, v)) / len(v))
            prev = v
        assert leaps and (sum(leaps) / len(leaps)) <= 3.5


# ---------------------------------------------------------------------------
# SymbolicValidator Tests
# ---------------------------------------------------------------------------


def test_validator_passes_clean_in_scale_score():
    req = GenerationRequest(
        bpm=120,
        camelot_key=CamelotKey._8A,
        genre="pop",
        section_lengths=[4],
        target_tracks=[TrackRole.CHORDS, TrackRole.BASS],
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))
    score = PrimerBuilder.execute_primer_code(plan.primer_python_code, req, plan)

    report = SymbolicValidator.validate_score(score, plan)
    assert report.is_valid is True
    assert report.scale_adherence >= 0.90
    assert report.voice_leading_score >= 0.75
    assert report.out_of_scale_bars == []


def test_validator_ignores_drum_tracks_and_flags_out_of_scale_bars():
    req = GenerationRequest(
        camelot_key=CamelotKey._8B,  # C major: {0, 2, 4, 5, 7, 9, 11}
        genre="pop",
        section_lengths=[4],
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    # Build a score where bar 2 has 100% chromatic/out-of-scale pitches (C#, F#, G#)
    # and a drum track with MIDI pitch 36 (C2) & 37 (C#2) that must be ignored.
    melodic_bars = [
        Bar(notes=[Note(pitch=60, velocity=80, onset_ticks=0, duration_ticks=1920)]),  # C4 (in)
        Bar(notes=[Note(pitch=64, velocity=80, onset_ticks=0, duration_ticks=1920)]),  # E4 (in)
        Bar(
            notes=[
                Note(pitch=61, velocity=80, onset_ticks=0, duration_ticks=960),   # C#4 (out)
                Note(pitch=66, velocity=80, onset_ticks=960, duration_ticks=960), # F#4 (out)
            ]
        ),
        Bar(notes=[Note(pitch=67, velocity=80, onset_ticks=0, duration_ticks=1920)]),  # G4 (in)
    ]
    drum_bars = [
        Bar(notes=[Note(pitch=37, velocity=100, onset_ticks=0, duration_ticks=240)])
        for _ in range(4)
    ]
    score = Score(
        resolution=480,
        tempo=500000,
        tracks=[
            Track(bars=melodic_bars, instrument=0, track_type="melodic"),
            Track(bars=drum_bars, instrument=0, track_type="drum"),
        ],
    )

    report = SymbolicValidator.validate_score(score, plan)
    assert report.out_of_scale_bars == [2]
    assert report.scale_adherence == pytest.approx(0.75, abs=0.01)
    assert report.is_valid is False
    assert any("35%" in w for w in report.warnings)


def test_validator_penalizes_large_chord_leaps():
    req = GenerationRequest(
        camelot_key=CamelotKey._8B,
        genre="pop",
        section_lengths=[2],
    )
    planner = LLMPlanner(api_key="")
    plan = asyncio.run(planner.create_generation_plan(req))

    # Huge 16-semitone leap between bar 0 and bar 1
    clunky_bars = [
        Bar(
            notes=[
                Note(pitch=48, velocity=80, onset_ticks=0, duration_ticks=1920),
                Note(pitch=52, velocity=80, onset_ticks=0, duration_ticks=1920),
                Note(pitch=55, velocity=80, onset_ticks=0, duration_ticks=1920),
            ]
        ),
        Bar(
            notes=[
                Note(pitch=64, velocity=80, onset_ticks=0, duration_ticks=1920),
                Note(pitch=67, velocity=80, onset_ticks=0, duration_ticks=1920),
                Note(pitch=72, velocity=80, onset_ticks=0, duration_ticks=1920),
            ]
        ),
    ]
    score = Score(
        resolution=480,
        tempo=500000,
        tracks=[Track(bars=clunky_bars, instrument=0, track_type="melodic")],
    )
    report = SymbolicValidator.validate_score(score, plan)
    assert report.voice_leading_score < 0.3
    assert any("leaps" in w.lower() for w in report.warnings)
