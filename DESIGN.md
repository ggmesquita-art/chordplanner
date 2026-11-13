# ChordPlanner — Documento de Design

> Planejador de progressões de acordes guiado por escala, com roda de acordes (círculo de quintas) e um controle de modificadores para enriquecer a harmonia.

---

## 1. Visão geral

O ChordPlanner ajuda músicos a montar progressões de acordes coerentes com uma escala escolhida. O fluxo é:

1. O usuário escolhe uma **escala** num catálogo amplo (maiores, menores, modos, exóticas, simétricas…).
2. Escolhe a **tônica** (a "primeira nota"). A roda de acordes se reorganiza em torno dela.
3. A roda passa a **liberar apenas os acordes cujas notas pertencem à escala**; o resto fica esmaecido e bloqueado.
4. A **progressão** começa, por padrão, com o acorde da tônica. Um checkbox permite, em vez disso, começar pelo acorde que o usuário clicar (§3.4). O usuário segue clicando nos acordes liberados para montar a progressão numa linha do tempo.
5. Para cada acorde da progressão, um **segundo controle (Modificadores)** permite adicionar extensões, suspensões, alterações, inversões e voicings — dando uma sonoridade mais complexa.
6. As progressões são organizadas em **blocos** (Intro, Verso, Refrão…) dentro de um **arranjo**, com BPM, fórmula de compasso e repetições (§3.8).
7. A progressão pode ser **ouvida** num instrumento escolhido (synth, piano, cordas, instrumentos típicos da escala…) (§3.9, §5), analisada (graus em algarismos romanos / função harmônica) e **exportada**.

### Objetivos

- Catálogo de escalas o mais completo possível, sem depender de a escala ter 7 notas.
- Feedback visual imediato do que "cabe" na escala.
- Modificadores que mostram claramente se a nota adicionada é diatônica ou uma tensão/cromatismo.
- Funcionar no navegador, sem backend.

### Fora de escopo (v1)

- Edição de melodia / partitura completa.
- Gravação de áudio.
- Contas de usuário e sincronização na nuvem.

---

## 2. Conceitos musicais e modelo

### 2.1 Classes de altura (pitch classes)

Toda a lógica trabalha com inteiros de 0 a 11 (`C=0, C#/Db=1, … B=11`). A grafia (sustenido vs. bemol) é resolvida só na camada de apresentação (ver §2.6).

### 2.2 Escala

Uma escala é definida por um conjunto de intervalos em semitons a partir da tônica:

```ts
type ScaleDef = {
  id: string;              // "major", "dorian", "hirajoshi"...
  name: string;            // "Dórico"
  family: ScaleFamily;     // agrupamento no seletor
  intervals: number[];     // ex.: maior = [0,2,4,5,7,9,11]
  aliases?: string[];      // "Jônio", "Escala maior natural"
  mode?: { parent: string; degree: number }; // se for modo de outra escala
};
```

`pitchSet(tonic, scale) = scale.intervals.map(i => (tonic + i) % 12)`.

### 2.3 Catálogo de escalas

Meta: cobrir o máximo possível. Proposta inicial (~70 escalas), agrupadas por família:

| Família | Escalas |
|---|---|
| **Modos da escala maior** | Jônio (Maior), Dórico, Frígio, Lídio, Mixolídio, Eólio (Menor natural), Lócrio |
| **Modos da menor harmônica** | Menor harmônica, Lócrio ♮6, Jônio #5, Dórico #4 (Romeno), Frígio dominante, Lídio #2, Superlócrio 𝄫7 (Ultralócrio) |
| **Modos da menor melódica** | Menor melódica (jazz), Dórico ♭2, Lídio aumentado, Lídio dominante (Acústica), Mixolídio ♭6, Lócrio ♮2 (Meio-diminuto), Alterada (Superlócrio) |
| **Modos da maior harmônica** | Maior harmônica, Dórico ♭5, Frígio ♭4, Lídio ♭3, Mixolídio ♭2, Lídio aumentado #2, Lócrio 𝄫7 |
| **Modos da dupla harmônica** | Dupla harmônica (Bizantina/Árabe), Lídio #2 #6, Ultrafrígio, Húngara menor (Cigana), Oriental, Iônio #2 #5, Lócrio 𝄫3 𝄫7 |
| **Napolitanas e afins** | Napolitana maior, Napolitana menor, Enigmática, Húngara maior, Persa, Prometeu, Espanhola 8 tons |
| **Pentatônicas** | Maior, Menor, Egípcia (suspensa), Blues maior (Man Gong), Blues menor (Ritusen), Pentatônica dominante |
| **Blues** | Blues menor (hexatônica), Blues maior, Blues de 9 notas |
| **Bebop** | Bebop dominante, Bebop maior, Bebop dórico, Bebop menor melódica |
| **Simétricas** | Tons inteiros, Diminuta (T-sT), Diminuta dominante (sT-T), Aumentada (hexatônica), Tritônica, Cromática |
| **Japonesas / asiáticas** | Hirajoshi, In-sen, Iwato, Kumoi, Yo, Pelog, Slendro (aprox.), Chinesa |
| **Outras** | Húngara menor, Cigana espanhola, Judaica (Ahava Rabbah = Frígio dominante), Hexatônica de Coltrane, Escala de Messiaen (modos 3–7) |

Observações:
- Escalas iguais com nomes diferentes são uma única entrada com `aliases` (ex.: Frígio dominante = Ahava Rabbah = Espanhola).
- Escalas não temperadas (Pelog, Slendro, maqams) entram como **aproximação em 12-TET**, com aviso na UI.
- O catálogo fica em um arquivo de dados (`scales.json`/`scales.ts`), fácil de ampliar. Pode ser semeado a partir do dicionário do [`tonal`](https://github.com/tonaljs/tonal) (`Scale.names()`), que já traz ~90 escalas.

### 2.4 Acordes

```ts
type ChordQuality = {
  id: string;          // "maj", "m", "dim", "aug", "sus2", "sus4", "7", "maj7", "m7", "m7b5", "dim7"...
  symbol: string;      // "", "m", "°", "+", "sus4", "7", "maj7"...
  intervals: number[]; // a partir da fundamental
};

type Chord = {
  root: number;            // pitch class
  quality: string;         // id de ChordQuality
  modifiers: Modifier[];   // §4
  bass?: number;           // inversão / baixo invertido
  voicing?: VoicingId;
  duration: number;        // em tempos
};
```

### 2.5 Como descobrir os acordes "da escala" (algoritmo central)

Empilhar terças (graus 1-3-5) só funciona para escalas heptatônicas. Como o catálogo inclui pentatônicas, octatônicas, hexatônicas etc., o motor usa **casamento por conjunto**:

```
para cada nota r da escala:
  para cada qualidade Q do dicionário de acordes (tríades primeiro):
    notas = { (r + i) % 12 para i em Q.intervals }
    se notas ⊆ pitchSet(escala):
      acorde (r, Q) é diatônico
```

- Para escalas de 7 notas, também se calcula o **acorde "primário" por terças empilhadas** de cada grau — é ele que aparece em destaque na roda e recebe o algarismo romano (I, ii, iii…).
- Para escalas sem 7 notas, o acorde primário de cada grau é o primeiro match na ordem de prioridade: `maj, m, dim, aug, sus4, sus2, 5 (power chord)`.
- Resultado cacheado por `(tônica, escala)`.

### 2.6 Grafia das notas (enarmonia)

- Escalas heptatônicas: cada letra (C D E F G A B) aparece exatamente uma vez → escolher sustenido/bemol para garantir isso (Fá# maior tem E#, não F).
- Demais escalas: seguir a armadura preferida da tônica (tônicas do lado dos bemóis no círculo → bemóis; lado dos sustenidos → sustenidos).
- Toggle manual "♯ / ♭" para o usuário forçar.

---

## 3. Interface

### 3.1 Layout geral

```
┌──────────────────────────────────────────────────────────────────────┐
│  ChordPlanner   [Escala: Dórico ▾ 🔍]  [Tônica: D]  [♯/♭]  [🎹 Piano ▾] │
│  ▶ ■ ⟲   ♩=90   4/4   swing 0%   ⏱ 3.2.1   🔔 metrônomo   ⏺ contagem  │
├──────────────────────────────┬───────────────────────────────────────┤
│                              │  MODIFICADORES — acorde 3: Em7        │
│        RODA DE ACORDES       │  ┌ Extensões ───────────────────────┐ │
│      (círculo de quintas)    │  │ [7] [maj7] [6] [9] [11] [13]      │ │
│                              │  ├ Suspensões / Adições ────────────┤ │
│            C                 │  │ [sus2] [sus4] [add9] [add11]      │ │
│       F         G            │  ├ Alterações ──────────────────────┤ │
│    B♭      ●D       D        │  │ [♭5] [♯5] [♭9] [♯9] [♯11] [♭13]   │ │
│    ...    (tônica)   ...     │  ├ Baixo / Inversão ────────────────┤ │
│                              │  │ (●)Fund. ( )1ª ( )2ª ( )3ª [/...] │ │
│                              │  ├ Voicing ─────────────────────────┤ │
│                              │  │ [Fechado ▾]  Oitava: [−][4][+]    │ │
│                              │  └──────────────────────────────────┘ │
│                              │  Notas: E G B D (F♯)  🟢dia 🟡tensão    │
├──────────────────────────────┴───────────────────────────────────────┤
│  ARRANJO  [Intro ×1][ Verso A ×2 ][ Refrão ×2 ][ Verso A ×1 ][ + ]   │
│           |1       |5              |13             |21               │
├──────────────────────────────────────────────────────────────────────┤
│  PROGRESSÃO — bloco "Verso A"   (♩=90 · 4/4 · 🎹 Piano · herdados)   │
│  ☐ Iniciar com o acorde selecionado   (padrão: começa na tônica)     │
│  [ Dm7 │ i ] [ G7 │ IV ] [ Em7 │ ii ]● [ + ]         ⟲  ⟳  🗑  ⤓ Export │
│   ────4────   ────4────   ────4────                                  │
└──────────────────────────────────────────────────────────────────────┘
```

Em telas estreitas (celular) as três áreas empilham: seletor → roda → progressão → modificadores (em gaveta inferior).

### 3.2 Seletor de escala

- Dropdown com **busca** (por nome e aliases, sem acento) e agrupado por família (§2.3).
- Ao passar o mouse sobre uma escala: pré-visualização das notas e da fórmula (`1 2 ♭3 4 5 6 ♭7`) e botão ▶ para ouvir a escala.
- Atalho "modos relativos": dentro de uma família, trocar de modo mantendo o mesmo conjunto de notas.

### 3.3 Roda de acordes (círculo de quintas)

Estrutura em **3 anéis concêntricos**, 12 fatias em ordem de quintas (`posição = (pc * 7) % 12`):

| Anel | Conteúdo |
|---|---|
| Externo | Acordes maiores (C, G, D…) |
| Médio | Acordes menores (Am, Em, Bm… — relativos) |
| Interno | Diminutos / meio-diminutos (B°, F♯°…) |

Comportamento:

1. **Antes de escolher a tônica**: roda totalmente ativa, apenas para exploração; clicar numa fatia define a tônica.
2. **Depois da tônica**: a roda **gira** para colocar a tônica no topo (animação ~300 ms).
3. Cada fatia recebe um de quatro estados:
   - **Diatônico** (cor plena, clicável) — aparece com o algarismo romano do grau.
   - **Diatônico com outra qualidade** — a fundamental está na escala mas o anel não bate (ex.: em Dórico, o IV é maior; fatias sus/aug aparecem como um *badge* na fatia da fundamental).
   - **Cromático idiomático** (âmbar): dominante secundária (rótulo `V/V`, `V/vi`…) ou empréstimo do modo paralelo maior ↔ menor (`♭VII`, `♭VI`, `iv`…). Clicável nos modos Colorido e Livre.
   - **Fora da escala** (esmaecido, não clicável; clicável apenas no modo "Livre" — §3.6).
4. Para escalas cujos acordes não cabem nos 3 anéis (aug, sus, power chord), a fatia mostra um **badge** com as qualidades extras; clicar abre um mini-menu radial para escolher.
5. Hover sobre um acorde: destaca na roda as notas que ele compartilha com o **acorde anterior da progressão** (ajuda a visualizar condução de vozes) e toca o acorde (opcional, com toggle de som).
6. Abaixo da roda, uma dica diz quantos acordes estão liberados (ex.: "7 diatônicos + 11 cromáticos de 36") e dá atalho para o modo que libera mais.

Alternativa de visualização (toggle): **modo lista por graus** — `I ii iii IV V vi vii°` em linha, mais direto para iniciantes.

### 3.4 Progressão (linha do tempo)

**Primeiro acorde da progressão** — checkbox `☐ Iniciar com o acorde selecionado` (desmarcado por padrão):

| Checkbox | Comportamento |
|---|---|
| ☐ **Desmarcado (padrão)** | Ao definir a tônica, a progressão já começa com o **acorde da tônica** (grau I / i, com a qualidade primária do grau na escala). O usuário continua clicando para adicionar os próximos. |
| ☑ **Marcado** | A progressão começa vazia; o **primeiro acorde clicado na roda** (qualquer grau liberado, ex.: IV ou ii) vira o primeiro card. |

- A tônica continua definindo a escala e os graus nos dois casos. O checkbox só muda qual acorde abre a progressão.
- Com o checkbox desmarcado, o card inicial da tônica é um card normal: pode ser removido, trocado ou modificado.
- Mudar o checkbox com a progressão já preenchida não altera nada que já existe. A regra vale só para a próxima progressão ou quando a progressão é limpa.
- A preferência fica salva junto com o estado (`startWithSelected: boolean`, padrão `false`).

- Cada acorde é um card com: símbolo (`Em7♭5/B♭`), grau (`ii⌀`) e duração.
- Arrastar para reordenar; arrastar a borda para mudar duração (em tempos; grade 1/2/4/8).
- Selecionar um card abre-o no painel de Modificadores.
- Ações: duplicar, remover, desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z), loop.
- **Transpor**: trocar a tônica transpõe a progressão inteira mantendo os graus.
- **Trocar escala**: acordes que deixam de ser diatônicos ficam marcados com ⚠ (não são apagados).

### 3.5 Painel de Modificadores (segundo controle)

É o controle que dá "entonação mais complexa" a cada acorde. Atua sempre sobre **o acorde selecionado** na progressão.

| Grupo | Opções | Regra |
|---|---|---|
| **Extensões** | 6, 7, maj7, 9, 11, 13 | 9/11/13 implicam 7 por padrão (toggle "add" para não implicar) |
| **Suspensões / Adições** | sus2, sus4, add9, add11, add13, omit3, omit5 | sus substitui a 3ª |
| **Alterações** | ♭5, ♯5, ♭9, ♯9, ♯11, ♭13 | mutuamente exclusivas com a versão natural (ex.: ♭9 × 9) |
| **Baixo** | Fundamental, 1ª, 2ª, 3ª inversão, baixo livre (slash) | inversões limitadas ao nº de notas do acorde |
| **Voicing** | Fechado, Aberto, Drop 2, Drop 3, Quartal, Shell (1-3-7) | afeta só o áudio/visualização de teclado |
| **Oitava** | −2 … +2 | |

**Codificação por cor de cada botão** (calculada em tempo real contra a escala):

- 🟢 **Verde** — a nota adicionada pertence à escala (diatônica).
- 🟡 **Âmbar** — fora da escala, mas é tensão idiomática (ex.: ♭9 num V7 em menor, ♯11 num maj7).
- 🔴 **Vermelho/cinza** — fora da escala e sem uso idiomático; desabilitado no modo "Estrito".

Abaixo do painel: as notas resultantes do acorde, com as de fora da escala entre parênteses, e um mini-teclado de piano mostrando o voicing.

**Ações rápidas** ("presets de cor"):
- "Jazzificar" — aplica a extensão diatônica natural de cada grau (Imaj7, ii7, iii7, IVmaj7, V7, vi7, viiø).
- "Adicionar 9ª em tudo", "Suspender dominantes", "Limpar modificadores".

### 3.6 Modos de restrição

Toggle global de três posições:

| Modo | Roda | Modificadores |
|---|---|---|
| **Estrito** | só acordes diatônicos | só verdes |
| **Colorido** (padrão) | diatônicos + dominantes secundárias e empréstimos modais (◐ na progressão) | verdes + âmbar |
| **Livre** | tudo liberado, fora da escala marcado ⚠ | tudo liberado |

### 3.7 Análise e sugestões (v2)

- Algarismos romanos + função harmônica (T / SD / D) em cada card.
- Sugestão do "próximo acorde" (pontinhos na roda com probabilidade baseada em progressões comuns: ii–V–I, I–vi–IV–V, i–♭VI–♭III–♭VII…).
- ~~**Empréstimo modal** e **dominantes secundárias** (V/V, V/ii…) liberadas no modo Colorido~~ — antecipado para o MVP (§3.3, §3.6). Na v2: outros empréstimos (de modos além do paralelo), ii–V secundários e substituto de trítono.

### 3.8 Produção em blocos e tempo

A progressão da §3.4 deixa de ser única: ela passa a ser o **conteúdo de um bloco**, e a música é um **arranjo** de blocos.

**Conceitos**

- **Bloco (seção)**: trecho com nome e cor, com sua própria progressão (ex.: Intro, Verso, Pré-refrão, Refrão, Ponte, Solo, Final).
- **Arranjo**: sequência ordenada de **instâncias** de blocos. O mesmo bloco pode aparecer várias vezes. Editar o bloco altera todas as instâncias (como clipes vinculados). A ação "Tornar único" cria uma cópia independente.
- **Repetição**: cada instância tem `×N`. Casa 1 / casa 2 (último compasso diferente na repetição) fica para a v2.
- Um bloco novo segue a regra do checkbox `startWithSelected` da §3.4: começa com o acorde da tônica ou vazio.

**Tempo e métrica**

| Parâmetro | Escopo | Padrão | Notas |
|---|---|---|---|
| BPM | global, com override por bloco | 90 | 30–300; *tap tempo* |
| Fórmula de compasso | global, com override por bloco | 4/4 | 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, 12/8; nos compostos a pulsação é agrupada (6/8 = 2 pulsos) |
| Swing | global | 0% | 0–75%, aplicado às colcheias |
| Grade de edição | editor | 1 tempo | ½, 1, 2, 4 tempos, compasso inteiro |
| Contagem (*count-in*) | transporte | 1 compasso | |
| Metrônomo | transporte | desligado | acento no tempo 1 |

- As durações continuam em tempos (§2.4). A UI mostra uma régua em `compasso.tempo` (`3.2`).
- Um acorde pode atravessar a barra de compasso (antecipação/síncope). Nesse caso aparece uma ligadura visual.
- Um bloco que não fecha o último compasso recebe o aviso "compasso incompleto", com um botão que estende o último acorde até completar.
- Mudanças de BPM e de compasso entre blocos formam um **mapa de tempo** (`tempoMap`), usado pelo áudio e pelo export MIDI. Ritardando/accelerando (rampa no fim do bloco) ficam para a v2.

**Interação**

- A faixa **ARRANJO** fica acima da progressão. Cada bloco é um card com largura proporcional à duração e numeração de compassos embaixo. Arrastar reordena; Alt+arrastar cria uma instância vinculada.
- Clicar num bloco abre sua progressão no editor. O painel de Modificadores continua atuando sobre o acorde selecionado.
- Playback de três formas: o arranjo inteiro, só o bloco atual (em loop) ou uma região selecionada. O cursor de reprodução avança pelo arranjo, e o acorde que está tocando pulsa na roda.
- O **padrão de execução** (bloco, arpejo, comping; §5.1) é definido por bloco. Ex.: Intro em arpejo, Refrão em bloco.
- **Templates de forma**: "Pop (V–R–V–R–P–R)", "Blues de 12 compassos" (já preenchido com I7–IV7–V7), "AABA 32", "Verso/Refrão simples".
- **Modulação por bloco** (v2): escala e tônica herdam do global, mas cada bloco pode ter as suas. Os graus e a roda são recalculados no contexto do bloco selecionado.

**Modelo**

```ts
type Block = {
  id: string;
  name: string;               // "Refrão"
  color: string;
  chords: Chord[];            // a progressão (§3.4)
  bpm?: number;               // override
  meter?: [number, number];   // override, ex.: [6, 8]
  pattern?: PlaybackPattern;  // §5.1
  instrument?: InstrumentId;  // override (§3.9)
  key?: { tonic: number; scale: string }; // v2 — modulação
};

type ArrangementItem = { blockId: string; repeat: number };

type Song = {
  bpm: number;
  meter: [number, number];
  swing: number;
  instrument: InstrumentId;
  blocks: Record<string, Block>;
  arrangement: ArrangementItem[];
};
```

`expandArrangement(song) → { events: TimedChord[], tempoMap, markers }` é uma função pura (em `core/`) que desenrola as repetições em eventos com posição absoluta. O áudio, a régua e o export consomem esse resultado.

### 3.9 Seletor de instrumentos (preview)

O objetivo é **testar a ideia** com timbres diferentes. Não é mixagem nem produção final.

- Dropdown com busca no cabeçalho define o **instrumento global**. Cada bloco pode sobrescrever.
- No topo da lista, uma seção **"Sugeridos para esta escala"** traz os instrumentos clássicos da escala atual (§5.3), cada um com uma linha de contexto (ex.: "Hirajoshi — afinação tradicional do koto").
- Trocar de escala atualiza as sugestões, mas **não troca o instrumento sozinho**. Existe um toggle opcional "Seguir a escala".
- Um ▶ ao lado de cada item toca o acorde selecionado (ou a tônica) naquele instrumento, para comparação rápida.
- Instrumentos sampleados mostram progresso de carregamento. Enquanto carregam, o preview usa um synth equivalente como fallback.
- Instrumentos aproximados aparecem com `≈` e tooltip (ex.: "≈ Oud — não existe no banco GM; usando violão nylon").
- **Camadas** (v2): acordes e baixo com instrumentos separados (ex.: Piano + Contrabaixo; o baixo toca a fundamental ou o baixo invertido).

---

## 4. Modelo de modificadores

```ts
type Modifier =
  | { kind: "ext";   value: 6 | 7 | "maj7" | 9 | 11 | 13; add?: boolean }
  | { kind: "sus";   value: 2 | 4 }
  | { kind: "add";   value: 9 | 11 | 13 }
  | { kind: "alt";   value: "b5" | "#5" | "b9" | "#9" | "#11" | "b13" }
  | { kind: "omit";  value: 3 | 5 };

// Resolução:
// notasFinais = aplicar(modifiers, qualidadeBase.intervals)
// status(nota) = pitchSet.has(nota) ? "diatonic"
//              : isIdiomaticTension(chord, nota) ? "tension"
//              : "outside"
```

- A resolução é uma **função pura** (`resolveChord(chord, scaleCtx) → { pcs, symbol, statusPorNota }`), fácil de testar.
- O símbolo é gerado de forma canônica (`C7(♭9,♯11)`, `Dm9`, `G13sus4`, `F/A`).
- Conflitos são resolvidos na UI (desabilita a opção conflitante com tooltip explicando).

---

## 5. Áudio

### 5.1 Motor

- **Web Audio** via [Tone.js](https://tonejs.github.io/). O `Tone.Transport` recebe o `tempoMap` (§3.8) com BPM, compasso e swing.
- Reprodução do arranjo, de um bloco ou de uma região, com loop, contagem e metrônomo opcional.
- Padrões de execução (por bloco): bloco, arpejo ↑, arpejo ↓, "comping" simples.
- **Som**: synths com várias camadas (osciladores desafinados, envelope de filtro, chorus/delay estéreo); bus master com EQ → compressor → reverb → limiter.
- **Humanização**: acordes em bloco com dedilhado leve por família de instrumento (cordas > teclas > pads), baixo e voz superior acentuados, variação aleatória pequena de intensidade.
- **Voicing padrão**: baixo separado na 2ª oitava + estrutura superior fechada começando entre F3 e E4.
- Condução de vozes automática opcional: escolhe a inversão de cada acorde que minimiza o movimento em relação ao anterior.

### 5.2 Catálogo de instrumentos

Dois motores:

- **Sintetizados (Tone.js)**: sem download, disponíveis na hora. Também servem de fallback.
- **Sampleados** via [`smplr`](https://github.com/danigb/smplr) (MIT), no mesmo AudioContext do Tone.js e passando pelo bus master:
  - Piano: **SplendidGrandPiano** (Steinway, 4 camadas de velocity).
  - Pianos elétricos: **Wurlitzer EP200** e **Yamaha CP80** (Greg Sullivan E-Pianos).
  - VCSL (CC0): cravo flamengo, harpa de concerto, órgão de tubos, marimba, glockenspiel, kalimba, sax tenor, gaita cromática, đàn tranh (≈ guzheng); mallets VCSL (vibrafone, xilofone, sinos tubulares).
  - Contrabaixo **Smolken** (arco e pizzicato).
  - Demais timbres GM: banco **MusyngKite**.
  - Plano B automático: se o smplr falhar, o instrumento cai no FluidR3 via `Tone.Sampler`; enquanto carrega, toca um synth.
  - Samples cacheados com a Cache API (contexto seguro: https/localhost).

| Categoria | Instrumentos | Motor |
|---|---|---|
| **Synth** | Poly analógico, Pad, Pluck, Lead serra, FM Bell, Chord stab, FM Keys, Supersaw | Tone.js |
| **Teclas** | Piano de cauda (Steinway), Pianos elétricos (Wurlitzer, CP80), Órgão Hammond, Órgão de tubos, Cravo, Celesta | sample / GM |
| **Cordas dedilhadas** | Violão nylon, Violão aço, Guitarra limpa, Guitarra overdrive, Harpa, Banjo | GM |
| **Cordas friccionadas** | Ensemble de cordas, Violino, Violoncelo, Contrabaixo | GM |
| **Sopros** | Sax tenor, Clarinete, Flauta, Naipe de metais, Gaita (harmônica), Acordeão | GM |
| **Percussão melódica** | Vibrafone, Marimba, Glockenspiel, Kalimba, Steel drum, Sinos tubulares | GM |
| **Mundo** | Sitar, Koto, Shamisen, Shakuhachi, Gaita de foles, Shehnai, Dulcimer, Flauta de pã | GM |
| **Aproximações (≈)** | Oud, Qanun, Santur, Címbalo, Guzheng, Erhu, Ney, Gamelan | GM mais próximo ou síntese (ex.: Gamelan = FM metálico do Tone.js) |

```ts
type InstrumentDef = {
  id: string;
  name: string;
  category: InstrumentCategory;
  engine: "synth" | "sampler";
  source: { preset?: string; gmProgram?: number; url?: string };
  range: [number, number];       // tessitura em MIDI, ex.: violino [55, 103]
  polyphony: "poly" | "mono";
  envelope: "sustain" | "decay"; // decay = piano, koto, harpa…
  drone?: boolean;               // sitar, gaita de foles: bordão na tônica
  approximates?: string;         // "Oud" → marcado com ≈ na UI
};
```

Regras de execução:

- **Tessitura**: o voicing é transposto por oitava para caber no `range`. Notas que continuarem fora são omitidas, com aviso.
- **Monofônicos** (sopros, shakuhachi, gaita de foles…): o acorde é tocado como arpejo automático, e um tooltip explica.
- **Decay**: em acordes longos, opção de re-atacar a cada compasso para o som não morrer.
- **Bordão**: instrumentos com `drone` ganham um toggle de bordão contínuo na tônica (tanpura com o sitar, bordões da gaita de foles).

### 5.2b Saída MIDI (DAW / plugins)

- **Web MIDI** (Chrome/Edge/Firefox; o Safari não suporta): as mesmas notas do playback (voicing, dedilhado, padrões, swing) saem para uma porta MIDI — ex.: **IAC Driver** do macOS → Ableton → Massive, Sylenth1 ou qualquer VST/AU.
- Painel **🎛 MIDI** no transporte: ligar/desligar, porta, canal global, compensação de latência (±150 ms), silenciar o som do navegador, teste e passo a passo para o Ableton.
- Canal MIDI por bloco (override), para tocar seções em plugins diferentes.
- Notas agendadas pelo Transport (parar cancela o que ainda não saiu) + *panic* (note-off e All Notes Off em todos os canais) ao parar ou desligar.
- Geração de notas num módulo puro (`audio/render.ts`) compartilhado por áudio do navegador, MIDI e export — o `.mid` soa como o playback.

### 5.3 Instrumentos clássicos por escala

O mapeamento fica num arquivo de dados (`scaleInstruments.ts`), por id de escala ou por família. A entrada da escala tem prioridade sobre a da família. Sem nenhuma das duas, as sugestões são Piano + Poly synth.

| Escala / família | Sugeridos | Contexto |
|---|---|---|
| Jônio (Maior) | Piano, Violão aço, Cordas | pop, erudito |
| Dórico | Órgão Hammond, Guitarra limpa, Flauta | jazz modal, funk, folk celta |
| Frígio | Violão nylon, Guitarra overdrive | flamenco, metal |
| Lídio | Pad, Cordas, Celesta | trilha de cinema, clima de "sonho" |
| Mixolídio | Gaita de foles, Guitarra overdrive, Órgão Hammond | a gaita de foles escocesa soa próxima do Mixolídio; rock |
| Eólio (Menor natural) | Piano, Cordas, Violoncelo | balada, erudito |
| Lócrio | Guitarra overdrive | metal |
| Menor harmônica | Cravo, Violino, Cordas | barroco, erudito |
| Frígio dominante (Ahava Rabbah / Espanhola) | Violão nylon, Clarinete, ≈ Oud | flamenco, klezmer, Oriente Médio |
| Dupla harmônica / Oriental | ≈ Oud, ≈ Qanun, ≈ Ney, Shehnai | música árabe, turca, bizantina |
| Húngara menor / Cigana | Violino, ≈ Címbalo, Acordeão | música cigana e húngara |
| Persa | ≈ Santur, ≈ Ney | música persa |
| Menor melódica / Alterada / Lídio dominante | Piano elétrico, Sax tenor, Vibrafone | jazz |
| Bebop | Sax tenor, Piano, Vibrafone, Contrabaixo | bebop |
| Blues / Pentatônica menor | Gaita, Guitarra overdrive, Piano | blues, rock |
| Pentatônica maior | Violão aço, Banjo, Flauta de pã | folk, country, música andina |
| Chinesa | ≈ Guzheng, ≈ Erhu | música tradicional chinesa |
| Hirajoshi, Kumoi, In-sen, Iwato, Yo | Koto, Shamisen, Shakuhachi | música tradicional japonesa (Hirajoshi e Kumoi são afinações do koto) |
| Pelog, Slendro | ≈ Gamelan, Marimba, Glockenspiel | gamelão de Java e Bali (escala aproximada em 12-TET, §2.3) |
| Egípcia (suspensa) | ≈ Ney, Flauta | |
| Tons inteiros | Celesta, Harpa, Vibrafone | impressionismo (Debussy), sequências de sonho |
| Diminuta / Diminuta dominante | Cordas, Naipe de metais, Sax tenor | suspense, big band |
| Aumentada / Hexatônica de Coltrane | Sax tenor, Piano | Coltrane |
| Modos de Messiaen | Órgão de tubos, Piano | Messiaen era organista |
| Prometeu | Piano | Scriabin |
| Napolitanas, Enigmática | Piano, Cordas, Órgão de tubos | erudito (a Enigmática vem de Verdi) |
| Cromática | Piano, Poly synth | — |

O instrumento não corrige a afinação: escalas não temperadas continuam aproximadas em 12-TET (ver §11.3).

---

## 6. Persistência e exportação

- Estado salvo em `localStorage` (última sessão) + lista de músicas salvas. O estado é o `Song` inteiro (§3.8): blocos, arranjo, tempo, compasso e instrumentos.
- **Arquivo** (cabeçalho): nome da música editável com indicador de alterações (●), **＋ Novo** (confirma se há alterações: salvar e continuar / descartar / cancelar), **💾 Salvar** (Ctrl/Cmd+S) e **Abrir ▾** (lista por data, excluir com confirmação, salvar como cópia). A música salva guarda escala, tônica e arranjo; preferências de UI (modo, grafia, som) ficam só na sessão.
- Samples baixados ficam na Cache API, fora do estado.
- **Compartilhar via URL**: estado serializado e comprimido no hash (`#s=...`).
- Exportar:
  - Texto / cifra, por seção:
    ```
    [Verso A ×2]  4/4 ♩=90
    | Dm7 | G7 | Cmaj7 | % |
    [Refrão ×2]
    | Fmaj7 | G7 | Em7 | Am7 |
    ```
  - MIDI (`.mid`) — via `@tonejs/midi`, com mapa de tempo, fórmulas de compasso, marcadores com o nome de cada bloco, trilhas separadas de **Acordes** e **Baixo** (por canal) e *program change* GM do instrumento. Exportado quantizado (sem dedilhado/variação), pronto para editar no DAW. *(antecipado da v2)*
  - JSON (reimportável)

---

## 7. Arquitetura técnica

**Stack proposta:** Vite + React + TypeScript, Zustand (estado), Tone.js (áudio), SVG puro para a roda, Vitest para testes.

```
src/
  core/                 # teoria musical — TS puro, sem React
    pitch.ts            # pitch classes, intervalos, grafia enarmônica
    scales.ts           # catálogo de escalas (dados)
    chords.ts           # dicionário de qualidades de acordes
    diatonic.ts         # algoritmo §2.5 (acordes da escala + graus)
    modifiers.ts        # resolveChord, conflitos, status das notas
    analysis.ts         # algarismos romanos, função harmônica (v2)
    timeline.ts         # tempos ↔ compassos, fórmulas de compasso, tempoMap
    song.ts             # blocos, arranjo, expandArrangement (§3.8)
  audio/
    engine.ts           # wrapper Tone.js, transporte, playback, voicings
    instruments.ts      # catálogo InstrumentDef (dados)
    scaleInstruments.ts # escala/família → instrumentos sugeridos (dados)
    loaders.ts          # synth presets, sampler/soundfont, cache
  state/
    store.ts            # Zustand: escala, tônica, song (blocos/arranjo/tempo), seleção, modo
  ui/
    ScalePicker/
    ChordWheel/         # SVG: anéis, fatias, rotação, badges
    Transport/          # play/stop, BPM, compasso, swing, metrônomo
    Arrangement/        # faixa de blocos
    Progression/        # progressão do bloco selecionado
    ModifierPanel/
    InstrumentPicker/   # busca, sugeridos da escala, preview
    MiniKeyboard/
  export/
    text.ts  midi.ts  url.ts
```

Princípios:
- `core/` é 100% determinístico e testado (é onde mora o risco — teoria errada = produto errado).
- A UI só consome `core/` via seletores; nenhum cálculo musical em componentes.
- Catálogos (escalas, acordes) são dados, não código.

---

## 8. Acessibilidade

- Roda navegável por teclado (setas giram entre fatias, Enter adiciona à progressão).
- Cores nunca são a única informação: estados também têm ícone/padrão (✓, ◐, ⚠).
- `aria-label` em cada fatia ("Mi menor, grau ii, diatônico").
- Contraste AA em tema claro e escuro.

---

## 9. Roadmap

| Fase | Entregas |
|---|---|
| **MVP** | Catálogo de ~30 escalas (modos maiores, menor harmônica/melódica, pentatônicas, blues); roda com 3 anéis; seleção de tônica e bloqueio de não-diatônicos; progressão com adicionar/remover/reordenar (um bloco só); modificadores de extensão e sus; playback com BPM, 4/4 e metrônomo; instrumentos: 3 presets de synth + piano Salamander |
| **v1** | Catálogo completo (~70); badges para qualidades extras; alterações e inversões; cores diatônico/tensão/fora; modos Estrito/Colorido/Livre; grafia enarmônica correta; **blocos e arranjo** com repetições e blocos vinculados; fórmulas de compasso e swing; templates de forma; **catálogo de instrumentos GM + sugeridos por escala**; salvar/URL/export texto por seção |
| **v2** | Análise funcional; sugestão de próximo acorde; empréstimo modal e dominantes secundárias; voicings e condução de vozes; overrides por bloco (BPM, compasso, instrumento, modulação); ritardando/accelerando; casa 1/casa 2; camadas acordes + baixo; bordão; export MIDI com tempo, marcadores e program change |
| **v3** | Visualização de braço de violão/guitarra; modo prática (ouvir e adivinhar o grau); PWA offline |

---

## 10. Testes

- **Unitários (core)**: para cada escala do catálogo, validar número de notas e intervalos; para escalas conhecidas, comparar acordes diatônicos com tabela de referência (ex.: Dó maior → C Dm Em F G Am B°; Lá menor harmônica → Am B° C+ Dm E F G♯°).
- **Grafia**: toda escala heptatônica gera 7 letras distintas em todas as 12 tônicas.
- **Modificadores**: símbolos canônicos e conflitos (`♭9` + `9` impossível, `sus4` remove a 3ª).
- **Tempo/arranjo**: conversão tempos ↔ `compasso.tempo` com fórmulas mistas (4/4 → 7/8 → 6/8); `expandArrangement` desenrola repetições e blocos vinculados nas posições certas; `tempoMap` consistente com os overrides por bloco.
- **Instrumentos**: todo id em `scaleInstruments` existe no catálogo; toda escala do catálogo resolve pelo menos 1 sugestão (direta, pela família ou pelo fallback); ajuste de tessitura mantém todas as notas dentro do `range`; instrumentos monofônicos nunca recebem notas simultâneas.
- **Componentes**: roda desabilita as fatias corretas após escolher tônica; clique adiciona o acorde certo.

---

## 11. Questões em aberto

1. Público-alvo principal: iniciante (lista por graus em destaque) ou músico intermediário/avançado (roda + tensões em destaque)?
2. Instrumento de referência para voicings: piano, violão/guitarra ou ambos?
3. Precisa de afinação/escala não temperada real (microtons) ou a aproximação 12-TET basta? (Com os instrumentos típicos — gamelão, oud, koto — a falta de microtons fica mais audível.)
4. Banco de samples: MusyngKite (melhor som, mais pesado) ou FluidR3 (mais leve)? Precisa funcionar offline já na v1 ou só com a PWA (v3)? Verificar as licenças para redistribuição.
5. Para os instrumentos marcados com ≈ (oud, qanun, guzheng, gamelão…): basta a aproximação GM, ou vale buscar samples dedicados com licença livre?
6. A modulação por bloco (tônica/escala própria) é prioridade, ou um arranjo sempre fica numa tonalidade só?
