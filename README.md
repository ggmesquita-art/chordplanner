# ChordPlanner (v0.2.2)

Planejador de progressões de acordes guiado por escala com Roda Harmônica / Camelot, Linha do Tempo de 3 Camadas (Arranjo, Melodia e Acordes) e Módulo de Inteligência Artificial Neuro-Simbólica (`MIDI-GPT` + `music-composition` Skill).

Design original em [`DESIGN.md`](DESIGN.md) · Roadmap e especificações em [`ROADMAP.md`](ROADMAP.md) e [`ROADMAP_FINAL.md`](ROADMAP_FINAL.md).

---

## 🚀 Novidades da Versão 0.2.1 (v4 + IA Empacotada)

- **Camada de Melodia (Piano Roll compacto)**:
  - Piano roll horizontal acoplado e sincronizado com a pista de acordes.
  - Modo Estrito (dobrado nas notas da escala ativa) e Modo Colorido/Livre (cromático destacando a escala).
  - Invariante monofônica estrita (edição por clique/arraste, preview sonoro e atalhos).
  - Suporte à **Casa 2** da melodia (`melodyEnding`).
  - Análise da relação nota↔acorde em tempo real (*chord-tone*, *tension*, *passing*, *nc*).
- **Acordes Curtos e Respiro (`N.C.`)**:
  - Grade harmônica até ¼ de tempo (semicolcheias em potências de 2).
  - Inserção de pausas harmônicas explícitas (`N.C.` / *No Chord*), mantendo a pulsação do metrônomo e o *voice leading*.
  - Auto-preenchimento inteligente de vãos sob a melodia com `N.C.`.
- **Inteligência Harmônica**:
  - Botão **✨ Auto-harmonizar** no Dock para derivar acordes automaticamente a partir da melodia nos tempos fortes.
  - Destaque na Roda de Acordes dos candidatos com maior compatibilidade melódica.
- **Módulo de IA Musical Neuro-Simbólico (`music_ai_module`)**:
  - Combina o motor generativo **Metacreation/MIDI-GPT** (`midigpt` 0.4.2 com checkpoints locais `expressive_medium`, `prism_medium`, `yellow_medium` e `yellow_small`) com a base teórica da **Skill `music-composition`**.
  - Modal **✨ IA Musical** acessível pelo cabeçalho, com Roda Camelot sincronizada (`1A..12A`, `1B..12B`), modos de geração (*Harmonizar Melodia*, *Gerar Melodia*, *Acompanhamento Completo*, *Inpainting de Compassos*) e aplicação atômica no bloco com **Desfazer/Refazer (`Ctrl+Z`)**.
  - Servidor local FastAPI (`127.0.0.1:8765`) empacotado com o app desktop (`resources/ai-server/`), com início automático ao abrir a área de IA Musical, botão **"Iniciar servidor"**, download de pesos do Hugging Face sob demanda quando ausentes e modo offline completo via **Skill `music-composition` (sem IA)** caso Python/dependências não estejam instalados.
- **Ajustes de Layout**:
  - Opção **"Ajustar na área visível"** (checkbox no Dock) para redimensionar melodia e acordes sem necessidade de rolagem horizontal.
  - **Arranjo horizontal dinâmico**: novos blocos dividem proporcionalmente a largura sem crescer verticalmente e barra de ações de bloco em linha única (`.block-actions-bar`).
  - Checkbox **`Iniciar com o acorde selecionado`** com comportamento revisado para iniciar vazio por padrão.

---

## 🛠️ Instalação e Execução

### Aplicação Web

```bash
npm install
npm run dev     # Servidor local em http://localhost:5173
npm test        # Suíte de testes automatizados (Vitest, 526 testes)
npm run lint    # Verificação de código (oxlint)
npm run build   # Compilação para produção
```

### Módulo Python de IA Musical (`music_ai_module`)

O módulo de IA opera de forma desacoplada e pode ser executado como serviço local ou via CLI:

```bash
# 1. Instalar dependências Python
python -m pip install "midigpt==0.4.2" music21 fastapi uvicorn pydantic

# 2. Iniciar o servidor HTTP local para o ChordPlanner
python -m uvicorn music_ai_module.server:app --host 127.0.0.1 --port 8765

# 3. Testes do módulo Python
python -m pytest music_ai_module/tests/ -v

# 4. Execução direta via CLI (lê JSON do stdin e devolve JSON no stdout)
python -m music_ai_module.cli < music_ai_module/tests/fixtures/sample_request.json
```

*Nota:* Os pesos do modelo `Metacreation/MIDI-GPT` são resolvidos automaticamente do cache local em `~/.cache/huggingface/hub/models--Metacreation--MIDI-GPT` ou baixados sob demanda com autenticação Hugging Face (`huggingface-cli login`).

---

### App de Desktop (macOS)

Versão standalone em Electron com todos os samples embutidos: funciona sem internet desde a instalação.

```bash
npm run app:samples   # baixa os samples de todos os instrumentos para desktop-samples/ (uma vez; ~130 MB)
npm run app           # abre o app de desktop a partir do build
npm run app:dist      # gera release/ChordPlanner-<versão>-arm64.dmg
```

- `electron/main.js` serve o build por `app://chordplanner/` e responde os pedidos de samples do disco: primeiro os embutidos, depois o cache do usuário (o que faltar é baixado uma vez e guardado).
- Web MIDI liberado só para o próprio app; exports abrem a janela "Salvar como" do sistema; o item "Link" some no desktop (endereço `app://` não abre em outro computador).
- O `.dmg` não é assinado: no próprio Mac abre normalmente; em outro Mac é preciso clicar com o botão direito → Abrir (ou assinar/notarizar com uma conta Apple Developer).
- Testes manuais: `CHORDPLANNER_OFFLINE=1` simula o computador sem internet; `CHORDPLANNER_DEBUG=1` registra os pedidos de permissão. Ícone: `scripts/gen-mac-icon.py`.
- Instalação das dependências: o binário do Electron vem do script de instalação do pacote. Se o npm bloquear scripts, rode `node node_modules/electron/install.js`.

---

### App de Desktop (Windows)

Sem Node.js instalado no sistema: `scripts/env.ps1` baixa um Node portátil para `.tools\node` (ignorado pelo git) e o põe no PATH da sessão.

```powershell
powershell -ExecutionPolicy Bypass -NoExit -File .\scripts\env.ps1   # ou: $env:Path="$PWD\.tools\node;$env:Path"
npm ci
node node_modules/electron/install.js   # se o npm bloquear o script de instalação do Electron
npm run app:dist:win                    # gera release\ChordPlanner-Setup-<versão>.exe (NSIS, x64)
```

- O instalador não é assinado: o Windows SmartScreen avisa na primeira execução ("Mais informações" → "Executar assim mesmo").
- Sem `npm run app:samples` antes, os samples não vão embutidos: cada instrumento é baixado no primeiro uso e fica no cache do usuário.

---

## 🎼 Estrutura do Código

- `src/core/` — teoria musical pura e testada (escalas, acordes, diatônicos, modificadores, voicings, análise funcional, tempo, arranjo, braço de violão, prática, melodia monofônica, auto-harmonização e roda Camelot).
- `src/ai/` — cliente de integração TypeScript com o módulo `music_ai_module`, serialização de blocos e conversão de notas/cifras geradas por IA.
- `music_ai_module/` — módulo Python neuro-simbólico:
  - `symbolic_engine/`: Skill Loader (`music-composition`), LLM & Planejador Teórico Determinístico, Primer Builder e Validador Harmônico.
  - `generative_engine/`: Wrapper oficial do `midigpt`, mapeador de controles expressivos e gerenciador de modelos.
  - `io_bridge/`: Conversores de formato e extrator harmônico de cifras.
- `src/audio/` — motor de áudio. `engine.ts` é uma fachada leve; Tone.js e smplr (`player.ts`, `loaders.ts`) só são carregados sob demanda. Samples via smplr: SplendidGrandPiano, E-Pianos, VCSL, Smolken e MusyngKite (FluidR3 como plano B).
- `src/state/` — store Zustand com desfazer/refazer atômico (`commit`), seleção e persistência em `localStorage`.
- `src/export/` — MIDI (`.mid`, com trilha de melodia, acordes e nomes em lyrics), MusicXML (3 partes), ABC, ChordPro, cifra em texto, arquivo JSON e link de compartilhamento (`#s=…`).
- `src/ui/` — componentes React (Roda Harmônica, Arranjo, Melodia, Progressão, Modificadores, Painel IA, Seletores).
- `src/sw/` e `src/pwa.ts` — service worker gerado no build (`vite.config.ts`) para uso offline como PWA.

---

Roadmap de IA e arquitetura: [`ROADMAP.md`](ROADMAP.md) · Roadmap das etapas: [`ROADMAP_FINAL.md`](ROADMAP_FINAL.md) · Expansões futuras: [`ROADMAP_FUTURO.md`](ROADMAP_FUTURO.md).
