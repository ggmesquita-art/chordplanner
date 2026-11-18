import { describe, expect, it } from "vitest";
import { makeChord } from "./chords";
import { expandArrangement, makeBlock, makeSong } from "./song";
import { formatPosition } from "./timeline";

describe("mudança de compasso e andamento entre blocos", () => {
  // A: 4/4, 120 bpm, 4 tempos x2 reps = 2 compassos; B: 7/8, 90 bpm, 7 tempos x1 = 1 compasso; C: 6/8, 60 bpm, 12 tempos x2 = 4 compassos.
  const build = () => {
    const song = makeSong();
    const a = makeBlock("A", 0, [makeChord(0, "maj", 4)]);
    const b = makeBlock("B", 1, [makeChord(7, "maj", 7)]);
    const c = makeBlock("C", 2, [makeChord(5, "maj", 6), makeChord(0, "maj", 6)]);
    a.bpm = 120;
    b.bpm = 90;
    b.meter = [7, 8];
    c.bpm = 60;
    c.meter = [6, 8];
    song.blocks = { [a.id]: a, [b.id]: b, [c.id]: c };
    song.arrangement = [
      { id: "i1", blockId: a.id, repeat: 2 },
      { id: "i2", blockId: b.id, repeat: 1 },
      { id: "i3", blockId: c.id, repeat: 2 },
    ];
    return song;
  };

  it("tempoMap, marcadores, posições e duração total", () => {
    const ex = expandArrangement(build());
    const aSec = 2 * 4 * (60 / 120); // 4
    const bSec = 7 * (60 / 90);
    const cSec = 2 * 12 * (60 / 60); // 24

    expect(ex.tempoMap.map((t) => [t.bpm, t.meter.join("/")])).toEqual([
      [120, "4/4"],
      [90, "7/8"],
      [60, "6/8"],
    ]);
    expect(ex.tempoMap[0].startSec).toBeCloseTo(0);
    expect(ex.tempoMap[1].startSec).toBeCloseTo(aSec);
    expect(ex.tempoMap[2].startSec).toBeCloseTo(aSec + bSec);

    expect(ex.markers.map((m) => m.startBar)).toEqual([0, 2, 3]);
    expect(ex.totalBars).toBe(7);
    expect(ex.totalSec).toBeCloseTo(aSec + bSec + cSec);

    // Primeiro acorde de cada bloco: posição no compasso do próprio bloco, deslocada pelos compassos anteriores.
    const firsts = ex.markers.map((m) => ex.events.find((e) => e.itemIndex === m.itemIndex)!);
    expect(firsts.map((e, i) => formatPosition(e.blockBeat, e.meter, ex.markers[i].startBar))).toEqual(["1.1", "3.1", "4.1"]);
    // Segundo acorde de C: tempo 7 do bloco = compasso 2, tempo 1.
    const c2 = ex.events.find((e) => e.itemIndex === 2 && e.chordIndex === 1 && e.repetition === 0)!;
    expect(formatPosition(c2.blockBeat, c2.meter, ex.markers[2].startBar)).toBe("5.1");
  });
});
