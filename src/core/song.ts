// Blocos e arranjo (DESIGN §3.8). `expandArrangement` desenrola repetições em
// eventos com posição absoluta — consumido pelo áudio, pela régua e pelo export.

import { makeRest, type Chord } from "./chords";
import { DEFAULT_MELODY_INSTRUMENT, melodyEndBeat, sliceMelodyForPass, type MelodyNote } from "./melody";
import { missingBeats, rampBpmAt, rampSeconds, secondsPerBeat, type Meter } from "./timeline";

export type PlaybackPattern = "block" | "arp-up" | "arp-down" | "comping";

export type InstrumentId = string;

export type Block = {
  id: string;
  name: string;
  color: string;
  chords: Chord[];
  /** Melodia monofônica opcional do bloco (§Etapa 6 / v4). */
  melody?: MelodyNote[];
  /** Melodia da casa 2 (§Etapa 6 / v4): substitui o último compasso da melodia na última repetição com ×2+. */
  melodyEnding?: MelodyNote[];
  /** Timbre próprio da melodia neste bloco (override do global). */
  melodyInstrument?: InstrumentId;
  /** Canal MIDI 1–16 da melodia neste bloco (override do global). */
  melodyMidiChannel?: number;
  bpm?: number;
  meter?: Meter;
  pattern?: PlaybackPattern;
  instrument?: InstrumentId;
  /** Canal MIDI 1–16 deste bloco (override do global). */
  midiChannel?: number;
  /** Camada de baixo com instrumento próprio (§3.9): toca a fundamental ou o baixo invertido. */
  bassInstrument?: InstrumentId;
  /** Bordão contínuo na tônica durante o bloco (§5.2; instrumentos com `drone`). */
  drone?: boolean;
  /** BPM ao fim do bloco: rampa a partir do BPM do bloco (menor = ritardando, maior = accelerando) (§3.8). */
  rampTo?: number;
  /** Modulação (§3.8): tônica e escala próprias do bloco; sem isto, herda as globais. */
  key?: { tonic: number; scaleId: string };
  /**
   * Casa 2 (§3.8): acordes que substituem o ÚLTIMO compasso na última repetição de cada instância
   * com ×2 ou mais. As passadas anteriores tocam o bloco inteiro (casa 1 = último compasso original).
   */
  ending?: Chord[];
};

export type ArrangementItem = { id: string; blockId: string; repeat: number };

export type Song = {
  bpm: number;
  meter: Meter;
  swing: number;
  instrument: InstrumentId;
  /** Timbre global da pista de melodia (padrão: `epiano`). */
  melodyInstrument?: InstrumentId;
  pattern: PlaybackPattern;
  /** Escolhe a inversão de cada acorde com menor movimento em relação ao anterior (§5.1). */
  voiceLeading?: boolean;
  /** Re-ataca a cada compasso acordes longos em instrumentos de decay (§5.2). */
  reattack?: boolean;
  blocks: Record<string, Block>;
  arrangement: ArrangementItem[];
};

export type TimedChord = {
  chord: Chord;
  blockId: string;
  itemIndex: number;
  repetition: number;
  chordIndex: number;
  startBeat: number;
  /** Posição (em tempos) do início do acorde dentro da passada do bloco — inclusive numa região que começa no meio. */
  blockBeat: number;
  beats: number;
  startSec: number;
  durationSec: number;
  bpm: number;
  meter: Meter;
  pattern: PlaybackPattern;
  instrument: InstrumentId;
  /** BPM ao fim do acorde; só difere de `bpm` dentro de uma rampa (`rampTo`). */
  endBpm?: number;
  /** Rampa de andamento da passada (`beats` = tempos até o fim dela): o BPM varia linearmente de `from` a `to`. */
  ramp?: { beats: number; from: number; to: number };
  bassInstrument?: InstrumentId;
  drone?: boolean;
  /** Evento da casa 2: `chordIndex` indexa `block.ending`, não `block.chords`. */
  inEnding?: boolean;
  /** Em passadas com `melodyEnding`, tempo no bloco a partir do qual toca a melodia da casa 2. */
  melodyEndingFrom?: number;
  /** Evento silencioso sintético que preenche o trecho onde a melodia ultrapassa os acordes do bloco. */
  isPadding?: boolean;
};

export type TimedMelodyNote = {
  note: MelodyNote;
  blockId: string;
  itemIndex: number;
  repetition: number;
  startBeat: number;
  blockBeat: number;
  beats: number;
  startSec: number;
  durationSec: number;
  bpm: number;
  meter: Meter;
  instrument: InstrumentId;
  inEnding?: boolean;
};

export type Marker = {
  itemIndex: number;
  blockId: string;
  name: string;
  startSec: number;
  startBar: number;
  bpm: number;
  meter: Meter;
};

/**
 * Mudança de andamento/compasso. Numa rampa (`rampTo`) há um ponto por tempo, com o BPM médio daquele
 * tempo (`ramp: true`); `startBeat` é o tempo absoluto, para o export MIDI achar o tick mesmo no meio de um acorde.
 */
export type TempoPoint = { startSec: number; bpm: number; meter: Meter; startBeat?: number; ramp?: boolean };

export type Expanded = {
  events: TimedChord[];
  melodyEvents: TimedMelodyNote[];
  markers: Marker[];
  tempoMap: TempoPoint[];
  totalSec: number;
  totalBars: number;
};

export const BLOCK_COLORS = ["#6c8cff", "#ff8a5b", "#4fd1a5", "#e36bd6", "#f5c542", "#58c4e6", "#a98bff", "#ff6b81"];

export const blockChordBeats = (b: Block) => b.chords.reduce((sum, c) => sum + c.duration, 0);
export const blockBeats = (b: Block) => Math.max(blockChordBeats(b), melodyEndBeat(b.melody));
export const blockMeter = (song: Song, b: Block): Meter => b.meter ?? song.meter;
export const blockBpm = (song: Song, b: Block) => b.bpm ?? song.bpm;

export function blockIsIncomplete(song: Song, b: Block): number {
  return missingBeats(blockBeats(b), blockMeter(song, b));
}

/**
 * Posição (em tempos, dentro da passada) onde começa o "último compasso" do bloco, o trecho que a casa 2
 * substitui: o início do último compasso da grade, ou seja floor((total − ε) / tempos-por-compasso) · tempos-por-compasso.
 * Em bloco incompleto é o trecho final a partir da última barra (ex.: 18 tempos em 4/4 → 16..18).
 * Acordes e notas que atravessam esse ponto são cortados nele.
 */
export function endingCut(block: Block, meter: Meter): number {
  return Math.max(0, Math.floor((blockBeats(block) - 1e-9) / meter[0]) * meter[0]);
}

type Acc = {
  events: TimedChord[];
  melodyEvents: TimedMelodyNote[];
  markers: Marker[];
  tempoMap: TempoPoint[];
  sec: number;
  beatAbs: number;
  bars: number;
};

const newAcc = (): Acc => ({ events: [], melodyEvents: [], markers: [], tempoMap: [], sec: 0, beatAbs: 0, bars: 0 });

const finish = (a: Acc): Expanded => ({
  events: a.events,
  melodyEvents: a.melodyEvents,
  markers: a.markers,
  tempoMap: a.tempoMap,
  totalSec: a.sec,
  totalBars: a.bars,
});

/** Acrescenta ao acumulador `repeat` passadas do bloco do item (acordes `from..to` + melodia da faixa). */
function appendBlock(a: Acc, song: Song, itemIndex: number, repeat: number, from = 0, to = Infinity) {
  const block = song.blocks[song.arrangement[itemIndex]?.blockId];
  if (!block) return;
  const bpm = blockBpm(song, block);
  const meter = blockMeter(song, block);
  const total = blockBeats(block);
  const target = block.rampTo !== undefined && block.rampTo !== bpm && total > 0 ? block.rampTo : undefined;
  const last = a.tempoMap[a.tempoMap.length - 1];
  if (target === undefined && (!last || last.ramp || last.bpm !== bpm || last.meter.join("/") !== meter.join("/"))) {
    a.tempoMap.push({ startSec: a.sec, bpm, meter, startBeat: a.beatAbs });
  }
  a.markers.push({ itemIndex, blockId: block.id, name: block.name, startSec: a.sec, startBar: a.bars, bpm, meter });

  const isRegion = from > 0 || to < Infinity;
  // Região da passada que será emitida (acordes from..to).
  let regionStart = Infinity;
  let regionEnd = 0;
  let p = 0;
  block.chords.forEach((c, i) => {
    if (i >= from && i <= to) {
      regionStart = Math.min(regionStart, p);
      regionEnd = p + c.duration;
    }
    p += c.duration;
  });
  const baseBeat = isRegion ? regionStart : 0;

  // Casa 2: só na instância inteira (não em região) com ×2 ou mais.
  const canEnding = !isRegion && repeat >= 2;
  const chordEnding = canEnding && block.ending?.length ? block.ending : undefined;
  const hasMelodyEnding = canEnding && block.melodyEnding !== undefined;
  const cut = endingCut(block, meter);
  const melodyInst = block.melodyInstrument ?? song.melodyInstrument ?? DEFAULT_MELODY_INSTRUMENT;

  type Piece = { chord: Chord; chordIndex: number; blockBeat: number; beats: number; inEnding: boolean; isPadding?: boolean };
  for (let rep = 0; rep < repeat; rep++) {
    const withEnding = (!!chordEnding || hasMelodyEnding) && rep === repeat - 1;
    // Peças da passada: os acordes do bloco; na última passada com casa 2, o último compasso é trocado.
    const pieces: Piece[] = [];
    let pos = 0;
    block.chords.forEach((chord, chordIndex) => {
      const blockBeat = pos;
      pos += chord.duration;
      if (chordIndex < from || chordIndex > to) return;
      if (withEnding && chordEnding && blockBeat >= cut - 1e-9) return;
      const beats = withEnding && chordEnding ? Math.min(chord.duration, cut - blockBeat) : chord.duration;
      pieces.push({ chord, chordIndex, blockBeat, beats, inEnding: false });
    });
    let chordsEnd = isRegion ? regionEnd : blockChordBeats(block);
    if (withEnding && chordEnding) {
      let q = cut;
      chordEnding.forEach((chord, chordIndex) => {
        pieces.push({ chord, chordIndex, blockBeat: q, beats: chord.duration, inEnding: true });
        q += chord.duration;
      });
      chordsEnd = q;
    }

    type MelItem = { note: MelodyNote; inEnding: boolean };
    let passMelody: MelItem[] = [];
    if (isRegion) {
      if (regionStart < regionEnd) {
        passMelody = sliceMelodyForPass(block.melody ?? [], regionStart, regionEnd).map((note) => ({ note, inEnding: false }));
      }
    } else if (withEnding && hasMelodyEnding) {
      const mainPart = sliceMelodyForPass(block.melody ?? [], 0, cut).map((note) => ({ note, inEnding: false }));
      const endPart = (block.melodyEnding ?? []).map((n) => ({
        note: { ...n, start: n.start + cut },
        inEnding: true,
      }));
      passMelody = [...mainPart, ...endPart];
    } else if (withEnding && chordEnding) {
      passMelody = sliceMelodyForPass(block.melody ?? [], 0, chordsEnd).map((note) => ({ note, inEnding: false }));
    } else {
      passMelody = (block.melody ?? []).map((note) => ({ note, inEnding: false }));
    }

    const melEnd = melodyEndBeat(passMelody.map((m) => m.note));
    const passEnd = isRegion ? regionEnd : Math.max(chordsEnd, melEnd);

    if (!isRegion && passEnd > chordsEnd + 1e-9) {
      pieces.push({
        chord: { ...makeRest(passEnd - chordsEnd), id: "__pad" },
        chordIndex: -1,
        blockBeat: chordsEnd,
        beats: passEnd - chordsEnd,
        inEnding: false,
        isPadding: true,
      });
    }

    // A rampa vai até o fim da passada: na última passada com casa 2 isso pode diferir de `total`.
    const passTotal = withEnding ? passEnd : total;
    // Segundos entre duas posições da passada (rampa linear de BPM; sem `rampTo`, andamento constante).
    const secs = (b0: number, b1: number) => (target === undefined ? (b1 - b0) * secondsPerBeat(bpm) : rampSeconds(passTotal, bpm, target, b0, b1));
    let beatsDone = 0;
    // Rampa: um ponto de tempo por tempo, com o BPM médio dele (o export MIDI reproduz a rampa por degraus).
    if (target !== undefined && baseBeat < passEnd - 1e-9) {
      for (let b = baseBeat; b < passEnd - 1e-9; b += 1) {
        const end = Math.min(b + 1, passEnd);
        a.tempoMap.push({ startSec: a.sec + secs(baseBeat, b), bpm: (60 * (end - b)) / secs(b, end), meter, startBeat: a.beatAbs + (b - baseBeat), ramp: true });
      }
    }

    const passStartBeat = a.beatAbs;
    const passStartSec = a.sec;

    for (const { chord, chordIndex, blockBeat, beats, inEnding, isPadding } of pieces) {
      const durationSec = secs(blockBeat, blockBeat + beats);
      a.events.push({
        chord,
        blockId: block.id,
        itemIndex,
        repetition: rep,
        chordIndex,
        startBeat: a.beatAbs,
        blockBeat,
        beats,
        startSec: a.sec,
        durationSec,
        bpm: target === undefined ? bpm : rampBpmAt(passTotal, bpm, target, blockBeat),
        endBpm: target === undefined ? bpm : rampBpmAt(passTotal, bpm, target, blockBeat + beats),
        meter,
        ...(target === undefined ? {} : { ramp: { beats: passTotal, from: bpm, to: target } }),
        pattern: block.pattern ?? song.pattern,
        instrument: block.instrument ?? song.instrument,
        ...(inEnding ? { inEnding: true } : {}),
        ...(withEnding && hasMelodyEnding ? { melodyEndingFrom: cut } : {}),
        ...(isPadding ? { isPadding: true } : {}),
        ...(block.bassInstrument ? { bassInstrument: block.bassInstrument } : {}),
        ...(block.drone ? { drone: true } : {}),
      });
      a.beatAbs += beats;
      a.sec += durationSec;
      beatsDone += beats;
    }

    for (const { note, inEnding } of passMelody) {
      const nStart = passStartSec + secs(baseBeat, note.start);
      const nDur = secs(note.start, note.start + note.duration);
      a.melodyEvents.push({
        note,
        blockId: block.id,
        itemIndex,
        repetition: rep,
        startBeat: passStartBeat + (note.start - baseBeat),
        blockBeat: note.start,
        beats: note.duration,
        startSec: nStart,
        durationSec: nDur,
        bpm: target === undefined ? bpm : rampBpmAt(passTotal, bpm, target, note.start),
        meter,
        instrument: melodyInst,
        ...(inEnding ? { inEnding: true } : {}),
      });
    }

    a.bars += beatsDone / meter[0];
  }
}

/** Desenrola o arranjo (ou só os itens indicados) em eventos absolutos. */
export function expandArrangement(song: Song, onlyItems?: number[]): Expanded {
  const acc = newAcc();
  song.arrangement.forEach((item, itemIndex) => {
    if (onlyItems && !onlyItems.includes(itemIndex)) return;
    appendBlock(acc, song, itemIndex, item.repeat);
  });
  return finish(acc);
}

/** Uma passada (sem `repeat`) dos acordes `from..to` (inclusive) do bloco do item; os índices dos eventos são os reais. */
export function expandRegion(song: Song, itemIndex: number, from: number, to: number): Expanded {
  const acc = newAcc();
  const n = song.blocks[song.arrangement[itemIndex]?.blockId]?.chords.length ?? 0;
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(n - 1, Math.max(from, to));
  if (n > 0 && lo <= hi) appendBlock(acc, song, itemIndex, 1, lo, hi);
  return finish(acc);
}

export type PlaybackBeatPosition = {
  itemIndex: number;
  blockId: string;
  blockBeat: number;
  inEnding: boolean;
  melodyInEnding: boolean;
};

/** Mapeia um instante (em segundos, já descontado o count-in) para a posição em tempos no bloco. */
export function playbackBeatAtSec(expanded: Expanded, elapsedSec: number): PlaybackBeatPosition | null {
  if (!expanded.events.length || !Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
  let ev: TimedChord | undefined;
  for (const candidate of expanded.events) {
    if (elapsedSec >= candidate.startSec - 1e-9 && elapsedSec < candidate.startSec + candidate.durationSec) {
      ev = candidate;
      break;
    }
  }
  if (!ev && elapsedSec <= expanded.totalSec + 1e-6 && elapsedSec >= expanded.totalSec - 1e-9) {
    ev = expanded.events[expanded.events.length - 1];
  }
  if (!ev) return null;
  const frac = ev.durationSec > 0 ? Math.max(0, Math.min(1, (elapsedSec - ev.startSec) / ev.durationSec)) : 0;
  const blockBeat = ev.blockBeat + frac * ev.beats;
  const inEnding = !!ev.inEnding;
  const melodyInEnding = inEnding || (ev.melodyEndingFrom !== undefined && blockBeat >= ev.melodyEndingFrom - 1e-9);
  return {
    itemIndex: ev.itemIndex,
    blockId: ev.blockId,
    blockBeat,
    inEnding,
    melodyInEnding,
  };
}

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function makeBlock(name: string, colorIndex: number, chords: Chord[] = []): Block {
  return { id: newId("b"), name, color: BLOCK_COLORS[colorIndex % BLOCK_COLORS.length], chords };
}

export function makeSong(): Song {
  const block = makeBlock("Verso A", 0);
  return {
    bpm: 90,
    meter: [4, 4],
    swing: 0,
    instrument: "piano",
    pattern: "block",
    blocks: { [block.id]: block },
    arrangement: [{ id: newId("i"), blockId: block.id, repeat: 1 }],
  };
}
