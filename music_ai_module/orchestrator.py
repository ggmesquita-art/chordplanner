"""
MusicAIOrchestrator: High-level neuro-symbolic coordinator integrating
Export -> Symbolic Engine (Planner & Primer) -> Generative Engine (MIDI-GPT)
-> Symbolic Validator -> Import Bridge -> GenerationResult.
"""

from __future__ import annotations

import base64
import logging
import os
import tempfile
import time
from typing import List, Optional

from midigpt import Score

from music_ai_module.generative_engine.controls_mapper import (
    ROLE_TO_PROGRAM,
)
from music_ai_module.generative_engine.midi_gpt_wrapper import MidiGPTWrapper
from music_ai_module.generative_engine.model_manager import ModelManager
from music_ai_module.io_bridge.app_exporter import APP_PPQ, AppExporter
from music_ai_module.io_bridge.app_importer import AppImporter
from music_ai_module.schemas import (
    ChordSymbolEvent,
    GeneratedTrack,
    GenerationRequest,
    GenerationResult,
    TheoreticalPlan,
    TrackRole,
)
from music_ai_module.symbolic_engine.llm_planner import LLMPlanner, parse_chord_symbol
from music_ai_module.symbolic_engine.primer_builder import PrimerBuilder
from music_ai_module.symbolic_engine.validator import SymbolicValidator

logger = logging.getLogger(__name__)


class MusicAIOrchestrator:
    """
    Main orchestrator for neuro-symbolic music generation, accompaniment, and inpainting.
    """

    def __init__(
        self,
        model_manager: Optional[ModelManager] = None,
        midi_gpt: Optional[MidiGPTWrapper] = None,
        llm_planner: Optional[LLMPlanner] = None,
        primer_builder: Optional[PrimerBuilder] = None,
        symbolic_validator: Optional[SymbolicValidator] = None,
        app_exporter: Optional[AppExporter] = None,
        app_importer: Optional[AppImporter] = None,
    ) -> None:
        self.model_manager: ModelManager = model_manager or ModelManager.get_instance()
        self.midi_gpt: MidiGPTWrapper = midi_gpt or MidiGPTWrapper(model_manager=self.model_manager)
        self.llm_planner: LLMPlanner = llm_planner or LLMPlanner()
        self.primer_builder: PrimerBuilder = primer_builder or PrimerBuilder()
        self.symbolic_validator: SymbolicValidator = symbolic_validator or SymbolicValidator()
        self.app_exporter: AppExporter = app_exporter or AppExporter()
        self.app_importer: AppImporter = app_importer or AppImporter()

    @staticmethod
    def _score_to_midi_b64(score: Score) -> str:
        """
        Encode a `midigpt.Score` into a Base64 string of standard MIDI file bytes.
        """
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            score.to_midi(tmp_path)
            with open(tmp_path, "rb") as f:
                data = f.read()
            return base64.b64encode(data).decode("utf-8")
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    async def create_plan(self, request: GenerationRequest) -> TheoreticalPlan:
        """
        Synthesize the theoretical plan via LLMPlanner enriched with music-composition skill context.
        """
        return await self.llm_planner.create_generation_plan(request)

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        """
        Full neuro-symbolic generation pipeline:
        1. Theoretical plan creation
        2. Score construction with primer score & base64 MIDI
        3. MIDI-GPT accompaniment or inpainting
        4. Post-generation symbolic validation
        5. App tracks import and chord symbol alignment
        6. GenerationResult assembly
        """
        start_time = time.perf_counter()

        try:
            # 1. Theoretical Plan
            plan = await self.llm_planner.create_generation_plan(request)

            # 2. Score construction & Primer
            user_score, user_roles = self.app_exporter.request_to_score(request)

            # Build primer score containing harmonic primer and user context
            try:
                primer_score = self.primer_builder.execute_primer_code(
                    plan.primer_python_code,
                    fallback_request=request,
                    plan=plan,
                )
            except Exception as exc:
                logger.warning("Primer code execution failed (%s); using deterministic primer", exc)
                primer_score = self.primer_builder.build_primer_score_deterministic(request, plan)

            primer_midi_b64: Optional[str] = None
            try:
                primer_midi_b64 = self._score_to_midi_b64(primer_score)
            except Exception as exc:
                logger.warning("Failed to encode primer MIDI to base64: %s", exc)

            # 3. Inference: Inpainting or Accompaniment
            if request.inpaint_range is not None:
                primer_roles = self.midi_gpt._infer_track_roles(primer_score, request)
                generated_score = self.midi_gpt.inpaint(
                    score=primer_score,
                    track_roles=primer_roles,
                    start_bar=request.inpaint_range.start_bar,
                    end_bar=request.inpaint_range.end_bar,
                    request=request,
                    plan=plan,
                )
                generated_roles = primer_roles
            else:
                input_score = user_score if len(user_score.tracks) > 0 else primer_score
                generated_score, generated_roles = self.midi_gpt.accompany(
                    score=input_score,
                    request=request,
                    plan=plan,
                )

            # 4. Symbolic Validation
            validation_report = self.symbolic_validator.validate_score(generated_score, plan)

            # 5. Conversion to App tracks
            tracks = self.app_importer.score_to_app_tracks(
                score=generated_score,
                track_roles=generated_roles,
                original_tracks=request.input_tracks,
                plan=plan,
            )

            # 6. Ensure CHORDS track has aligned chord symbols
            ts_num = request.time_signature[0] if len(request.time_signature) >= 1 else 4
            ts_den = request.time_signature[1] if len(request.time_signature) >= 2 else 4
            bar_ticks = max(1, int(round(APP_PPQ * ts_num * (4.0 / ts_den))))
            total_bars = plan.total_bars or (sum(request.section_lengths) if request.section_lengths else 4)

            def _build_plan_chord_events() -> List[ChordSymbolEvent]:
                events: List[ChordSymbolEvent] = []
                for b_idx in range(total_bars):
                    if plan.chord_progression_per_bar:
                        sym = plan.chord_progression_per_bar[b_idx % len(plan.chord_progression_per_bar)]
                    else:
                        sym = f"{plan.tonic_name}{'m' if 'min' in plan.scale_id else ''}"
                    root_pc: Optional[int] = None
                    try:
                        root_pc, _, _ = parse_chord_symbol(sym)
                    except Exception:
                        pass
                    events.append(
                        ChordSymbolEvent(
                            symbol=sym,
                            root_pc=root_pc,
                            quality=None,
                            start_tick=b_idx * bar_ticks,
                            end_tick=(b_idx + 1) * bar_ticks,
                        )
                    )
                return events

            has_chords_track = False
            for trk in tracks:
                if trk.role == TrackRole.CHORDS:
                    has_chords_track = True
                    if not trk.chord_symbols:
                        trk.chord_symbols = _build_plan_chord_events()

            if not has_chords_track and TrackRole.CHORDS in request.target_tracks:
                tracks.append(
                    GeneratedTrack(
                        role=TrackRole.CHORDS,
                        program=ROLE_TO_PROGRAM.get(TrackRole.CHORDS, 0),
                        name="Chords (AI)",
                        notes=[],
                        chord_symbols=_build_plan_chord_events(),
                    )
                )

            gen_time = round(time.perf_counter() - start_time, 3)
            vram_mb = self.model_manager.get_vram_usage()

            return GenerationResult(
                success=True,
                message="Generation completed successfully",
                bpm=request.bpm,
                time_signature=list(request.time_signature),
                camelot_key=request.camelot_key,
                tracks=tracks,
                theoretical_plan=plan,
                validation_report=validation_report,
                primer_midi_b64=primer_midi_b64,
                generation_time_sec=gen_time,
                vram_used_mb=vram_mb,
                model_used=request.model_name,
            )

        except Exception as exc:
            logger.exception("Error during music generation: %s", exc)
            gen_time = round(time.perf_counter() - start_time, 3)
            vram_mb = self.model_manager.get_vram_usage()
            return GenerationResult(
                success=False,
                message=f"Generation failed: {exc}",
                bpm=request.bpm,
                time_signature=list(request.time_signature),
                camelot_key=request.camelot_key,
                tracks=[],
                theoretical_plan=None,
                validation_report=None,
                primer_midi_b64=None,
                generation_time_sec=gen_time,
                vram_used_mb=vram_mb,
                model_used=request.model_name,
            )
