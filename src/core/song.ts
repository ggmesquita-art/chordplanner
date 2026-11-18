// Blocos e arranjo (DESIGN §3.8). `expandArrangement` desenrola repetições em
// eventos com posição absoluta — consumido pelo áudio, pela régua e pelo export.

import type { Chord } from "./chords";
import { missingBeats, rampBpmAt, rampSeconds, secondsPerBeat, type Meter } from "./timeline";

export type PlaybackPattern = "block" | "arp-up" | "arp-down" | "comping";

export type InstrumentId = string;

export type Block = {
  id: string;
  name: string;
  color: string;
  chords: Chord[];
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
  bassInstrument?: InstrumentId;
  drone?: boolean;
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
  markers: Marker[];
  tempoMap: TempoPoint[];
  totalSec: number;
  totalBars: number;
};

export const BLOCK_COLORS = ["#6c8cff", "#ff8a5b", "#4fd1a5", "#e36bd6", "#f5c542", "#58c4e6", "#a98bff", "#ff6b81"];

export const blockBeats = (b: Block) => b.chords.reduce((sum, c) => sum + c.duration, 0);
export const blockMeter = (song: Song, b: Block): Meter => b.meter ?? song.meter;
export const blockBpm = (song: Song, b: Block) => b.bpm ?? song.bpm;

export function blockIsIncomplete(song: Song, b: Block): number {
  return missingBeats(blockBeats(b), blockMeter(song, b));
}

type Acc = { events: TimedChord[]; markers: Marker[]; tempoMap: TempoPoint[]; sec: number; beatAbs: number; bars: number };

const newAcc = (): Acc => ({ events: [], markers: [], tempoMap: [], sec: 0, beatAbs: 0, bars: 0 });

const finish = (a: Acc): Expanded => ({ events: a.events, markers: a.markers, tempoMap: a.tempoMap, totalSec: a.sec, totalBars: a.bars });

/** Acrescenta ao acumulador `repeat` passadas dos acordes `from..to` (índices reais) do bloco do item. */
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
  // Segundos entre duas posições da passada (rampa linear de BPM; sem `rampTo`, andamento constante).
  const secs = (b0: number, b1: number) => (target === undefined ? (b1 - b0) * secondsPerBeat(bpm) : rampSeconds(total, bpm, target, b0, b1));

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

  for (let rep = 0; rep < repeat; rep++) {
    let beatsDone = 0;
    let pos = 0;
    // Rampa: um ponto de tempo por tempo, com o BPM médio dele (o export MIDI reproduz a rampa por degraus).
    if (target !== undefined && regionStart < regionEnd) {
      for (let b = regionStart; b < regionEnd - 1e-9; b += 1) {
        const end = Math.min(b + 1, regionEnd);
        a.tempoMap.push({ startSec: a.sec + secs(regionStart, b), bpm: (60 * (end - b)) / secs(b, end), meter, startBeat: a.beatAbs + (b - regionStart), ramp: true });
      }
    }
    block.chords.forEach((chord, chordIndex) => {
      const blockBeat = pos;
      pos += chord.duration;
      if (chordIndex < from || chordIndex > to) return;
      const durationSec = secs(blockBeat, blockBeat + chord.duration);
      a.events.push({
        chord,
        blockId: block.id,
        itemIndex,
        repetition: rep,
        chordIndex,
        startBeat: a.beatAbs,
        blockBeat,
        beats: chord.duration,
        startSec: a.sec,
        durationSec,
        bpm: target === undefined ? bpm : rampBpmAt(total, bpm, target, blockBeat),
        endBpm: target === undefined ? bpm : rampBpmAt(total, bpm, target, blockBeat + chord.duration),
        meter,
        pattern: block.pattern ?? song.pattern,
        instrument: block.instrument ?? song.instrument,
        ...(block.bassInstrument ? { bassInstrument: block.bassInstrument } : {}),
        ...(block.drone ? { drone: true } : {}),
      });
      a.beatAbs += chord.duration;
      a.sec += durationSec;
      beatsDone += chord.duration;
    });
    a.bars += (from === 0 && to === Infinity ? total : beatsDone) / meter[0];
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
