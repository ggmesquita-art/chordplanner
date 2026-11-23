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

import httpx
import pytest
from fastapi.testclient import TestClient
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError

from music_ai_module.config import Settings, settings
from music_ai_module.orchestrator import MusicAIOrchestrator
from music_ai_module.schemas import (
    CamelotKey,
    GenerationRequest,
    GenerationResult,
    InpaintRange,
    ModelDownloadResponse,
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
    assert data["models_installed"] == [m["name"] for m in data["available_models"]]
    assert data["hf_repo"] == settings.HF_REPO
    assert isinstance(data["hf_authenticated"], bool)
    assert data["skill_loaded"] is True
    assert isinstance(data["device"], str)


def test_server_models_download_already_present(client: TestClient, tmp_path: Path) -> None:
    existing_file = tmp_path / "expressive_medium-final.safetensors"
    existing_file.write_bytes(b"weights")

    with patch.object(Settings, "resolve_checkpoint_path", return_value=existing_file):
        resp = client.post("/models/download", json={"model_name": "expressive_medium"})

    assert resp.status_code == 200
    res = ModelDownloadResponse.model_validate_json(resp.text)
    assert res.success is True
    assert res.model_name == "expressive_medium"
    assert res.already_present is True
    assert res.auth_required is False
    assert res.path == str(existing_file)


def test_server_models_download_success(client: TestClient, tmp_path: Path) -> None:
    downloaded_file = tmp_path / "prism_medium-final.safetensors"
    downloaded_file.write_bytes(b"hf-weights")

    with (
        patch.object(Settings, "resolve_checkpoint_path", return_value=None),
        patch("huggingface_hub.hf_hub_download", return_value=str(downloaded_file)) as mock_dl,
        patch("huggingface_hub.login") as mock_login,
    ):
        resp = client.post(
            "/models/download",
            json={
                "model_name": "prism_medium",
                "hf_token": "hf_test_token_value",
                "save_token": True,
            },
        )

    assert resp.status_code == 200
    res = ModelDownloadResponse.model_validate_json(resp.text)
    assert res.success is True
    assert res.model_name == "prism_medium"
    assert res.already_present is False
    assert res.auth_required is False
    assert res.path == str(downloaded_file)
    mock_dl.assert_called_once_with(
        repo_id=settings.HF_REPO,
        filename="prism_medium-final.safetensors",
        token="hf_test_token_value",
    )
    mock_login.assert_called_once_with(
        token="hf_test_token_value",
        add_to_git_credential=False,
    )


def test_server_models_download_gated_error(client: TestClient) -> None:
    gated_resp = httpx.Response(403, request=httpx.Request("GET", "https://huggingface.co"))
    gated_exc = GatedRepoError("Access to gated repo is restricted", response=gated_resp)

    with (
        patch.object(Settings, "resolve_checkpoint_path", return_value=None),
        patch("huggingface_hub.hf_hub_download", side_effect=gated_exc),
    ):
        resp = client.post("/models/download", json={"model_name": "yellow_medium"})

    assert resp.status_code == 200
    res = ModelDownloadResponse.model_validate_json(resp.text)
    assert res.success is False
    assert res.model_name == "yellow_medium"
    assert res.auth_required is True
    assert res.repo_url == f"https://huggingface.co/{settings.HF_REPO}"

    unauth_resp = httpx.Response(401, request=httpx.Request("GET", "https://huggingface.co"))
    unauth_exc = HfHubHTTPError("Unauthorized", response=unauth_resp)

    with (
        patch.object(Settings, "resolve_checkpoint_path", return_value=None),
        patch("huggingface_hub.hf_hub_download", side_effect=unauth_exc),
    ):
        resp_401 = client.post("/models/download", json={"model_name": "yellow_small"})

    assert resp_401.status_code == 200
    res_401 = ModelDownloadResponse.model_validate_json(resp_401.text)
    assert res_401.success is False
    assert res_401.model_name == "yellow_small"
    assert res_401.auth_required is True
    assert res_401.repo_url == f"https://huggingface.co/{settings.HF_REPO}"


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
