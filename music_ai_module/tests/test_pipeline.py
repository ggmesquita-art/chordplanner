"""
End-to-end and integration tests for music_ai_module pipeline:
Orchestrator, FastAPI REST endpoints, and CLI interface.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from music_ai_module.config import settings
from music_ai_module.orchestrator import MusicAIOrchestrator
from music_ai_module.schemas import (
    CamelotKey,
    GenerationRequest,
    GenerationResult,
    InpaintRange,
    NoteEvent,
    TheoreticalPlan,
    TrackInput,
    TrackRole,
)
from music_ai_module.server import app

FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "sample_request.json"
)


@pytest.fixture
def sample_request() -> GenerationRequest:
    content = FIXTURE_PATH.read_text(encoding="utf-8")
    return GenerationRequest.model_validate_json(content)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. Orchestrator Unit and Integration Tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_orchestrator_create_plan(sample_request: GenerationRequest) -> None:
    orchestrator = MusicAIOrchestrator()
    plan = await orchestrator.create_plan(sample_request)

    assert isinstance(plan, TheoreticalPlan)
    assert plan.camelot_key == sample_request.camelot_key
    assert plan.total_bars == sum(sample_request.section_lengths)
    assert len(plan.chord_progression_per_bar) == plan.total_bars
    assert "def build_primer" in plan.primer_python_code


@pytest.mark.anyio
async def test_orchestrator_generate_full(sample_request: GenerationRequest) -> None:
    orchestrator = MusicAIOrchestrator()
    result = await orchestrator.generate(sample_request)

    assert isinstance(result, GenerationResult)
    assert result.success is True
    assert result.bpm == sample_request.bpm
    assert result.camelot_key == sample_request.camelot_key
    assert len(result.tracks) >= 2

    # Verify primer MIDI is generated and encoded in base64
    assert result.primer_midi_b64 is not None
    assert len(result.primer_midi_b64) > 50

    # Verify theoretical plan and validation report
    assert result.theoretical_plan is not None
    assert result.validation_report is not None
    assert result.validation_report.is_valid is True

    # Check CHORDS track has chord_symbols populated
    chord_tracks = [t for t in result.tracks if t.role == TrackRole.CHORDS]
    assert len(chord_tracks) == 1
    assert len(chord_tracks[0].chord_symbols) > 0


@pytest.mark.anyio
async def test_orchestrator_generate_inpaint(sample_request: GenerationRequest) -> None:
    inpaint_req = sample_request.model_copy(
        update={
            "inpaint_range": InpaintRange(
                start_bar=1,
                end_bar=3,
                roles=[TrackRole.CHORDS],
            )
        }
    )
    orchestrator = MusicAIOrchestrator()
    result = await orchestrator.generate(inpaint_req)

    assert result.success is True
    assert len(result.tracks) >= 1
    chord_tracks = [t for t in result.tracks if t.role == TrackRole.CHORDS]
    assert len(chord_tracks) == 1
    assert len(chord_tracks[0].notes) > 0


@pytest.mark.anyio
async def test_orchestrator_error_handling() -> None:
    orchestrator = MusicAIOrchestrator()
    # Mock LLMPlanner to raise an exception
    with patch.object(
        orchestrator.llm_planner,
        "create_generation_plan",
        side_effect=RuntimeError("Simulated LLM synthesis failure"),
    ):
        req = GenerationRequest(
            bpm=120,
            camelot_key=CamelotKey._8A,
            section_lengths=[4],
        )
        result = await orchestrator.generate(req)

        assert result.success is False
        assert "Simulated LLM synthesis failure" in result.message
        assert len(result.tracks) == 0


# ---------------------------------------------------------------------------
# 2. FastAPI REST Server Endpoint Tests
# ---------------------------------------------------------------------------

def test_server_health_endpoint(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()

    assert data["status"] == "ok"
    assert "model_loaded" in data
    assert data["default_model"] == settings.DEFAULT_MODEL_NAME
    assert isinstance(data["available_models"], list)
    assert len(data["available_models"]) >= 1
    assert data["skill_loaded"] is True
    assert isinstance(data["device"], str)


def test_server_plan_endpoint(client: TestClient, sample_request: GenerationRequest) -> None:
    resp = client.post("/plan", json=json.loads(sample_request.model_dump_json()))
    assert resp.status_code == 200
    plan = TheoreticalPlan.model_validate_json(resp.text)

    assert plan.camelot_key == sample_request.camelot_key
    assert len(plan.chord_progression_per_bar) == 4
    assert "def build_primer" in plan.primer_python_code


def test_server_generate_endpoint(client: TestClient, sample_request: GenerationRequest) -> None:
    resp = client.post("/generate", json=json.loads(sample_request.model_dump_json()))
    assert resp.status_code == 200
    res = GenerationResult.model_validate_json(resp.text)

    assert res.success is True
    assert len(res.tracks) >= 2
    assert res.primer_midi_b64 is not None


def test_server_inpaint_endpoint(client: TestClient, sample_request: GenerationRequest) -> None:
    inpaint_payload = json.loads(sample_request.model_dump_json())
    inpaint_payload["inpaint_range"] = {
        "start_bar": 1,
        "end_bar": 3,
        "roles": ["chords"],
    }
    resp = client.post("/inpaint", json=inpaint_payload)
    assert resp.status_code == 200
    res = GenerationResult.model_validate_json(resp.text)

    assert res.success is True
    assert len(res.tracks) >= 1


# ---------------------------------------------------------------------------
# 3. CLI Subprocess Tests
# ---------------------------------------------------------------------------

def test_cli_stdin_json() -> None:
    req_json = FIXTURE_PATH.read_text(encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "music_ai_module.cli"],
        input=req_json,
        capture_output=True,
        text=True,
        check=True,
    )

    # stdout must be clean JSON
    res = json.loads(proc.stdout)
    assert res["success"] is True
    assert len(res["tracks"]) >= 2
    assert res["bpm"] == 120
    assert res["camelot_key"] == "8A"


def test_cli_file_input_arg() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "music_ai_module.cli", "--input", str(FIXTURE_PATH)],
        capture_output=True,
        text=True,
        check=True,
    )

    res = json.loads(proc.stdout)
    assert res["success"] is True
    assert len(res["tracks"]) >= 2


def test_cli_invalid_json_fails() -> None:
    bad_json = "{ invalid_json: true "
    proc = subprocess.run(
        [sys.executable, "-m", "music_ai_module.cli"],
        input=bad_json,
        capture_output=True,
        text=True,
    )

    assert proc.returncode != 0
    res = json.loads(proc.stdout)
    assert res["success"] is False
    assert "Invalid GenerationRequest" in res["message"]
