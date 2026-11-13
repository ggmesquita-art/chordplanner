# ChordPlanner — Roadmap final

> Situação em 13/11/2026, depois da revisão completa do código contra o [`DESIGN.md`](DESIGN.md).
> As seções (§) referem-se ao `DESIGN.md`. Este arquivo substitui o roadmap do §9 como lista de trabalho.

## Onde o projeto está

- **MVP: completo.** Catálogo de 73 escalas, roda de 3 anéis, progressão, modificadores, playback, 55 instrumentos.
- **v1: quase completa.** Blocos e arranjo, fórmulas de compasso, swing, templates, modos Estrito/Colorido/Livre, instrumentos sugeridos por escala, salvar/abrir, export de cifra, MIDI e JSON, link de compartilhamento e contagem estão prontos. Falta o que está na Etapa 1.
- **v2: só o que foi antecipado.** Dominantes secundárias, empréstimo modal, saída MIDI ao vivo e export `.mid` existem; o resto da v2 não começou.
- **Saúde:** typecheck, lint e build limpos; 91 testes passando; sem vulnerabilidades em `npm audit`.

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
- [ ] Mudar a duração arrastando a borda do card (hoje só há botões −/+).
- [ ] Seletor de grade de edição (½, 1, 2, 4 tempos, compasso inteiro). `DURATION_STEPS` em `src/core/timeline.ts` hoje é `[0.5, 1, 2, 3, 4, 6, 8, 12, 16]`, diferente do design: decidir qual vale.
- [ ] Ligadura visual quando o acorde cruza a barra de compasso.
- [ ] Régua contínua em `compasso.tempo` e numeração de compassos ao longo do bloco no arranjo (hoje só no início).

Reprodução (§3.8, §5.1)
- [ ] Tocar uma região selecionada (hoje: arranjo inteiro ou bloco).
- [ ] Agrupar a pulsação em compassos compostos (6/8 = 2 pulsos); `isCompound` existe e não é usada.
- [ ] Aplicar o swing também ao metrônomo e ao cursor.

Roda de acordes (§3.3)
- [ ] Toggle para a lista por graus (hoje sempre visível).
- [ ] Tocar o acorde no hover, respeitando "Som ao clicar".
- [ ] Destacar notas em comum nos três anéis (hoje só no externo).
- [ ] Menu radial de qualidades extras fecha com Esc e clique fora.

Modificadores e blocos (§3.5, §3.8, §4)
- [ ] Opção conflitante desabilitada com tooltip, em vez de removida em silêncio (`src/core/modifiers.ts`).
- [ ] Trocar a cor do bloco; pedir confirmação ao excluir um bloco.

Instrumentos e layout (§3.1, §3.9, §5.2)
- [ ] Progresso de carregamento de samples (hoje só um spinner).
- [ ] Aviso de notas omitidas por tessitura também durante a reprodução.
- [ ] No celular, modificadores em gaveta inferior.

## Etapa 2 — Acessibilidade (§8)

- [ ] Progressão: Enter seleciona o card; reordenar pelo teclado.
- [ ] Arranjo: cards focáveis e reordenáveis pelo teclado.
- [ ] Opções de escala e de instrumento navegáveis pelo teclado; setas nos controles segmentados do cabeçalho.
- [ ] `prefers-reduced-motion` para a rotação da roda e o pulso do acorde tocando.
- [ ] Ícone além da cor em todos os estados da roda (✓ diatônico, ◐ cromático, ⚠ fora).
- [ ] Toggle manual de tema claro/escuro (hoje só segue o sistema).
- [ ] Menu "Abrir": remover o botão aninhado dentro de `role="option"`.

## Etapa 3 — Qualidade técnica

Áudio (`src/audio/engine.ts`)
- [ ] Liberar instrumentos que saíram de uso (não há nenhum `dispose`; o mapa de carregados só cresce).
- [ ] `stop()` deve cancelar também os previews já agendados.
- [ ] `panic()` só deve enviar mensagens quando a saída MIDI estiver ligada.
- [ ] Metrônomo e contagem passando pelo bus master.
- [ ] Tratar o AudioContext suspenso no meio da sessão e dar timeout em carregamento travado.
- [ ] Extrair o carregamento de samples para `audio/loaders.ts`, como previsto no §7.

Arquitetura (§7)
- [ ] Tirar o cálculo musical de dentro dos componentes (`ScalePicker`, `ChordWheel`, `ModifierPanel`, `InstrumentPicker`, `Progression`, `Arrangement`, `Transport`) e levá-lo para `core/` ou seletores.
- [ ] Carregar Tone.js e smplr sob demanda: o bundle sai em um único arquivo de 672 kB (193 kB gzip).
- [ ] Caminho de migração para quando o formato salvo mudar de versão.

Pendências pequenas
- [ ] Digitar "300" no BPM gera dois passos de desfazer.
- [ ] Renomear uma música salva com o armazenamento cheio não avisa.
- [ ] Dados antigos sem ids podem aparecer como "alterações não salvas" ao reabrir.

Testes (§10)
- [ ] Componentes sem teste próprio: `Progression`, `Arrangement`, `ScalePicker`, `InstrumentPicker`, `ModifierPanel`, `MidiPanel` e a navegação por teclado da roda.
- [ ] Conferir **quais** fatias a roda desabilita (hoje o teste só conta quantas).
- [ ] `templates.ts`; conversão com fórmulas mistas (4/4 → 7/8 → 6/8).
- [ ] Gravação da sessão ao fechar, descarte da sessão, "Salvar e abrir" e "Salvar e continuar" quando o salvamento falha.

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
