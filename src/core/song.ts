// Blocos e arranjo (DESIGN §3.8). `expandArrangement` desenrola repetições em
// eventos com posição absoluta — consumido pelo áudio, pela régua e pelo export.

import type { Chord } from "./chords";
import { missingBeats, secondsPerBeat, type Meter } from "./timeline";

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
};

export type ArrangementItem = { id: string; blockId: string; repeat: number };

export type Song = {
  bpm: number;
  meter: Meter;
  swing: number;
  instrument: InstrumentId;
  pattern: PlaybackPattern;
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
  beats: number;
  startSec: number;
  durationSec: number;
  bpm: number;
  meter: Meter;
  pattern: PlaybackPattern;
  instrument: InstrumentId;
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

export type TempoPoint = { startSec: number; bpm: number; meter: Meter };

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

/** Desenrola o arranjo (ou só os itens indicados) em eventos absolutos. */
export function expandArrangement(song: Song, onlyItems?: number[]): Expanded {
  const events: TimedChord[] = [];
  const markers: Marker[] = [];
  const tempoMap: TempoPoint[] = [];
  let sec = 0;
  let beatAbs = 0;
  let bars = 0;

  song.arrangement.forEach((item, itemIndex) => {
    if (onlyItems && !onlyItems.includes(itemIndex)) return;
    const block = song.blocks[item.blockId];
    if (!block) return;
    const bpm = blockBpm(song, block);
    const meter = blockMeter(song, block);
    const spb = secondsPerBeat(bpm);
    const last = tempoMap[tempoMap.length - 1];
    if (!last || last.bpm !== bpm || last.meter.join("/") !== meter.join("/")) {
      tempoMap.push({ startSec: sec, bpm, meter });
    }
    markers.push({ itemIndex, blockId: block.id, name: block.name, startSec: sec, startBar: bars, bpm, meter });

    for (let rep = 0; rep < item.repeat; rep++) {
      block.chords.forEach((chord, chordIndex) => {
        events.push({
          chord,
          blockId: block.id,
          itemIndex,
          repetition: rep,
          chordIndex,
          startBeat: beatAbs,
          beats: chord.duration,
          startSec: sec,
          durationSec: chord.duration * spb,
          bpm,
          meter,
          pattern: block.pattern ?? song.pattern,
          instrument: block.instrument ?? song.instrument,
        });
        beatAbs += chord.duration;
        sec += chord.duration * spb;
      });
      bars += blockBeats(block) / meter[0];
    }
  });

  return { events, markers, tempoMap, totalSec: sec, totalBars: bars };
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
