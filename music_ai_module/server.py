"""
FastAPI HTTP server for music_ai_module.
Exposes REST endpoints for health checks, theoretical planning, accompaniment, and inpainting.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from music_ai_module.config import settings
from music_ai_module.orchestrator import MusicAIOrchestrator
from music_ai_module.schemas import (
    GenerationRequest,
    GenerationResult,
    InpaintRange,
    ModelDownloadRequest,
    ModelDownloadResponse,
    TheoreticalPlan,
    TrackRole,
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="ChordPlanner Music AI Engine",
    description="Neuro-symbolic music planning, accompaniment, and inpainting engine",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

orchestrator = MusicAIOrchestrator()

_REQUEST_OPENAPI = {
    "requestBody": {
        "content": {"application/json": {"schema": GenerationRequest.model_json_schema()}},
        "required": True,
    }
}

_DOWNLOAD_REQUEST_OPENAPI = {
    "requestBody": {
        "content": {"application/json": {"schema": ModelDownloadRequest.model_json_schema()}},
        "required": True,
    }
}


async def _parse_generation_request(request: Request) -> GenerationRequest:
    try:
        body = await request.body()
        return GenerationRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    Check the status and availability of models, device, and music-composition skill.
    """
    default_model = settings.DEFAULT_MODEL_NAME
    is_loaded = orchestrator.model_manager.is_loaded(default_model)
    available_models = orchestrator.model_manager.list_available_models()
    device = orchestrator.model_manager.get_device()

    skill_path = orchestrator.llm_planner.skill_loader.skill_path
    skill_loaded = (skill_path / "SKILL.md").is_file() or skill_path.exists()

    return {
        "status": "ok",
        "model_loaded": is_loaded,
        "default_model": default_model,
        "available_models": available_models,
        "models_installed": [m["name"] for m in available_models],
        "hf_repo": settings.HF_REPO,
        "hf_authenticated": orchestrator.model_manager.is_hf_authenticated(),
        "skill_loaded": skill_loaded,
        "device": device,
    }


@app.post("/models/download", response_model=ModelDownloadResponse, openapi_extra=_DOWNLOAD_REQUEST_OPENAPI)
async def download_model(request: Request) -> ModelDownloadResponse:
    """
    Download MIDI-GPT model weights from Hugging Face if missing locally.
    """
    try:
        body = await request.body()
        dl_req = ModelDownloadRequest.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_input=False))
    except Exception:
        raise HTTPException(status_code=422, detail="Payload JSON inválido para download de modelo.")

    return await anyio.to_thread.run_sync(
        orchestrator.model_manager.download_model,
        dl_req.model_name,
        dl_req.hf_token,
        dl_req.save_token,
    )


@app.post("/plan", response_model=TheoreticalPlan, openapi_extra=_REQUEST_OPENAPI)
async def create_plan(request: Request) -> TheoreticalPlan:
    """
    Synthesize and return only the theoretical plan for the given request.
    """
    gen_req = await _parse_generation_request(request)
    return await orchestrator.create_plan(gen_req)


@app.post("/generate", response_model=GenerationResult, openapi_extra=_REQUEST_OPENAPI)
async def generate_music(request: Request) -> GenerationResult:
    """
    Execute full accompaniment or generation pipeline.
    """
    gen_req = await _parse_generation_request(request)
    return await orchestrator.generate(gen_req)


@app.post("/inpaint", response_model=GenerationResult, openapi_extra=_REQUEST_OPENAPI)
async def inpaint_music(request: Request) -> GenerationResult:
    """
    Execute inpainting pipeline for the specified (or defaulted) bar range.
    """
    gen_req = await _parse_generation_request(request)
    if gen_req.inpaint_range is None:
        total_bars = sum(gen_req.section_lengths) if gen_req.section_lengths else 4
        target_roles = gen_req.target_tracks or [TrackRole.CHORDS]
        gen_req = gen_req.model_copy(
            update={
                "inpaint_range": InpaintRange(
                    start_bar=0,
                    end_bar=total_bars,
                    roles=target_roles,
                )
            }
        )
    return await orchestrator.generate(gen_req)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.SERVER_HOST, port=settings.SERVER_PORT)
