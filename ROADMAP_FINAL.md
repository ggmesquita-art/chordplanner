# ChordPlanner — Roadmap final

> Criado em 13/11/2026 a partir da revisão do código contra o [`DESIGN.md`](DESIGN.md); atualizado em 18/11/2026 com a v1–v3 concluída e em 21/11/2026 com o planejamento da Etapa 6 (v4 — Camada de Melodia, Acordes Curtos e Respiro/N.C.).
> As seções (§) referem-se ao `DESIGN.md`. Este arquivo substitui o roadmap do §9 como lista de trabalho. Para ideias e expansões pós-v4, veja [`ROADMAP_FUTURO.md`](ROADMAP_FUTURO.md).

## Onde o projeto está

- **MVP, v1, v2, v3, v4 e Módulo Neuro-Simbólico IA (Etapas 1 a 6 + Módulo IA): concluídos.**
- **Expansões futuras (pós-v4):** catalogadas em [`ROADMAP_FUTURO.md`](ROADMAP_FUTURO.md).
- **Pendente fora do código:** licença do projeto e dos samples, publicação (Etapa 0) e as decisões em aberto do fim deste arquivo.
- **Saúde:** typecheck, lint e build limpos; 526 testes passando no frontend (Vitest) e 48 testes passando no módulo de IA (pytest) (23/11/2026).

### Entregue na v0.2.0 (23/11/2026)

- **Módulo de IA Musical Neuro-Simbólica (`music_ai_module`)**:
  - Integração com `Metacreation/MIDI-GPT` (checkpoints locais `expressive_medium`, `prism_medium`, `yellow_medium` e `yellow_small`) e com a base de conhecimento da Skill `music-composition`.
  - Servidor local FastAPI (`127.0.0.1:8765`), CLI com entrada/saída JSON para pipelines e suíte completa com 48 testes pytest automatizados.
  - Painel de IA Musical no ChordPlanner (`AIPanel`) sincronizado com a Roda Camelot (`1A..12A`, `1B..12B`), modos de geração (*Harmonizar Melodia*, *Gerar Melodia*, *Acompanhamento Completo*, *Inpainting de Compassos*), controles finos de performance humana (velocity, microtiming, densidade, polifonia, duração) e aplicação atômica com Undo/Redo (`Ctrl+Z`).
- **Ajustes de Usabilidade e Layout**:
  - Opção "Ajustar na área visível" (`timelineFit`) no Dock: ajusta melodia e acordes dinamicamente sem rolagem horizontal.
  - Arranjo horizontal dinâmico: novos blocos dividem proporcionalmente o espaço sem crescimento vertical; barra de ações de bloco extraída para linha única (`.block-actions-bar`).
  - Checkbox `Iniciar com o acorde selecionado` revisada para iniciar vazia por padrão.

### Entregue depois do roadmap (18/11/2026 – 21/11/2026)

- Layout em tela cheia: topo fixo ou automático (faixa fina que abre ao passar o mouse) e painel inferior completo ou compacto, sobreposto à roda, acompanhando a reprodução.
- Exportação para DAW e partitura num menu único: MIDI com nomes dos acordes, MusicXML (valida no XSD 4.0), ABC e ChordPro.
- App de desktop para macOS (Electron) com todos os samples embutidos, offline desde a instalação, Web MIDI liberado.
- Build de desktop para Windows (`npm run app:dist:win`): instalador NSIS x64 em `package.json` e ambiente portátil com Node.js por projeto em [`scripts/env.ps1`](scripts/env.ps1).
- Teclado MIDI: reconhece o acorde tocado (nome, grau, destaque na roda), toca com o instrumento atual (com pedal) e grava a progressão ao soltar as teclas.
- Cache de samples só guarda respostas válidas (antes um 503 passageiro do servidor ficava guardado para sempre e a nota emudecia).

### Entregue na rodada anterior

- Desfazer/refazer restaura tônica e escala junto com a música.
- Campo de BPM sem limite a cada tecla; BPM e canal MIDI por bloco com limites.
- Falha ao salvar visível na interface, sem marcar a música como salva.
- Marcadores do export MIDI no tick certo para blocos vazios.
- Sessão e músicas validadas ao carregar; conteúdo de arquivo ou link tratado como entrada não confiável.
- Export/import JSON, link de compartilhamento (`#s=…`), contagem de 1 compasso.
- Tela de erro com recuperação; sessão gravada ao fechar a aba.

---

## Etapa 0 — Arrumar a casa

- [x] Commitar as mudanças da última rodada (branch `roadmap`; `main` continua no commit inicial).
- [x] CI rodando `tsc -b`, `oxlint`, `vitest run` e `vite build` a cada push (`.github/workflows/ci.yml`; começa a valer quando o repositório tiver um remoto no GitHub).
- [x] Scripts de setup de orquestração movidos para `scripts/`.
- [ ] Escolher a licença do projeto e conferir a licença de redistribuição dos samples (§11.4).
- [ ] Definir onde o app será publicado e documentar o deploy no `README.md`. (App de desktop para macOS já gera `.dmg`; falta decidir assinatura/notarização e a publicação web.)

## Etapa 1 — Fechar a v1

Edição da progressão (§3.4, §3.8)
- [x] Mudar a duração arrastando a borda do card (com alternativa por teclado na alça).
- [x] Seletor de grade de edição (½, 1, 2, 4 tempos, compasso inteiro). Vale a grade do design: `DURATION_STEPS` foi removido e os botões −/+ andam pela grade.
- [x] Ligadura visual quando o acorde cruza a barra de compasso.
- [x] Régua contínua em `compasso.tempo` e numeração de compassos ao longo do bloco no arranjo (hoje só no início).

Reprodução (§3.8, §5.1)
- [x] Tocar uma região selecionada (Shift+clique marca a região; escopo "Região" no transporte).
- [x] Agrupar a pulsação em compassos compostos (6/8 = 2 pulsos) no metrônomo e na contagem.
- [x] Swing no metrônomo e no cursor: conferido, nada a mudar — o swing só atrasa subdivisões internas do padrão; tempos inteiros e o ataque do acorde não se deslocam.

Roda de acordes (§3.3)
- [x] Toggle para a lista por graus.
- [x] Tocar o acorde no hover: opção própria "Som ao passar o mouse", desligada por padrão.
- [x] Destacar notas em comum nos três anéis.
- [x] Menu radial de qualidades extras fecha com Esc e clique fora.

Modificadores e blocos (§3.5, §3.8, §4)
- [x] Opção conflitante desabilitada com tooltip. Alterações (♭9, ♯11…) continuam podendo conviver com a extensão natural: o núcleo troca a nota, o que permite acordes como 13(♭9).
- [x] Trocar a cor do bloco; pedir confirmação ao excluir um bloco.

Instrumentos e layout (§3.1, §3.9, §5.2)
- [x] Progresso percentual do carregamento de samples (não conferido com download real).
- [x] Aviso de notas omitidas por tessitura em cada card da progressão.
- [x] No celular, modificadores em gaveta inferior.

## Etapa 2 — Acessibilidade (§8)

- [x] Progressão: Enter seleciona o card; ←/→ movem o foco; Alt+←/→ reordenam (com anúncio para leitor de tela).
- [x] Arranjo: cards focáveis e reordenáveis pelo teclado.
- [x] Opções de escala e de instrumento navegáveis pelo teclado (↑↓, Enter, Alt+P ouve); setas nos controles segmentados.
- [x] `prefers-reduced-motion` para a rotação da roda e o pulso do acorde tocando.
- [ ] Ícone além da cor em todos os estados da roda (✓ diatônico, ◐ cromático, ⚠ fora).
- [x] Toggle de tema Auto/Claro/Escuro.
- [x] Menu "Abrir": lista simples, sem botão aninhado em `role="option"`.

## Etapa 3 — Qualidade técnica

Áudio (`src/audio/engine.ts`)
- [x] Liberar instrumentos que saíram de uso (LRU: no máximo 6 sampleados e 8 synths).
- [x] `stop()` cancela também os previews agendados.
- [x] `panic()` só age na porta MIDI em uso; `panicAll()` separado.
- [x] Metrônomo e contagem pelo limiter do bus master (sem reverb).
- [x] AudioContext suspenso encerra a reprodução; timeout de 20 s no carregamento de samples.
- [x] Carregamento de samples extraído para `audio/loaders.ts`.

Arquitetura (§7)
- [x] Cálculo musical fora dos componentes: funções puras em `core/view.ts` e `core/tempo.ts`, com testes.
- [x] Tone.js, smplr e `@tonejs/midi` carregados sob demanda: o carregamento inicial caiu de 193 kB para 110 kB (gzip). O AudioContext nasce de forma síncrona no primeiro gesto (destrava o áudio no Safari/iOS) e o Tone o adota.
- [x] Caminho de migração do formato salvo (`export/migrate.ts`), usado por sessão, músicas salvas e arquivos.

Pendências pequenas
- [x] Edições seguidas de BPM e swing em menos de 1 s viram um passo só de desfazer.
- [x] Renomear com o armazenamento cheio mostra o alerta de falha.
- [x] O hash de alterações ignora ids de acordes e itens: dados antigos sem ids não aparecem como alterados.

Testes (§10)
- [x] Testes próprios para progressão, arranjo, seletores, modificadores, painel MIDI e teclado da roda.
- [x] Teste confere **quais** fatias a roda libera nos modos Estrito e Colorido.
- [x] Testes de `templates.ts` e de fórmulas mistas (4/4 → 7/8 → 6/8).
- [x] Testes de gravação ao fechar, descarte da sessão e "Salvar e abrir"/"Salvar e continuar" com falha.

## Etapa 4 — v2

Ordem sugerida: os dois primeiros itens destravam os demais.

- [x] **Voicings** — Fechado, Aberto, Drop 2, Drop 3, Quartal, Shell (§3.5), no painel de modificadores.
- [x] **Análise funcional** — `core/analysis.ts`; função harmônica T/SD/D nos cards (§3.7).
- [x] Sugestão de próximo acorde na roda, com o motivo (ii–V–I, dominante → tônica…) (§3.7).
- [x] Condução de vozes automática, opcional (§5.1).
- [x] Sétimas por grau (7, maj7, m7, m(maj7), m7♭5, °7) como chips na lista por graus (§2.5).
- [x] Empréstimos de outros modos com a mesma tônica, ii/x secundários e substituto de trítono (♭II → I) (§3.7). Com isso o modo Colorido libera bem mais: 25 de 36 fatias em Ré maior (antes 18).
- [x] Modulação por bloco: tônica e escala próprias ("Modular" no cabeçalho do bloco); a roda, a grafia, os graus, a cifra e o bordão seguem o tom do bloco (§3.8).
- [x] Ritardando/accelerando por bloco ("♩ final"), também no export MIDI (§3.8).
- [x] Casa 1/casa 2: a casa 2 substitui o último compasso na última repetição; edição na progressão ("+ Casa 2") e cifra com `|: … 1. … :| 2. … |` (§3.8).
- [x] Camada de baixo com instrumento próprio por bloco, também na trilha "Baixo" do MIDI (§3.9).
- [x] Bordão contínuo na tônica por bloco, para instrumentos com `drone` (sitar, gaita de foles) (§5.2).
- [x] Re-ataque por compasso para instrumentos de decay em acordes longos (toggle "Re-atacar") (§5.2).

## Etapa 5 — v3

- [x] Visualização de braço de violão (Teclado | Violão no painel de modificadores), com digitação tocável calculada em `core/fretboard.ts`.
- [x] Modo prática: cadência + acorde, responder o grau (Básico ou Todos os graus), com placar.
- [x] PWA offline: manifest, ícones e service worker gerado no build; o app abre sem rede depois da primeira visita (samples só os já baixados).

## Etapa 6 — v4: Camada de Melodia, Acordes Curtos e Respiro (N.C.)

### Especificação fechada (21/11/2026)

- **3 camadas no Dock:** Arranjo (blocos) → Melodia (nova) → Acordes (atualizada), com divisor vertical arrastável entre Roda e Dock e botão para recolher/focar a Melodia.
- **Visualização da Melodia:** piano roll compacto dobrado na escala em `Estrito` (só notas da escala + linha de aviso quando houver nota fora) e cromático destacando a escala em `Colorido`/`Livre`; janela padrão `C4–C6` com scroll vertical até `C2–C7`.
- **Alinhamento & Playhead:** mesma escala horizontal (`px/tempo`), zoom horizontal, régua de compassos única, scroll horizontal acoplado e agulha vertical contínua de playhead atravessando Melodia e Acordes.
- **Modelo da Melodia:** monofônica (`melody?: MelodyNote[]` dentro de `Block`, `{ id, pitch, start, duration, velocity? }`; sobreposição substitui ou encurta a nota anterior), com suporte a Casa 2 (`melodyEnding`).
- **Fluxo "Melodia primeiro":** duração do bloco desacoplada dos acordes (`max(acordes, melodia)`), permitindo criar e tocar blocos só com melodia antes de harmonizar.
- **Grades & Durações:** grades independentes (Melodia e Acordes) indo até `¼` tempo (`0.25`, semicolcheia em potências de 2, sem tercinas, mantendo `DIV_PER_WHOLE = 64`); acorde novo nasce com a duração da grade de acordes ativa.
- **Respiro / Ausente (`N.C.`):** item explícito de pausa na pista de acordes, botão/atalho `+ Respiro (N.C.)`, e clique em tempo vazio sob a melodia preenchendo automaticamente a lacuna anterior com `N.C.`.
- **Troca de tônica / escala:** trocar tônica transpõe a melodia junto (menor salto de oitava); trocar escala preserva notas, sinaliza notas fora com `⚠` e oferece botão "Ajustar à escala".
- **Entrada da Melodia:** clique/arraste por mouse/teclado na grade (altura, duração, preview sonoro, apagar) + teclado MIDI em modo passo-a-passo e gravação em tempo real (com count-in, metrônomo e quantização).
- **Inteligência Melodia ↔ Roda:** coloração das notas da melodia em relação ao acorde abaixo (nota do acorde / tensão / passagem / `N.C.`), destaque na `ChordWheel` e `DegreeStrip` dos acordes compatíveis no tempo selecionado e botão **"Auto-harmonizar"** (usando a grade de acordes como ritmo harmônico, pontuando tempos fortes + fluxo funcional `T`/`SD`/`D`, com opções "Preencher vazios" ou "Substituir tudo" e Desfazer).
- **Áudio & Mixagem:** `melodyInstrument` (global + override por bloco), controles Mute/Solo/Volume ao vivo separados (`Melodia` × `Acordes/Baixo`), canal MIDI próprio para Melodia e proteção contra corte de nota repetida no mesmo timbre. No `N.C.`, acordes e baixo silenciam, `voiceLeading` preserva a referência anterior, bordão (`drone`) continua soando e metrônomo segue clicando; clamp de `strum`/`arp`/`comping` em acordes `< 0.5` tempo.
- **Exportação & Migração:** schema `v1 → v2` retrocompatível (`localStorage`, `.json`, `#s=`), MIDI com trilha/canal de Melodia, MusicXML com 3 partes (`P1` Melodia, `P2` Acordes, `P3` Baixo), ABC com 3 vozes, ChordPro e Texto com `N.C.`.

### Fase 6.1 — Núcleo, Schema (`v1 → v2`) e Motor de Áudio (`src/core/`, `src/state/`, `src/audio/`, `src/export/migrate|json|url`)

- [x] Definir `MelodyNote` (`{ id, pitch, start, duration, velocity? }`), `melody` e `melodyEnding` em `Block` (`src/core/song.ts`), mantendo regra monofônica sem sobreposição.
- [x] Adicionar representação explícita de pausa (`N.C.`) em `Chord` (`src/core/chords.ts`) e proteger `voicing.ts`, `diatonic.ts`, `analysis.ts`, `modifiers.ts` e `view.ts` contra itens sem fundamental/qualidade.
- [x] Ampliar `GRIDS` (`src/core/timeline.ts`) para incluir `0.25` tempo (`¼` / semicolcheia) e ajustar piso mínimo de `setDuration` (`src/state/store.ts`).
- [x] Desacoplar duração do bloco em `expandArrangement`/`expandRegion` (`src/core/song.ts`) usando `max(acordes, melodia)`, inclusive para blocos sem acordes e corte de Casa 2 (`endingCut`).
- [x] Atualizar `src/state/store.ts`: ações de CRUD de notas da melodia (com undo/redo), `melodyInstrument` (global e por bloco), transposição de melodia em `setTonic` (menor salto de oitava), sinalização e ação "Ajustar à escala", `addChord` usando duração da grade ativa, inserção de `N.C.` (manual e automática em lacunas), e `contentHash` atualizado.
- [x] Implementar migração `v1 → v2` em `src/export/migrate.ts` e validação/saneamento em `src/export/json.ts`, `src/export/url.ts` e `src/state/repository.ts` mantendo retrocompatibilidade com sessões, `.json` e links `#s=` antigos.
- [x] Atualizar `src/audio/render.ts`, `src/audio/loaders.ts`, `src/audio/player.ts`, `src/audio/engine.ts` e `src/audio/midi.ts`: renderizar eventos de melodia (com swing e `melodyEnding`), criar buses/gains separados (`Melodia` × `Acordes/Baixo`) para Mute/Solo/Volume ao vivo, isolar canal MIDI da melodia, evitar corte de nota repetida no mesmo timbre, tratar `N.C.` (`voiceLeading` preservado, `drone` contínuo, metrônomo ativo) e limitar `strum`/`arp`/`comping` para não vazarem em acordes `< 0.5` tempo.

### Fase 6.2 — Interface das 3 Camadas Alinhadas (`src/ui/`)

- [x] Reestruturar o `Dock` (`src/ui/Layout/Dock.tsx`) para 3 faixas (Arranjo → Melodia → Acordes) com divisor vertical arrastável entre a Roda e o Dock e botão recolher/focar Melodia.
- [x] Construir componente da pista **Melodia**: piano roll compacto dobrado na escala em `Estrito` (com faixa de aviso para notas fora) e cromático com destaque da escala em `Colorido`/`Livre`, janela padrão `C4–C6` com scroll vertical `C2–C7`.
- [x] Implementar edição completa na grade de melodia (clique para inserir/apagar, arraste vertical de altura e horizontal de duração com `snapDuration`, preview sonoro, seleção e atalhos de teclado) + seletor de grade própria, seletor de `melodyInstrument`, controles Mute/Solo/Volume ao vivo e botão "Ajustar à escala".
- [x] Sincronizar escala horizontal (`px/tempo`), zoom horizontal, régua de compassos única, scroll horizontal acoplado e agulha vertical contínua de playhead entre Melodia e Acordes.
- [x] Atualizar a faixa de **Acordes** (`src/ui/Progression/Progression.tsx`): remover piso fixo incompatível de `88px` para respeitar o alinhamento proporcional, adicionar `¼ tempo` na grade, botão/atalho `+ Respiro (N.C.)`, criação de `N.C.` automático ao preencher lacuna sob a melodia e atualização do `ResizeHandle` para `0.25`.

### Fase 6.3 — Inteligência Harmônica & Gravação MIDI (`src/core/harmonize.ts`, `src/ui/`)

- [x] Criar funções puras em `src/core/harmonize.ts` para classificar notas da melodia frente ao acorde subjacente (nota do acorde / tensão / passagem / `N.C.`) e colorir os blocos no piano roll.
- [x] Pontuar compatibilidade dos acordes com a melodia no trecho/cursor selecionado e destacar os candidatos na `ChordWheel` (`src/ui/ChordWheel/ChordWheel.tsx`) e `DegreeStrip`.
- [x] Implementar algoritmo e botão **"Auto-harmonizar"** usando a grade de acordes ativa como ritmo harmônico, pontuando notas de tempo forte + fluxo funcional (`T`/`SD`/`D`) e deixando trechos vazios como sustentação ou `N.C.`, com escolha entre "Preencher vazios" e "Substituir tudo" (reversível com Desfazer).
- [x] Adicionar gravação de melodia pelo teclado MIDI (`src/ui/useMidiInput.ts` + `src/ui/Transport/MidiPanel.tsx`, sincronizada com o relógio de áudio via `getPlaybackTime()`): seletor de destino `Acordes | Melodia (passo a passo / tempo real)`, canal MIDI da melodia, count-in, metrônomo e quantização na grade da melodia.

### Fase 6.4 — Exportadores Completos & Verificação (`src/core/notation.ts`, `src/export/`)

- [x] Adicionar grafia enarmônica de melodia orientada por escala/armadura em `src/core/notation.ts` e estender `buildSegments` para transportar melodia, `melodyEnding` e `N.C.`.
- [x] Atualizar `src/export/midi.ts` (trilha/canal próprio para Melodia), `src/export/musicxml.ts` (3 partes quando há melodia: `P1` Melodia em Sol, `P2` Acordes, `P3` Baixo em Fá; `<harmony>` e pausas), `src/export/abc.ts` (`V:1` Melodia, `V:2` Acordes, `V:3` Baixo) e `src/export/chordpro.ts` / `src/export/text.ts` (emissão explícita de `[N.C.]` / `N.C.` em pausas).
- [x] Cobrir todas as novas funções e regressões com testes unitários/integração e validar `tsc -b`, `oxlint`, `vitest run` e `vite build`.

---

## Decisões em aberto (§11)

Estas respostas mudam a prioridade dos itens acima.

1. Público principal: iniciante (lista por graus em destaque) ou intermediário/avançado (roda e tensões)?
2. Instrumento de referência para voicings: piano, violão ou ambos? Define o desenho da Etapa 4.
3. Microtons reais ou a aproximação em 12-TET basta?
4. Banco de samples (MusyngKite ou FluidR3) e se precisa funcionar offline antes da PWA.
5. Samples dedicados para os instrumentos aproximados (≈) ou a aproximação GM basta?
6. Modulação por bloco é prioridade, ou o arranjo fica sempre numa tonalidade só?
