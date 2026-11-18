# ChordPlanner — Roadmap final

> Criado em 13/11/2026 a partir da revisão do código contra o [`DESIGN.md`](DESIGN.md); atualizado em 18/11/2026 com o roadmap concluído.
> As seções (§) referem-se ao `DESIGN.md`. Este arquivo substitui o roadmap do §9 como lista de trabalho.

## Onde o projeto está

- **MVP, v1, v2 e v3: concluídos.** Todos os itens das Etapas 1 a 5 abaixo estão feitos.
- **Pendente fora do código:** licença do projeto e dos samples, publicação (Etapa 0) e as decisões em aberto do fim deste arquivo.
- **Saúde:** typecheck, lint e build limpos; 431 testes passando.

### Entregue depois do roadmap (18/11/2026)

- Layout em tela cheia: topo fixo ou automático (faixa fina que abre ao passar o mouse) e painel inferior completo ou compacto, sobreposto à roda, acompanhando a reprodução.
- Exportação para DAW e partitura num menu único: MIDI com nomes dos acordes, MusicXML (valida no XSD 4.0), ABC e ChordPro.
- App de desktop para macOS (Electron) com todos os samples embutidos, offline desde a instalação, Web MIDI liberado.
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

---

## Decisões em aberto (§11)

Estas respostas mudam a prioridade dos itens acima.

1. Público principal: iniciante (lista por graus em destaque) ou intermediário/avançado (roda e tensões)?
2. Instrumento de referência para voicings: piano, violão ou ambos? Define o desenho da Etapa 4.
3. Microtons reais ou a aproximação em 12-TET basta?
4. Banco de samples (MusyngKite ou FluidR3) e se precisa funcionar offline antes da PWA.
5. Samples dedicados para os instrumentos aproximados (≈) ou a aproximação GM basta?
6. Modulação por bloco é prioridade, ou o arranjo fica sempre numa tonalidade só?
