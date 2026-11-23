import { describe, expect, it } from "vitest";
import { scaleContext } from "./diatonic";
import {
  MELODY_DEFAULT_HIGH,
  MELODY_DEFAULT_LOW,
  MELODY_MAX_MIDI,
  MELODY_MIN_MIDI,
  isPitchInScale,
  makeMelodyNote,
  melodyEndBeat,
  normalizeMonophonic,
  scalePitchesInRange,
  shortestTransposeDelta,
  sliceMelodyForPass,
  snapMelodyToScale,
  snapPitchToScale,
  transposeMelody,
  upsertMelodyNote,
} from "./melody";

describe("makeMelodyNote e melodyEndBeat", () => {
  it("limita altura em C2..C7, início >= 0, duração em 0.25..64 e velocity", () => {
    const a = makeMelodyNote(12, -3, 0.1, 2);
    expect(a.pitch).toBe(MELODY_MIN_MIDI);
    expect(a.start).toBe(0);
    expect(a.duration).toBe(0.25);
    expect(a.velocity).toBe(1);

    const b = makeMelodyNote(120, 4, 200, 0);
    expect(b.pitch).toBe(MELODY_MAX_MIDI);
    expect(b.duration).toBe(64);
    expect(b.velocity).toBe(0.05);

    expect(melodyEndBeat([a, b])).toBe(68);
    expect(melodyEndBeat(undefined)).toBe(0);
  });
});

describe("normalizeMonophonic e upsertMelodyNote", () => {
  it("encurta nota anterior que invade a nova e descarta se ficar menor que 0.25", () => {
    const a = { ...makeMelodyNote(60, 0, 2), id: "a" };
    const b = { ...makeMelodyNote(64, 1.5, 1), id: "b" };
    const res = upsertMelodyNote([a], b);
    expect(res.map((n) => [n.id, n.start, n.duration])).toEqual([
      ["a", 0, 1.5],
      ["b", 1.5, 1],
    ]);

    const c = { ...makeMelodyNote(67, 0.125, 1), id: "c" };
    const res2 = upsertMelodyNote([a], c);
    expect(res2.map((n) => n.id)).toEqual(["c"]);
  });

  it("substitui notas cobertas pelo intervalo da nova e mantém notas posteriores", () => {
    const n1 = { ...makeMelodyNote(60, 1, 0.5), id: "n1" };
    const n2 = { ...makeMelodyNote(62, 1.5, 0.5), id: "n2" };
    const n3 = { ...makeMelodyNote(64, 2.5, 1), id: "n3" };
    const pri = { ...makeMelodyNote(67, 1, 1.5), id: "pri" };
    const res = upsertMelodyNote([n1, n2, n3], pri);
    expect(res.map((n) => n.id)).toEqual(["pri", "n3"]);
  });

  it("normalização sem priorityId resolve sobreposições da esquerda para a direita", () => {
    const a = { ...makeMelodyNote(60, 0, 3), id: "a" };
    const b = { ...makeMelodyNote(62, 1, 2), id: "b" };
    const norm = normalizeMonophonic([b, a]);
    expect(norm.map((n) => [n.id, n.start, n.duration])).toEqual([
      ["a", 0, 1],
      ["b", 1, 2],
    ]);
  });
});

describe("transposição e ajuste à escala", () => {
  it("shortestTransposeDelta escolhe o menor caminho em [-5, +6]", () => {
    expect(shortestTransposeDelta(0, 2)).toBe(2);
    expect(shortestTransposeDelta(0, 11)).toBe(-1);
    expect(shortestTransposeDelta(11, 0)).toBe(1);
    expect(shortestTransposeDelta(0, 6)).toBe(6);
  });

  it("transposeMelody preserva dentro de C2..C7 ajustando a oitava se passar da borda", () => {
    const low = [makeMelodyNote(37, 0, 1), makeMelodyNote(41, 1, 1)];
    const movedDown = transposeMelody(low, -3);
    expect(movedDown.map((n) => n.pitch)).toEqual([46, 50]);

    const high = [makeMelodyNote(94, 0, 1), makeMelodyNote(95, 1, 1)];
    const movedUp = transposeMelody(high, 4);
    expect(movedUp.map((n) => n.pitch)).toEqual([86, 87]);
  });

  it("isPitchInScale, snapPitchToScale e snapMelodyToScale", () => {
    const ctx = scaleContext(0, "major");
    expect(isPitchInScale(60, ctx)).toBe(true);
    expect(isPitchInScale(61, ctx)).toBe(false);
    expect(isPitchInScale(61, null)).toBe(true);
    // C#4 (61): distância 1 para C4 (60) e D4 (62); empate desce para 60.
    expect(snapPitchToScale(61, ctx)).toBe(60);
    const snapped = snapMelodyToScale([makeMelodyNote(61, 0, 1), makeMelodyNote(64, 1, 1)], ctx);
    expect(snapped.map((n) => n.pitch)).toEqual([60, 64]);
  });

  it("scalePitchesInRange dobra na escala e inclui notas extras fora da escala", () => {
    const ctx = scaleContext(0, "major");
    const pitches = scalePitchesInRange(ctx, MELODY_DEFAULT_LOW, MELODY_DEFAULT_HIGH, [61]);
    expect(pitches[0]).toBe(84);
    expect(pitches.at(-1)).toBe(60);
    expect(pitches).toContain(61);
    expect(pitches).not.toContain(63);
    expect(scalePitchesInRange(null, 60, 64)).toEqual([64, 63, 62, 61, 60]);
  });
});

describe("sliceMelodyForPass", () => {
  it("recorta notas nas bordas da janela", () => {
    const notes = [makeMelodyNote(60, 0, 2), makeMelodyNote(64, 2, 3), makeMelodyNote(67, 6, 1)];
    const sliced = sliceMelodyForPass(notes, 1, 4);
    expect(sliced.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [60, 1, 1],
      [64, 2, 2],
    ]);
  });

  it("normalização sem priorityId descarta resíduo menor que MELODY_MIN_DURATION (0.25)", () => {
    const a = { ...makeMelodyNote(60, 0, 2), id: "a" };
    const b = { ...makeMelodyNote(62, 0.1, 1), id: "b" };
    const norm = normalizeMonophonic([a, b]);
    expect(norm.map((n) => [n.id, n.start, n.duration])).toEqual([["b", 0.1, 1]]);
  });
});
