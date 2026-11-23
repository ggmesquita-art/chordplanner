# ChordPlanner — Plano de Tarefas e Orquestração (`TASK.md`)

> Documento operacional de execução para o módulo Neuro-Simbólico (`MIDI-GPT` + `music-composition` Skill) e sua integração ao **ChordPlanner**.
> Referência arquitetural: [`ROADMAP.md`](ROADMAP.md) e [`CHORDPLANNER_UPGRADE.md`](CHORDPLANNER_UPGRADE.md).

---

## 1. Alocação de Modelos de Orquestração

- **Leader / Orchestrator:** `Gemini 4 Neon Alto` (`google-vertex/gemini-4-neon`)
  - Responsável pela arquitetura, coordenação do DAG de tarefas, revisão de integração e validação final.
- **Main Workers (Tarefas Principais / Complexas):** `Gemini 4 Hydrogen` (`google-vertex/gemini-4-hydrogen`)
  - Responsável pela implementação dos motores principais: Motor Simbólico (`symbolic_engine`), Motor Generativo (`generative_engine` + `io_bridge` + `orchestrator`) e Integração de UI/Estado no ChordPlanner (`src/ai/`, `src/ui/AIPanel/`, `src/state/store.ts`).
- **Fast Workers (Tarefas Rápidas / Estruturais):** `Gemini 3.8 Flash (Alto)` (`google-vertex/gemini-3.8-flash`)
  - Responsável pelo setup do pacote Python, schemas Pydantic v2, mapeamento puro Camelot/Teoria em TypeScript (`src/core/camelot.ts`), CLI/Server wrappers e documentação/fixtures.

---

## 2. Grafo de Tarefas (DAG) e Escopo de Arquivos

### Task 1 — Setup do Pacote Python, Configuração e Schemas (`music_ai_module` Base)
- **Worker Model:** `google-vertex/gemini-3.8-flash`
- **Status:** `[x] Concluída` (`ctx_4bbff1839768`)
- **Arquivos Permitidos:**
  - `music_ai_module/__init__.py`
  - `music_ai_module/pyproject.toml`
  - `music_ai_module/requirements.txt`
  - `music_ai_module/.gitignore`
  - `music_ai_module/config.py`
  - `music_ai_module/schemas.py`
  - `music_ai_module/tests/__init__.py`
  - `music_ai_module/tests/fixtures/sample_request.json`
- **Objetivo:**
  1. Instalar `midigpt` (`0.4.2`), `symusic` e `music21` no ambiente Python local se ainda não instalados.
  2. Criar `config.py` com localização automática do cache local do Hugging Face (`C:\Users\Administrator\.cache\huggingface\hub\models--Metacreation--MIDI-GPT`) e da pasta da skill (`.agents/skills/music-composition` ou `./music-composition`).
  3. Criar `schemas.py` usando **Pydantic v2 estrito** (sem `Any`) com `CamelotKey` (`1A..12A`, `1B..12B`), `TrackRole` (`melody`, `chords`, `bass`, `drums`, `pad`), `NoteEvent`, `ChordSymbolEvent`, `TrackInput`, `GenerationRequest`, `GeneratedTrack`, `TheoreticalPlan`, `ValidationReport`, `GenerationResult` e tabelas/funções de conversão Camelot ↔ `(tonic_pc, scale_id)`.
- **Critério de Pronto:** `python -c "from music_ai_module.schemas import GenerationRequest, GenerationResult; from music_ai_module.config import settings; print(settings.SKILL_PATH, settings.HF_CACHE_DIR)"` executa com sucesso.

---

### Task 2 — Módulo Puro TypeScript de Camelot e Conversão IA (`src/core/camelot.ts`)
- **Worker Model:** `google-vertex/gemini-3.8-flash`
- **Status:** `[x] Concluída` (`ctx_4483fe154fc6` — 16 testes unitários + oxlint OK)
- **Dependências:** Nenhuma (paralelo à Task 1; arquivos disjuntos em `src/core/`)
- **Arquivos Permitidos:**
  - `src/core/camelot.ts`
  - `src/core/camelot.test.ts`
- **Objetivo:**
  1. Implementar mapeamento bidirecional puro entre `(tonic: PitchClass, scaleId: string)` do ChordPlanner e `CamelotKey` (`1A`..`12A` para modos menores, `1B`..`12B` para modos maiores), incluindo vizinhos harmônicos na roda Camelot (`sameNumber`, `stepClockwise`, `stepCounterClockwise`).
  2. Implementar conversores puros entre o estado de um `Block` do ChordPlanner (`chords: Chord[]`, `melody?: MelodyNote[]`, `meter: Meter`) e os payloads de `TrackInput` / `GeneratedTrack` (ticks `PPQ = 480`), usando `recognizeChord` (`src/core/recognize.ts`) e `normalizeMonophonic` (`src/core/melody.ts`) para converter notas/cifras geradas pela IA em `Chord[]` e `MelodyNote[]` válidos do ChordPlanner.
- **Critério de Pronto:** `npx vitest run src/core/camelot.test.ts` passa 100%.

---

### Task 3 — Motor Simbólico (`music_ai_module/symbolic_engine/`)
- **Worker Model:** `google-vertex/gemini-4-hydrogen`
- **Status:** `[x] Concluída` (`ctx_18bf6386029c` — 30 testes pytest passando)
- **Dependências:** Task 1
- **Arquivos Permitidos:**
  - `music_ai_module/symbolic_engine/__init__.py`
  - `music_ai_module/symbolic_engine/skill_loader.py`
  - `music_ai_module/symbolic_engine/llm_planner.py`
  - `music_ai_module/symbolic_engine/primer_builder.py`
  - `music_ai_module/symbolic_engine/validator.py`
  - `music_ai_module/tests/test_symbolic_engine.py`
- **Objetivo:**
  1. `skill_loader.py`: Carregar `SKILL.md`, `references/00-navigation.md`, `references/harmony/`, `references/melody/`, `references/form/`, `references/rhythm-groove/` e `assets/` de `.agents/skills/music-composition`, expondo busca contextual por gênero/estilo e resumo de regras.
  2. `llm_planner.py`: Implementar `LLMPlanner` com suporte a chamada assíncrona OpenAI-compatible (quando `OPENAI_API_KEY` estiver definida) **e** um planejador teórico determinístico completo (baseado nas regras da skill `music-composition`: progressões funcionais por estilo/modo/Camelot, *voice-leading* Drop-2 / Shell / Close, baixo funcional e notas-guia) que gera `TheoreticalPlan` + código Python executável (`build_primer()`) sem depender de rede externa.
  3. `primer_builder.py`: Executar `primer_python_code` em subprocesso seguro com timeout e/ou construir diretamente `midigpt.Score` + arquivo `.mid` de primer contendo tempo, fórmula de compasso, armadura, acordes com *voice-leading*, linha de baixo e melodia do usuário.
  4. `validator.py`: Analisar o `midigpt.Score` gerado frente ao `TheoreticalPlan` (aderência à escala, condução de vozes, identificação de compassos fora da escala para eventual *inpainting*).
- **Critério de Pronto:** `pytest music_ai_module/tests/test_symbolic_engine.py -v` passa 100%.

---

### Task 4 — Motor Generativo MIDI-GPT e Bridge I/O (`generative_engine/` e `io_bridge/`)
- **Worker Model:** `google-vertex/gemini-4-hydrogen`
- **Status:** `[x] Concluída` (`ctx_d144ad36c20b` — 7 testes pytest passando, incluindo inferência real com `expressive_medium` e `yellow_small`)
- **Dependências:** Task 1
- **Arquivos Permitidos:**
  - `music_ai_module/generative_engine/__init__.py`
  - `music_ai_module/generative_engine/model_manager.py`
  - `music_ai_module/generative_engine/controls_mapper.py`
  - `music_ai_module/generative_engine/midi_gpt_wrapper.py`
  - `music_ai_module/io_bridge/__init__.py`
  - `music_ai_module/io_bridge/app_exporter.py`
  - `music_ai_module/io_bridge/app_importer.py`
  - `music_ai_module/tests/test_generative_and_bridge.py`
- **Objetivo:**
  1. `model_manager.py`: Singleton lazy loader para `midigpt.inference.engine.InferenceEngine`, priorizando os checkpoints já cacheados em `C:\Users\Administrator\.cache\huggingface\hub\models--Metacreation--MIDI-GPT` (`expressive_medium`, `prism_medium`, `yellow_medium`, `yellow_small`), gerenciando device (`cuda` / `cpu`), warmup e listagem de modelos disponíveis.
  2. `controls_mapper.py`: Mapear `GenerationRequest` e `TheoreticalPlan` para `TrackPrompt`s e `InferenceConfig` reais do `midigpt` 0.4.2, fixando a ordem canônica (`CHORDS`, `BASS`, `DRUMS`, `PAD`, `MELODY`), configurando `pitch_mask` (`pitch_classes` da escala + `shape` por faixa de registro do instrumento), `rhythm_mask`, atributos (`note_density`, `min_polyphony`, `max_polyphony`) e controles de peça (`velocity`, `microtiming`, `genre`).
  3. `midi_gpt_wrapper.py`: Implementar `.accompany()`, `.inpaint()` e `.generate()` sobre `InferenceEngine.session(score, request).run()`, lidando com janelas de compassos (`model_dim` em `{4, 8, 12, 16}`) e preservando as tracks originais do usuário.
  4. `app_exporter.py` & `app_importer.py`: Converter `GenerationRequest` ↔ `midigpt.Score` (`resolution=480`) e extrair automaticamente `chord_symbols` por compasso/tempo da track harmônica gerada (usando `music21` / heurística de pitch-class).
- **Critério de Pronto:** `pytest music_ai_module/tests/test_generative_and_bridge.py -v` passa 100%, incluindo inferência real com o checkpoint local do `MIDI-GPT`.

---

### Task 5 — Orquestrador Principal, CLI, Servidor FastAPI, Testes Integrados e Docs (`music_ai_module/`)
- **Worker Model:** `google-vertex/gemini-3.8-flash`
- **Status:** `[x] Concluída` (`ctx_c400f886933f` — 48 testes pytest passando + validação CLI stdin/stdout OK)
- **Dependências:** Task 3, Task 4
- **Arquivos Permitidos:**
  - `music_ai_module/orchestrator.py`
  - `music_ai_module/cli.py`
  - `music_ai_module/server.py`
  - `music_ai_module/README.md`
  - `music_ai_module/tests/test_pipeline.py`
- **Objetivo:**
  1. Implementar `MusicAIOrchestrator` (`orchestrator.py`) integrando Export → Symbolic Engine → Controls Mapper → Generative Engine (`MIDI-GPT`) → Validator (com *inpainting* corretivo opcional) → Import → `GenerationResult`.
  2. Implementar `cli.py` (leitura de `GenerationRequest` JSON via `stdin` e saída de `GenerationResult` JSON limpo em `stdout`).
  3. Implementar `server.py` (`FastAPI` em `127.0.0.1:8765` com `CORSMiddleware` liberado para o frontend Vite/Electron e endpoints `GET /health`, `POST /generate`, `POST /inpaint`, `POST /plan`).
  4. Criar `tests/test_pipeline.py` e `README.md` completo.
- **Critério de Pronto:** `pytest music_ai_module/tests/ -v` passa 100% e o comando CLI de validação retorna JSON com `"success": true` e tracks populadas.

---

### Task 6 — Integração Completa na Interface do ChordPlanner (`src/ai/`, `src/ui/AIPanel/`, `src/state/store.ts`)
- **Worker Model:** `google-vertex/gemini-4-hydrogen`
- **Status:** `[x] Concluída` (`ctx_67da905c5bf8` — 522 testes Vitest, oxlint e build passando)
- **Dependências:** Task 2, Task 5
- **Arquivos Permitidos:**
  - `src/ai/client.ts`
  - `src/ai/client.test.ts`
  - `src/ui/AIPanel/AIPanel.tsx`
  - `src/ui/aiPanel.test.tsx`
  - `src/state/store.ts`
  - `src/ui/Header.tsx`
  - `src/ui/Layout/TopBar.tsx`
  - `src/index.css`
  - `electron/main.js`
- **Objetivo:**
  1. Criar `src/ai/client.ts` para comunicação com o servidor `music_ai_module` (`http://127.0.0.1:8765`), construção de `GenerationRequest` a partir do `Block`, `Song` e `ScaleContext` ativos, e conversão de `GenerationResult` em atualizações de acordes e melodia.
  2. Adicionar em `src/state/store.ts` a ação `applyAIGeneration(patch: { chords?: Chord[]; melody?: MelodyNote[]; bassInstrument?: InstrumentId })` com registro único no histórico de Desfazer/Refazer (`commit`).
  3. Criar `src/ui/AIPanel/AIPanel.tsx` acessível pelo cabeçalho (`Header.tsx` / `TopBar.tsx` — botão **✨ IA Musical**), exibindo:
     - Status do motor local `MIDI-GPT` + `music-composition` e seletor de modelo (`expressive_medium`, `prism_medium`, `yellow_medium`, `yellow_small`).
     - Chave Camelot ativa (`8A`, `8B`...) sincronizada com a tônica/escala do bloco.
     - Modos de geração: **Harmonizar Melodia (Acordes + Baixo)**, **Gerar Melodia no Piano Roll**, **Gerar Acompanhamento Completo** e **Inpainting de Compassos**.
     - Controles finos do MIDI-GPT: Gênero/Estilo, Densidade (1–10), Polifonia (1–10), Duração relativa (Staccato ↔ Legato), Temperatura, *Velocity* humano e *Microtiming* humano.
     - Visualização do Plano Teórico da Skill e aplicação imediata no bloco com suporte a `Ctrl+Z`.
  4. Permitir chamadas para `http://127.0.0.1:8765` em `electron/main.js` mesmo com `CHORDPLANNER_OFFLINE`.
- **Critério de Pronto:** `npm test`, `npm run lint` e `npm run build` passando 100%.
