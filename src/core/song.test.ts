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

describe("casa 1 / casa 2", () => {
  function withEnding(repeat = 2) {
    const song = makeSong();
    song.bpm = 120;
    song.arrangement[0].repeat = repeat;
    const block = song.blocks[song.arrangement[0].blockId];
    block.chords = [makeChord(0, "maj", 4), makeChord(5, "maj", 4), makeChord(7, "maj", 4), makeChord(0, "maj", 4)];
    block.ending = [makeChord(5, "maj", 2), makeChord(7, "maj", 2)];
    return { song, block };
  }

  it("a última passada troca o último compasso pela casa 2", () => {
    const { song } = withEnding();
    const ex = expandArrangement(song);
    expect(ex.events.map((e) => [e.repetition, e.chordIndex, !!e.inEnding])).toEqual([
      [0, 0, false], [0, 1, false], [0, 2, false], [0, 3, false],
      [1, 0, false], [1, 1, false], [1, 2, false], [1, 0, true], [1, 1, true],
    ]);
    expect(ex.events.reduce((a, e) => a + e.beats, 0)).toBe(32);
    expect(ex.totalBars).toBe(8);
    expect(ex.events[7].blockBeat).toBe(12);
    expect(ex.events[8].blockBeat).toBe(14);
    ex.events.forEach((e, i) => {
      if (i > 0) expect(e.startSec).toBeCloseTo(ex.events[i - 1].startSec + ex.events[i - 1].durationSec);
      if (i > 0) expect(e.startBeat).toBe(ex.events[i - 1].startBeat + ex.events[i - 1].beats);
    });
    expect(ex.totalSec).toBeCloseTo(32 * 0.5);
  });

  it("com ×1 ou em região a casa 2 é ignorada", () => {
    const { song } = withEnding(1);
    expect(expandArrangement(song).events.length).toBe(4);
    const two = withEnding(2).song;
    expect(expandRegion(two, 0, 0, 3).events.some((e) => e.inEnding)).toBe(false);
  });

  it("acorde que atravessa a barra do último compasso é cortado nela", () => {
    const { song, block } = withEnding();
    block.chords = [makeChord(0, "maj", 4), makeChord(5, "maj", 8), makeChord(7, "maj", 4)];
    const ev = expandArrangement(song).events.filter((e) => e.repetition === 1);
    expect(ev.map((e) => [e.chordIndex, e.beats, !!e.inEnding])).toEqual([[0, 4, false], [1, 8, false], [0, 2, true], [1, 2, true]]);
    block.chords = [makeChord(0, "maj", 4), makeChord(5, "maj", 6), makeChord(7, "maj", 2)];
    const ev2 = expandArrangement(song).events.filter((e) => e.repetition === 1);
    expect(ev2.map((e) => [e.chordIndex, e.beats])).toEqual([[0, 4], [1, 4], [0, 2], [1, 2]]);
    expect(ev2[1].durationSec).toBeCloseTo(4 * 0.5);
  });

  it("com rampTo os tempos continuam crescentes e a rampa vai até o fim da última passada", () => {
    const { song, block } = withEnding();
    block.rampTo = 60;
    const ex = expandArrangement(song);
    for (let i = 1; i < ex.events.length; i++) expect(ex.events[i].startSec).toBeGreaterThan(ex.events[i - 1].startSec);
    const ramp = ex.tempoMap.filter((t) => t.ramp);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i].startSec).toBeGreaterThan(ramp[i - 1].startSec);
    const last = ex.events[ex.events.length - 1];
    expect(last.endBpm).toBeCloseTo(60);
    expect(last.startSec + last.durationSec).toBeCloseTo(ex.totalSec);
  });
});
