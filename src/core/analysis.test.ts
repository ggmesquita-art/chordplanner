import { describe, expect, it } from "vitest";
import { harmonicFunction, nextChordSuggestions } from "./analysis";
import { makeChord, type QualityId } from "./chords";
import { scaleContext } from "./diatonic";
import { WHEEL_RINGS, sliceClickable, sliceState } from "./view";

const C = scaleContext(0, "major");
const Am = scaleContext(9, "minor");
const fn = (ctx: typeof C, root: number, q: QualityId) => harmonicFunction(ctx, { root, quality: q, modifiers: [] });

describe("função harmônica", () => {
  it("Dó maior: I, iii, vi = T; ii, IV = SD; V, vii° = D", () => {
    expect(fn(C, 0, "maj")).toBe("T");
    expect(fn(C, 2, "m")).toBe("SD");
    expect(fn(C, 4, "m")).toBe("T");
    expect(fn(C, 5, "maj")).toBe("SD");
    expect(fn(C, 7, "maj")).toBe("D");
    expect(fn(C, 9, "m")).toBe("T");
    expect(fn(C, 11, "dim")).toBe("D");
  });

  it("Lá menor: i = T, iv = SD, V emprestado = D, ♭VI = T", () => {
    expect(fn(Am, 9, "m")).toBe("T");
    expect(fn(Am, 2, "m")).toBe("SD");
    expect(fn(Am, 4, "maj")).toBe("D");
    expect(fn(Am, 5, "maj")).toBe("T");
  });

  it("cromáticos: V/x = D, ii/x = SD, ♭VI emprestado no maior = SD, fora da escala = null", () => {
    expect(fn(C, 2, "maj")).toBe("D"); // V/V
    expect(fn(C, 4, "dim")).toBe("SD"); // ii°/ii
    expect(fn(C, 8, "maj")).toBe("SD"); // ♭VI
    expect(fn(C, 6, "maj")).toBeNull();
  });

  it("escalas não heptatônicas ou sem 3ª/5ª: null", () => {
    expect(fn(scaleContext(0, "whole-tone"), 0, "aug")).toBeNull();
    expect(fn(scaleContext(0, "chromatic"), 0, "maj")).toBeNull();
    expect(fn(scaleContext(0, "major-pentatonic"), 0, "maj")).toBeNull();
  });
});

describe("sugestões do próximo acorde", () => {
  const h = (...cs: [number, QualityId][]) => cs.map(([r, q]) => makeChord(r, q));

  it("depois de Dm vem G (ii–V–I); depois de G vem C", () => {
    const afterDm = nextChordSuggestions(C, h([0, "maj"], [2, "m"]));
    expect(afterDm[0]).toMatchObject({ root: 7, quality: "maj", reason: "ii–V–I" });
    const afterG = nextChordSuggestions(C, h([0, "maj"], [2, "m"], [7, "maj"]));
    expect(afterG[0]).toMatchObject({ root: 0, quality: "maj" });
  });

  it("histórico vazio começa pela tônica; pesos 0–1 em ordem decrescente", () => {
    const s = nextChordSuggestions(C, []);
    expect(s[0]).toMatchObject({ root: 0, quality: "maj" });
    expect(s.map((x) => x.root)).toEqual([0, 5, 7]);
    for (const x of s) expect(x.weight > 0 && x.weight <= 1).toBe(true);
    expect(s.map((x) => x.weight)).toEqual([...s.map((x) => x.weight)].sort((a, b) => b - a));
  });

  it("menor: i–♭VI–♭III–♭VII", () => {
    const s = nextChordSuggestions(Am, h([9, "m"], [5, "maj"], [0, "maj"]));
    expect(s[0]).toMatchObject({ root: 7, quality: "maj" });
  });

  it("dominante secundária resolve no alvo", () => {
    const s = nextChordSuggestions(C, h([0, "maj"], [2, "maj"])); // V/V
    expect(s[0]).toMatchObject({ root: 7, quality: "maj" });
  });

  it("nunca sugere nada que o Colorido não libere", () => {
    for (const ctx of [C, Am, scaleContext(2, "dorian")]) {
      for (const root of [0, 2, 4, 7, 9, 11]) {
        for (const ring of WHEEL_RINGS) {
          const sug = nextChordSuggestions(ctx, h([root, ring.quality]), 36);
          for (const x of sug) expect(sliceClickable(sliceState(ctx, x.root, x.quality), "colorful")).toBe(true);
          expect(sug.some((x) => x.root === root && x.quality === ring.quality)).toBe(false);
        }
      }
    }
  });
});
