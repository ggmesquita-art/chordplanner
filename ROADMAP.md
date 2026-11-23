# ChordPlanner — Roadmap de Implementação: Módulo Neuro-Simbólico (MIDI-GPT + Music-Composition Skill)

> Baseado em [`CHORDPLANNER_UPGRADE.md`](CHORDPLANNER_UPGRADE.md), [`DESIGN.md`](DESIGN.md) e [`ROADMAP_FINAL.md`](ROADMAP_FINAL.md).
> Integra a **Skill `music-composition`** (planejamento teórico determinístico, harmonia funcional, *voice-leading* e forma) com o motor generativo **Metacreation/MIDI-GPT** (`midigpt` v0.4.2 + checkpoints locais em `~/.cache/huggingface/hub/models--Metacreation--MIDI-GPT`) e a interface existente do **ChordPlanner** (Roda de Acordes / Camelot, Piano Roll de Melodia, Blocos e Arranjo).

---

## 1. Visão Geral da Arquitetura Neuro-Simbólica

```mermaid
graph TB
    subgraph ChordPlanner_App [🎹 Aplicação Principal ChordPlanner (React 19 + TS + Zustand)]
        UI[Interface: Roda de Acordes / Camelot, Piano Roll, Painel IA]
        Store[Estado Musical: Blocos, Acordes, Melodia, BPM, Compasso, Tônica/Escala]
        BridgeTS[Cliente IA TypeScript: Exportador de Bloco & Importador Polifônico/Monofônico]
    end

    subgraph Music_AI_Module [🧠 Módulo Python `music_ai_module` (FastAPI + CLI)]
        Orchestrator[MusicAIOrchestrator]

        subgraph Symbolic_Engine [📐 Motor Simbólico (Skill `music-composition` + `music21`)]
            SkillLoader[SkillLoader: `.agents/skills/music-composition`]
            Planner[LLMPlanner + Planejador Teórico Determinístico]
            PrimerBuilder[PrimerBuilder: Gera Primer MIDI / `midigpt.Score` com Harmonia & Guia]
            Validator[Validator: Análise de Escala, Acordes e Condução de Vozes]
        end

        subgraph Generative_Engine [🤖 Motor Generativo (`midigpt` 0.4.2 + HF Cache Local)]
            ModelManager[ModelManager: Lazy Load `expressive_medium` / `prism_medium` / `yellow_medium`]
            ControlsMapper[ControlsMapper: `pitch_mask`, `rhythm_mask`, Densidade, Polifonia, Velocity, Microtiming]
            MidiGPTWrapper[MidiGPTWrapper: `accompany`, `inpaint`, `generate`]
        end

        subgraph IO_Bridge [🔄 Bridge I/O (`app_exporter` & `app_importer`)]
            Exporter[AppExporter: `GenerationRequest` → Contexto Teórico + Primer Score]
            Importer[AppImporter: `Score` Gerado → Notas Piano Roll + Cifras Extraídas]
        end
    end

    UI -->|1. Parâmetros + Acordes/Melodia do Bloco| BridgeTS
    BridgeTS -->|2. HTTP POST /generate ou CLI JSON| Orchestrator
    Orchestrator -->|3. Contexto Musical| Symbolic_Engine
    Symbolic_Engine -->|4. Plano Teórico + Primer MIDI| Generative_Engine
    Generative_Engine -->|5. MIDI Multitrack Humanizado| Validator
    Validator -->|6. Score Validado| Importer
    Importer -->|7. `GenerationResult` (Tracks + Cifras)| BridgeTS
    BridgeTS -->|8. Commit Atômico (com Undo/Redo)| Store
```

### Descobertas Técnicas do Ambiente Local
1. **Checkpoints `Metacreation/MIDI-GPT` disponíveis no cache local do Hugging Face** (`C:\Users\Administrator\.cache\huggingface\hub\models--Metacreation--MIDI-GPT\snapshots\9a21a3976ce4fbd78e607171c679d7b85f8b8625`):
   - `expressive_medium-final.safetensors` (janelas de 4, 8, 12, 16 compassos; contexto de 4096 tokens; suporte nativo a *infill*, armadura de clave, densidade por compasso, polifonia min/max, duração de notas, *pitch class set*, gênero, *velocity* e *microtiming* comutáveis).
   - `prism_medium-final.safetensors` (4, 8, 12, 16 compassos; 4096 tokens; controle de atributos).
   - `yellow_medium-final.safetensors` e `yellow_small-final.safetensors` (4, 8 compassos; 2048 tokens).
   - `yellow_encoder.json`.
2. **Biblioteca oficial `midigpt` (v0.4.2 no PyPI)**:
   - Fornece `midigpt.Score`, `Track`, `Bar`, `Note`, `InferenceEngine`, `GenerationRequest`, `InferenceConfig` e `TrackPrompt`.
   - Suporta máscaras estritas e suaves de altura (`pitch_mask` com `scale`, `root`, `pitch_classes` e `shape`), máscaras rítmicas (`rhythm_mask`), `remix`, atributos por compasso (`bar_attributes`, `bar_controls`) e controles globais (`velocity`, `microtiming`, `genre`).
3. **Skill `music-composition` instalada no repositório**:
   - Localizada em `.agents/skills/music-composition` (com `SKILL.md`, `references/` e `assets/`).

---

## 2. Fases de Implementação

### Fase 1 — Ambiente Python, Configuração e Contrato de Dados (`music_ai_module/`)
- **Objetivo:** Estruturar o pacote isolado `music_ai_module`, instalar `midigpt` e `music21`, mapear o cache local do Hugging Face e definir todos os schemas Pydantic v2 sem uso de `Any`.
- **Entregáveis:**
  - `music_ai_module/__init__.py`
  - `music_ai_module/pyproject.toml` e `music_ai_module/requirements.txt`
  - `music_ai_module/.gitignore`
  - `music_ai_module/config.py` (resolução automática do cache HF `models--Metacreation--MIDI-GPT` e da skill em `.agents/skills/music-composition` ou `./music-composition`)
  - `music_ai_module/schemas.py` (`CamelotKey`, `TrackRole`, `NoteEvent`, `ChordSymbolEvent`, `TrackInput`, `GenerationRequest`, `GeneratedTrack`, `TheoreticalPlan`, `ValidationReport`, `GenerationResult` + conversores Camelot ↔ `(tonic_pc, scale_id)`)

### Fase 2 — Motor Simbólico: Skill `music-composition`, Planejador Teórico, Primer e Validador (`music_ai_module/symbolic_engine/`)
- **Objetivo:** Implementar a "mente teórica" que lê a base de conhecimento `music-composition`, planeja a harmonia funcional, o *voice-leading* (Drop-2, Shell, condução suave) e a linha de baixo, gera o Primer MIDI determinístico e valida o resultado pós-geração.
- **Entregáveis:**
  - `music_ai_module/symbolic_engine/__init__.py`
  - `music_ai_module/symbolic_engine/skill_loader.py` (carregamento modular de `SKILL.md`, `references/harmony/`, `references/melody/`, `references/form/`, `references/rhythm-groove/`, `assets/progressions-catalog.md`, `assets/jazz-voicings.md`, `assets/modes-cheatsheet.md`)
  - `music_ai_module/symbolic_engine/llm_planner.py` (integração LLM assíncrona via OpenAI API quando configurada + motor determinístico local completo baseado nas regras da skill para operação 100% offline sem chave de API)
  - `music_ai_module/symbolic_engine/primer_builder.py` (execução segura em subprocesso/construção determinística de `midigpt.Score` e arquivo `.mid` com acordes, baixo funcional e melodia guia)
  - `music_ai_module/symbolic_engine/validator.py` (validação harmônica e melódica pós-geração com `music21`/análise de classes de altura, aderência à escala e detecção de compassos com desvios para *inpainting*)

### Fase 3 — Motor Generativo MIDI-GPT e Bridge I/O (`music_ai_module/generative_engine/` e `music_ai_module/io_bridge/`)
- **Objetivo:** Integrar o `InferenceEngine` real do `midigpt` com os checkpoints locais (`expressive_medium`, `prism_medium`, `yellow_medium`, `yellow_small`), mapear todos os controles expressivos e construir a ponte de exportação/importação com extração de cifras.
- **Entregáveis:**
  - `music_ai_module/generative_engine/__init__.py`
  - `music_ai_module/generative_engine/model_manager.py` (Singleton, lazy load a partir do cache local HF sem exigir download se já presente, warmup de KV cache, relatório de VRAM/CPU e status de autenticação)
  - `music_ai_module/generative_engine/controls_mapper.py` (mapeamento de `density`, `polyphony`, `note_duration`, `use_velocity`, `use_microtiming`, `genre`, `pitch_mask` da escala/tônica e `bar_controls` por acorde para `TrackPrompt` e `InferenceConfig`)
  - `music_ai_module/generative_engine/midi_gpt_wrapper.py` (métodos `.accompany()`, `.inpaint()` e `.generate()` sobre `InferenceEngine.session(score, request).run()`)
  - `music_ai_module/io_bridge/__init__.py`
  - `music_ai_module/io_bridge/app_exporter.py` (conversão de `GenerationRequest` → contexto da skill e `midigpt.Score` alinhado por compasso e ticks `PPQ=480`)
  - `music_ai_module/io_bridge/app_importer.py` (conversão do `Score` gerado → `List[GeneratedTrack]` com notas para o Piano Roll e extração automática de `chord_symbols` por compasso/tempo via `music21` e análise de pitch-class)

### Fase 4 — Orquestrador Python, CLI, Servidor FastAPI, Testes e Documentação (`music_ai_module/`)
- **Objetivo:** Unificar o pipeline em `MusicAIOrchestrator`, expor as interfaces CLI (`stdin`/`stdout`) e HTTP (`FastAPI` em `127.0.0.1:8765`), documentar o módulo e validar com suíte de testes automatizados (`pytest`).
- **Entregáveis:**
  - `music_ai_module/orchestrator.py`
  - `music_ai_module/cli.py`
  - `music_ai_module/server.py` (`GET /health`, `POST /generate`, `POST /inpaint`, `POST /plan` com CORS habilitado)
  - `music_ai_module/tests/fixtures/sample_request.json`
  - `music_ai_module/tests/test_pipeline.py` (testes unitários e de integração de ponta a ponta usando o checkpoint local do `MIDI-GPT`)
  - `music_ai_module/README.md`

### Fase 5 — Integração Frontend/Desktop no ChordPlanner (`src/core/camelot.ts`, `src/ai/`, `src/ui/AIPanel/`, `electron/`)
- **Objetivo:** Conectar o ChordPlanner ao `music_ai_module` para permitir gerar acompanhamentos harmônicos (acordes para a Roda/Progressão), melodias expressivas (para o Piano Roll) e *inpainting* de compassos diretamente na interface, mantendo Desfazer/Refazer (`Ctrl+Z`).
- **Entregáveis:**
  - `src/core/camelot.ts` e `src/core/camelot.test.ts` (mapeamento bidirecional Roda Camelot `1A..12A / 1B..12B` ↔ `(tonic, scaleId)`, conversão de cifras e notas geradas pela IA em `Chord[]` e `MelodyNote[]` do ChordPlanner)
  - `src/ai/client.ts` e `src/ai/client.test.ts` (cliente HTTP tipado para `music_ai_module`, serialização do `Block` atual → `GenerationRequest` e aplicação de `GenerationResult` no bloco)
  - `src/state/store.ts` (ação `applyAIGeneration` com suporte atômico a Undo/Redo para importar acordes e/ou melodia gerados no bloco atual)
  - `src/ui/AIPanel/AIPanel.tsx` e `src/ui/aiPanel.test.tsx` (modal/gaveta de geração neuro-simbólica com código Camelot, seletor de estilo/gênero, controles de densidade/polifonia/duração/temperatura/velocity/microtiming, modos *Harmonizar Melodia*, *Gerar Melodia*, *Bloco Completo* e *Inpainting de Compassos*)
  - Integração do botão **✨ IA Musical** no `Header.tsx` / `TopBar.tsx` e permissão de conexão localhost em `electron/main.js`

---

## 3. Critérios de Pronto e Verificação Final
1. **Testes Python (`music_ai_module`)**: `pytest music_ai_module/tests/ -v` passando 100%, incluindo teste real de inferência com o checkpoint local `Metacreation/MIDI-GPT` e teste do CLI via `stdin`/`stdout`.
2. **Testes TypeScript/React (`ChordPlanner`)**: `npm test` (`vitest run`), `npm run lint` (`oxlint`) e `npm run build` (`tsc -b && vite build`) passando sem erros.
3. **Grafo de Conhecimento**: `graphify update .` executado após as modificações para manter `graphify-out/` atualizado.
