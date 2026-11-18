# ChordPlanner — Roadmap final

> Situação em 13/11/2026, depois da revisão completa do código contra o [`DESIGN.md`](DESIGN.md).
> As seções (§) referem-se ao `DESIGN.md`. Este arquivo substitui o roadmap do §9 como lista de trabalho.

## Onde o projeto está

- **MVP: completo.** Catálogo de 73 escalas, roda de 3 anéis, progressão, modificadores, playback, 55 instrumentos.
- **v1: quase completa.** Blocos e arranjo, fórmulas de compasso, swing, templates, modos Estrito/Colorido/Livre, instrumentos sugeridos por escala, salvar/abrir, export de cifra, MIDI e JSON, link de compartilhamento e contagem estão prontos. Falta o que está na Etapa 1.
- **v2: só o que foi antecipado.** Dominantes secundárias, empréstimo modal, saída MIDI ao vivo e export `.mid` existem; o resto da v2 não começou.
- **Saúde:** typecheck, lint e build limpos; 240 testes passando; sem vulnerabilidades em `npm audit`.

### Entregue na última rodada

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
- [ ] Definir onde o app será publicado e documentar o deploy no `README.md`.

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

- [ ] **Voicings** — Aberto, Drop 2, Drop 3, Quartal, Shell (§3.5). O campo `voicing` existe no modelo, mas `src/core/voicing.ts` o ignora e o seletor está desabilitado.
- [ ] **Análise funcional** — criar `core/analysis.ts` com função harmônica T/SD/D nos cards (§3.7).
- [ ] Sugestão de próximo acorde na roda (§3.7).
- [ ] Condução de vozes automática, opcional (§5.1).
- [ ] Acordes com sétima no dicionário diatônico, para escalas como a Bebop dominante (§2.5).
- [ ] Outros empréstimos modais, ii–V secundários e substituto de trítono (§3.7).
- [ ] Modulação por bloco: tônica e escala próprias (§3.8).
- [ ] Ritardando/accelerando e casa 1/casa 2 (§3.8).
- [ ] Camadas acordes + baixo com instrumentos separados (§3.9).
- [ ] Bordão contínuo na tônica: a flag `drone` já existe no sitar e na gaita de foles, mas nada a usa (§5.2).
- [ ] Re-ataque por compasso para instrumentos de decay em acordes longos (§5.2).

## Etapa 5 — v3

- [ ] Visualização de braço de violão/guitarra.
- [ ] Modo prática: ouvir e adivinhar o grau.
- [ ] PWA offline.

---

## Decisões em aberto (§11)

Estas respostas mudam a prioridade dos itens acima.

1. Público principal: iniciante (lista por graus em destaque) ou intermediário/avançado (roda e tensões)?
2. Instrumento de referência para voicings: piano, violão ou ambos? Define o desenho da Etapa 4.
3. Microtons reais ou a aproximação em 12-TET basta?
4. Banco de samples (MusyngKite ou FluidR3) e se precisa funcionar offline antes da PWA.
5. Samples dedicados para os instrumentos aproximados (≈) ou a aproximação GM basta?
6. Modulação por bloco é prioridade, ou o arranjo fica sempre numa tonalidade só?
