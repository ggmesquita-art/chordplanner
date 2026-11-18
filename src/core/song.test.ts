import { describe, expect, it } from "vitest";
import { makeChord } from "./chords";
import { expandArrangement, expandRegion, makeBlock, makeSong } from "./song";
import { rampSeconds } from "./timeline";

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

describe("rampTo (ritardando/accelerando)", () => {
  const ramped = (chords: number[], from: number, to: number, repeat = 1) => {
    const song = makeSong();
    song.bpm = from;
    const block = song.blocks[song.arrangement[0].blockId];
    block.chords = chords.map((d) => makeChord(0, "maj", d));
    block.rampTo = to;
    song.arrangement[0].repeat = repeat;
    return song;
  };

  it("rampSeconds: fórmula logarítmica e caso constante", () => {
    expect(rampSeconds(4, 120, 60, 0, 4)).toBeCloseTo(4 * Math.LN2, 10);
    expect(rampSeconds(4, 120, 60, 0, 4)).toBeGreaterThan(2);
    expect(rampSeconds(4, 120, 60, 0, 4)).toBeLessThan(4);
    expect(rampSeconds(4, 100, 100, 1, 3)).toBeCloseTo(1.2);
    expect(rampSeconds(4, 120, 60, 1, 1)).toBe(0);
    // aditiva
    expect(rampSeconds(4, 120, 60, 0, 2) + rampSeconds(4, 120, 60, 2, 4)).toBeCloseTo(rampSeconds(4, 120, 60, 0, 4), 10);
  });

  it("120→60 em 4 tempos dura 4·ln2; startSec crescentes; BPM do acorde é o do início", () => {
    const ex = expandArrangement(ramped([2, 2], 120, 60));
    expect(ex.totalSec).toBeCloseTo(4 * Math.LN2, 10);
    expect(ex.events[0].startSec).toBe(0);
    expect(ex.events[1].startSec).toBeCloseTo(rampSeconds(4, 120, 60, 0, 2), 10);
    expect(ex.events[0].bpm).toBe(120);
    expect(ex.events[1].bpm).toBeCloseTo(90);
    expect(ex.events[1].endBpm).toBeCloseTo(60);
  });

  it("repetição reinicia a rampa; tempoMap tem um ponto por tempo", () => {
    const ex = expandArrangement(ramped([4], 120, 60, 2));
    expect(ex.events[1].bpm).toBe(120);
    expect(ex.events[1].startSec).toBeCloseTo(4 * Math.LN2, 10);
    const pts = ex.tempoMap;
    expect(pts.length).toBe(8);
    expect(pts[0].bpm).toBeCloseTo(60 / rampSeconds(4, 120, 60, 0, 1), 10);
    expect(pts.every((p, i) => i === 0 || p.startSec > pts[i - 1].startSec)).toBe(true);
    expect(pts[4].startBeat).toBe(4);
    expect(pts[3].bpm).toBeLessThan(pts[0].bpm);
  });

  it("sem rampTo (ou igual ao BPM) nada muda", () => {
    const song = ramped([4], 120, 120);
    const ex = expandArrangement(song);
    expect(ex.totalSec).toBeCloseTo(2);
    expect(ex.tempoMap.length).toBe(1);
    expect(ex.events[0].bpm).toBe(120);
  });

  it("bloco sem rampa depois de uma rampa volta ao BPM dele no tempoMap", () => {
    const song = ramped([4], 120, 60);
    const other = makeBlock("B", 1, [makeChord(0, "maj", 4)]);
    other.bpm = 120;
    song.blocks[other.id] = other;
    song.arrangement.push({ id: "z", blockId: other.id, repeat: 1 });
    const ex = expandArrangement(song);
    expect(ex.tempoMap[ex.tempoMap.length - 1].bpm).toBe(120);
    expect(ex.tempoMap[ex.tempoMap.length - 1].ramp).toBeUndefined();
  });
});
