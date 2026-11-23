# ChordPlanner — Roadmap Futuro (Pós-v4)

> Criado em 21/11/2026. Reúne possibilidades de expansão para além da **Etapa 6 (v4)** descrita em [`ROADMAP_FINAL.md`](ROADMAP_FINAL.md), incluindo alternativas descartadas do escopo imediato da v4 e novas frentes alinhadas à arquitetura do projeto.
> Este documento é um catálogo de ideias (sem compromisso de ordem ou prioridade).

---

## 1. Melodia, Ritmo e Notação Avançados

- **Tercinas e quiálteras (`1/3`, `1/6`, `1/5`):** ampliar a base rítmica de `src/core/notation.ts` (`DIV_PER_WHOLE` de `64` para `192` ou múltiplo compatível com divisões ternárias), atualizar `GRIDS` em `src/core/timeline.ts` e emitir `<time-modification>` / `<tuplet>` no MusicXML (`src/export/musicxml.ts`) e `(3` no ABC (`src/export/abc.ts`).
- **Melodia polifônica e 2ª voz (contracanto):** permitir notas simultâneas na pista de melodia (duetos em terças/sextas, vozes paralelas ou chave opcional "permitir sobreposição"), dividindo vozes (`<voice>1/2`) no MusicXML e `V:` no ABC.
- **Subdivisões mais finas e ornamentos:** suporte na grade até `⅛` de tempo (fusas em potências de 2), além de apojaturas, trinados e mordentes com reprodução aproximada no áudio e marcação na partitura.
- **Dinâmica, expressão e articulações:** edição individual de *velocity* por nota na grade, *legato*/*slur*, *staccato*, *ghost notes*, *pitch bend* / *portamento* real em timbres monofônicos (`polyphony: "mono"` em `src/audio/instruments.ts`) e humanização configurável para a linha melódica.
- **Visualização de Pauta Musical interativa na tela:** alternador `Piano Roll | Pauta` aproveitando a estrutura intermediária de `src/core/notation.ts` (`buildSegments`, `barCells`, `spellChordNotes`, `AccidentalTracker`), com leitura e edição básica direto em clave de Sol.
- **`MiniKeyboard` e `Fretboard` interativos:** tornar clicáveis o teclado lateral (`src/ui/MiniKeyboard/MiniKeyboard.tsx`) e o braço de violão (`src/ui/Fretboard/Fretboard.tsx`) para ouvir notas avulsas, inseri-las na melodia, destacar a nota melódica ativa sobre o diagrama e apoiar arranjos de *chord-melody*.

---

## 2. Inteligência Harmônica e Composição Assistida

- **Auto-harmonização avançada:** ritmo harmônico variável automático (mudança de acorde guiada por transições de função harmônica ou mudanças de motivo), mistura controlada de tríades, tétrades e tensões por estilo, e modo *chord-melody* (posicionando a nota da melodia no topo do *voicing* calculado em `src/core/voicing.ts`).
- **Re-harmonização inteligente de melodia:** dado um bloco com melodia e acordes, sugerir ou aplicar substituições preservando a compatibilidade melódica — relativos diatônicos, dominantes secundários (`V/x`), substituto de trítono (`♭II7`), empréstimos modais, *backdoor* (`♭VII7 → I`) e presets por gênero (Jazz, MPB/Bossa, Pop, Gospel).
- **Detecção automática de tonalidade e escala:** analisar uma melodia livre ou arquivo MIDI importado e ranquear pares `(tônica, escala)` compatíveis entre as 12 famílias de `src/core/scales.ts`.
- **Transformações motívicas:** ferramentas de edição rápida sobre trechos selecionados da melodia (transposição diatônica por graus, inversão melódica, retrogradação, aumentação/diminuição rítmica e gerador de variação/resposta para frase B).
- **Análise harmônica aprofundada:** detecção automática de cadências (autêntica, plagal, deceptiva, meia-cadência), sugestão de acordes-pivô para modulação entre blocos (`block.key`), alertas de *avoid notes* entre melodia e *voicing* e visualização de condução de vozes (*voice-leading* linhas entre notas).

---

## 3. Arranjo, Acompanhamento, Baixo e Letra

- **Pista de bateria/percussão e *grooves* por estilo:** catálogo de levadas rítmicas (bossa, samba, swing, pop, rock, valsa, 6/8, 7/8, funk) com variação de intensidade entre blocos (verso/refrão), viradas (*fills*) automáticas no último compasso e adaptação à Casa 2 (`ending`).
- **Editor de levadas e arpejos customizados:** além dos 4 padrões fixos (`block`, `arp-up`, `arp-down`, `comping` em `src/audio/render.ts`), permitir desenhar padrões rítmicos de acompanhamento e direção de palhetada/batida (↑/↓/abafado) por bloco.
- **Linha de baixo editável e geradores de baixo:** evoluir a camada `bassInstrument` (hoje fixa em `voiced[0]`) para oferecer padrões de *walking bass*, baixo pedal, condução por fundamental/quinta/aproximação cromática e edição manual nota a nota.
- **Letra (*lyrics*) associada à melodia e aos compassos:** campo de sílabas/texto ancorado às notas da melodia ou tempos do acorde, exportando para ChordPro (`src/export/chordpro.ts`), `<lyric>` no MusicXML e `w:` no ABC.

---

## 4. Áudio, MIDI e Ecossistema DAW

- **Sincronia MIDI Clock (`0xF8` / `0xFA` / `0xFC`):** suporte a envio e recepção de clock MIDI e Start/Stop/Continue em `src/audio/midi.ts` e `src/audio/midiInput.ts` para sincronizar o ChordPlanner com DAWs (Ableton, Logic, Reaper) e hardware externo.
- **Importação de `.mid` e `.musicxml`:** abrir arquivos MIDI padrão (SMF) ou MusicXML para extrair melodia e/ou progressão de acordes diretamente para blocos do ChordPlanner, permitindo harmonizar músicas externas na roda.
- **Exportação de áudio offline (`.wav` / `.mp3` e *stems*):** renderização mais rápida que o tempo real via `OfflineAudioContext` para baixar a mistura completa ou faixas separadas (*Melodia*, *Acordes*, *Baixo*, *Bordão*, *Metrônomo*).
- **Mixer avançado, afinação e microtons:** controle de *pan* L/R, envio de *reverb*/delay e EQ por pista em `src/audio/loaders.ts`, ajuste de diapasão (`A4 = 432/440/442 Hz`) e suporte a temperamentos históricos / microtons reais além da grade 12-TET atual (`DESIGN.md` §11.3).
- **Transcrição por microfone (*pitch-to-MIDI*):** captura monofônica pelo microfone para cantarolar ou tocar um instrumento acústico e converter em notas quantizadas na pista de Melodia.
- **Samples dedicados e pacotes opcionais:** substituir instrumentos marcados como aproximação (`≈`) em `src/audio/instruments.ts` por bibliotecas dedicadas e oferecer pacotes de samples sob demanda na versão web/desktop.

---

## 5. Prática, Performance, Nuvem e Distribuição

- **Modo Prática v2:** ampliar `src/core/practice.ts` e `src/ui/Practice/Practice.tsx` com ditado melódico dentro da escala, reconhecimento de intervalos/inversões/tensões e resposta interativa usando o teclado MIDI conectado.
- **Modo Palco / Performance:** visualização limpa em tela cheia exibindo cifra, letra e guia visual de melodia com rolagem automática sincronizada ao andamento, contagem visual de compassos e transposição em um clique.
- **Sincronização em nuvem e colaboração:** implementar backend opcional por trás da interface `SongRepository` (`src/state/repository.ts`) com contas de usuário, histórico de versões, biblioteca comunitária de templates/progressões e links curtos persistentes (reduzindo a dependência de URLs longas em `#s=`).
- **Empacotamento, assinatura e CI de release:** assinatura/notarização Apple Developer no `.dmg`, assinatura de código no instalador Windows (`.exe`/MSIX), auto-update no Electron, alvo Linux (`AppImage`/`.deb`), build automatizado de instaladores com opção de samples embutidos no GitHub Actions, além da definição formal das licenças do projeto e redistribuição dos samples (`ROADMAP_FINAL.md` Etapa 0).
- **Acessibilidade e refinamentos de interface:** ícones além da cor em todos os estados da roda (`✓` diatônico, `◐` cromático, `⚠` fora — pendência da Etapa 2), mapeamento de atalhos personalizáveis e gestos *touch* dedicados para edição do piano roll e redimensionamento de acordes em tablets.
