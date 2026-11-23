# ChordPlanner Music AI Module (`music_ai_module`)

Neuro-symbolic music generation, accompaniment, and inpainting engine for ChordPlanner, combining **music theory reasoning** (grounded in the `music-composition` skill) with deep generative autoregressive modeling via **[MIDI-GPT](https://huggingface.co/Metacreation/MIDI-GPT)**.

---

## 1. Architecture Overview

The module operates as a closed-loop neuro-symbolic pipeline:

```text
                        +--------------------------+
                        |    GenerationRequest     |
                        +------------+-------------+
                                     |
              +----------------------+----------------------+
              |                                             |
              v                                             v
     [AppExporter]                                   [LLMPlanner]
Converts input tracks to Score               Reads `music-composition` skill
                                            Generates `TheoreticalPlan` & Primer Code
              |                                             |
              +----------------------+----------------------+
                                     |
                                     v
                              [PrimerBuilder]
                     Executes `build_primer()` in subprocess
                     Produces base Score & primer_midi_b64
                                     |
                                     v
                             [ControlsMapper]
                   Maps density, polyphony, genre, and
                     voice-leading pitch masks
                                     |
                                     v
                            [MidiGPTWrapper]
               Inference with MIDI-GPT (local checkpoint)
               Modes: Accompaniment or Bar Inpainting
                                     |
                                     v
                           [SymbolicValidator]
             Audits scale adherence, voice-leading smoothness,
                     and detects out-of-scale bars
                                     |
                                     v
                               [AppImporter]
                Converts Score to absolute PPQ=480 NoteEvents
                  and extracts/aligns ChordSymbolEvents
                                     |
                                     v
                        +------------+-------------+
                        |     GenerationResult     |
                        +--------------------------+
```

### Core Components

- **`schemas.py`**: Strict Pydantic v2 domain schemas (`GenerationRequest`, `TheoreticalPlan`, `ValidationReport`, `GeneratedTrack`, `GenerationResult`, `CamelotKey`, `TrackRole`, `NoteEvent`, `ChordSymbolEvent`).
- **`config.py`**: Global settings managing environment configuration, skill path resolution, and checkpoint discovery (`expressive_medium`, `prism_medium`, `yellow_medium`, `yellow_small`).
- **`symbolic_engine/`**:
  - `skill_loader.py`: Caches and reads markdown musical references (genres, progressions, melodies, voice leading rules).
  - `llm_planner.py`: Synthesizes theoretical plans, Camelot key harmonizations, voice-leading strategies (`drop2`, `shell`, `close`), and executable primer code.
  - `primer_builder.py`: Subprocess runner for generated Python primer code with deterministic fallback.
  - `validator.py`: Music theory validation auditing note distributions against scale pitch classes and chord transitions.
- **`generative_engine/`**:
  - `model_manager.py`: Thread-safe singleton managing cached `midigpt.InferenceEngine` instances on CUDA/MPS/CPU.
  - `controls_mapper.py`: Converts high-level user parameters to MIDI-GPT token attributes and pitch constraints.
  - `midi_gpt_wrapper.py`: Coordinates sampling sessions for accompaniment and bar inpainting.
- **`io_bridge/`**:
  - `app_exporter.py`: Converts frontend `GenerationRequest` tracks to aligned `midigpt.Score`.
  - `app_importer.py`: Converts generated `midigpt.Score` to frontend `GeneratedTrack`s with chord recognition.
- **`orchestrator.py` (`MusicAIOrchestrator`)**: End-to-end coordinator assembling plans, primer MIDI, neural generation, validation, and chord alignment.
- **`cli.py`**: Command-line interface reading JSON from `stdin` and outputting clean JSON to `stdout`.
- **`server.py`**: FastAPI server exposing CORS-enabled REST endpoints for ChordPlanner desktop and web clients.

---

## 2. Requirements & Installation

Dependencies:
- Python 3.10+
- `midigpt == 0.4.2`
- `music21 >= 9.0.0`
- `pydantic >= 2.0.0`
- `symusic >= 0.4.0`
- `fastapi >= 0.100.0`
- `uvicorn >= 0.20.0`

Install dependencies:
```bash
pip install -r music_ai_module/requirements.txt
```

---

## 3. CLI Usage

The CLI interface takes JSON from `stdin` (or via `--input <file>`), logs progress to `stderr`, and emits strictly valid `GenerationResult` JSON on `stdout`.

### Running from stdin:
```bash
python -m music_ai_module.cli < music_ai_module/tests/fixtures/sample_request.json
```

### Running with `--input`:
```bash
python -m music_ai_module.cli --input music_ai_module/tests/fixtures/sample_request.json
```

Example output:
```json
{
  "success": true,
  "message": "Generation completed successfully",
  "bpm": 120,
  "time_signature": [4, 4],
  "camelot_key": "8A",
  "tracks": [
    {
      "role": "chords",
      "program": 0,
      "name": "Chords (AI)",
      "notes": [...],
      "chord_symbols": [
        {
          "symbol": "Am",
          "root_pc": 9,
          "quality": null,
          "start_tick": 0,
          "end_tick": 1920
        }
      ]
    },
    {
      "role": "bass",
      "program": 33,
      "name": "Bass (AI)",
      "notes": [...],
      "chord_symbols": []
    }
  ],
  "theoretical_plan": {
    "camelot_key": "8A",
    "tonic_pc": 9,
    "tonic_name": "A",
    "scale_id": "minor",
    "scale_pitches": [9, 11, 0, 2, 4, 5, 7],
    "genre": "pop",
    "total_bars": 4,
    "chord_progression_per_bar": ["Am", "Am", "Am", "Am"],
    "voice_leading_style": "close",
    "groove_style": "straight",
    "target_roles_order": ["chords", "bass"],
    "primer_python_code": "..."
  },
  "validation_report": {
    "is_valid": true,
    "scale_adherence": 1.0,
    "voice_leading_score": 1.0,
    "out_of_scale_bars": [],
    "warnings": []
  },
  "primer_midi_b64": "TVRoZAAAA6...",
  "generation_time_sec": 4.82,
  "vram_used_mb": 0.0,
  "model_used": "expressive_medium"
}
```

---

## 4. FastAPI REST Server

Start the server:
```bash
python -m music_ai_module.server
```
Or via `uvicorn`:
```bash
uvicorn music_ai_module.server:app --host 127.0.0.1 --port 8765
```

### Endpoints

| Method | Endpoint | Description | Payload / Response |
|---|---|---|---|
| `GET` | `/health` | Check loaded model, device, and skill status | `{"status": "ok", "model_loaded": bool, "default_model": str, "available_models": list, "skill_loaded": bool, "device": str}` |
| `POST` | `/plan` | Generate theoretical plan without neural inference | Input: `GenerationRequest` JSON<br>Output: `TheoreticalPlan` JSON |
| `POST` | `/generate` | Full accompaniment and track generation | Input: `GenerationRequest` JSON<br>Output: `GenerationResult` JSON |
| `POST` | `/inpaint` | Inpaint/regenerate specific bars in selected tracks | Input: `GenerationRequest` (with optional `inpaint_range`)<br>Output: `GenerationResult` JSON |

---

## 5. Automated Tests

Run the full test suite with:
```bash
pytest music_ai_module/tests/ -v
```

Run only the pipeline tests:
```bash
pytest music_ai_module/tests/test_pipeline.py -v
```
