import { describe, expect, it } from "vitest";
import { makeChord } from "./chords";
import { expandArrangement, expandRegion, makeSong } from "./song";

function build() {
  const song = makeSong();
  song.bpm = 120;
  song.arrangement[0].repeat = 3;
  const block = song.blocks[song.arrangement[0].blockId];
  block.chords = [makeChord(0, "maj", 4), makeChord(5, "maj", 2), makeChord(7, "maj", 4), makeChord(9, "m", 4)];
  return { song, block };
}

describe("expandRegion", () => {
  it("recorta os acordes do meio mantendo chordIndex reais", () => {
    const { song } = build();
    const r = expandRegion(song, 0, 1, 2);
    expect(r.events.map((e) => e.chordIndex)).toEqual([1, 2]);
    expect(r.events[0].startSec).toBe(0);
    expect(r.events[1].startSec).toBeCloseTo(1);
    expect(r.totalSec).toBeCloseTo(r.events.reduce((a, e) => a + e.durationSec, 0));
    expect(r.totalSec).toBeCloseTo(3);
    expect(r.events.every((e) => e.itemIndex === 0 && e.repetition === 0)).toBe(true);
    expect(r.markers.length).toBe(1);
    expect(r.tempoMap.length).toBe(1);
  });

  it("ignora repeat", () => {
    const { song } = build();
    expect(expandRegion(song, 0, 0, 3).events.length).toBe(4);
    expect(expandArrangement(song).events.length).toBe(12);
  });

  it("respeita bpm e compasso do bloco", () => {
    const { song, block } = build();
    block.bpm = 60;
    block.meter = [6, 8];
    const r = expandRegion(song, 0, 1, 1);
    expect(r.events[0].bpm).toBe(60);
    expect(r.events[0].meter).toEqual([6, 8]);
    expect(r.totalSec).toBeCloseTo(2);
    expect(r.tempoMap[0]).toMatchObject({ bpm: 60, meter: [6, 8] });
  });

  it("limita índices fora da faixa", () => {
    const { song } = build();
    expect(expandRegion(song, 0, -3, 1).events.map((e) => e.chordIndex)).toEqual([0, 1]);
    expect(expandRegion(song, 0, 2, 99).events.map((e) => e.chordIndex)).toEqual([2, 3]);
  });

  it("item inexistente: sem eventos", () => {
    const { song } = build();
    expect(expandRegion(song, 5, 0, 1)).toEqual(expandArrangement({ ...song, arrangement: [] }));
  });
});
