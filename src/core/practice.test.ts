import { describe, expect, it } from "vitest";
import { scaleContext } from "./diatonic";
import { makeQuestion, scoreAnswer } from "./practice";

const major = scaleContext(0, "major");
const minor = scaleContext(0, "minor");
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe("makeQuestion", () => {
  it("Dó maior básico: alvo em I, IV, V, vi e opções na ordem da escala", () => {
    const q = makeQuestion(major, "basic", () => 0);
    expect(q.options.map((o) => o.roman)).toEqual(["I", "IV", "V", "vi"]);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const t = makeQuestion(major, "basic", () => r).target;
      expect(["I", "IV", "V", "vi"]).toContain(t.roman);
    }
  });

  it("cadência C F G C", () => {
    const q = makeQuestion(major, "basic", () => 0);
    expect(q.cadence.map((c) => [c.root, c.quality])).toEqual([[0, "maj"], [5, "maj"], [7, "maj"], [0, "maj"]]);
  });

  it("menor natural: i iv v i (o v é menor no contexto) e ♭VI no básico", () => {
    const q = makeQuestion(minor, "basic", () => 0);
    expect(q.cadence.map((c) => [c.root, c.quality])).toEqual([[0, "m"], [5, "m"], [7, "m"], [0, "m"]]);
    expect(q.options.map((o) => o.roman)).toEqual(["i", "iv", "v", "♭VI"]);
  });

  it("todos os graus: 7 opções", () => {
    expect(makeQuestion(major, "all", () => 0).options).toHaveLength(7);
  });

  it("nunca repete o grau anterior", () => {
    for (const r of [0, 0.2, 0.5, 0.9, 0.999]) {
      for (let prev = 0; prev < 7; prev++) expect(makeQuestion(major, "all", () => r, prev).target.degreeIndex).not.toBe(prev);
    }
    const a = makeQuestion(major, "all", seq(0.1, 0.5, 0.9));
    expect(a.target.degreeIndex).toBeGreaterThanOrEqual(0);
  });

  it("escala sem I-IV-V (pentatônica): cadência não quebra", () => {
    const q = makeQuestion(scaleContext(0, "major-pentatonic"), "basic", () => 0.5);
    expect(q.cadence).toHaveLength(4);
    expect(q.options.length).toBeGreaterThan(1);
  });
});

describe("scoreAnswer", () => {
  it("compara o grau", () => {
    const q = makeQuestion(major, "basic", () => 0);
    expect(scoreAnswer(q, q.target.degreeIndex)).toBe(true);
    expect(scoreAnswer(q, q.target.degreeIndex + 1)).toBe(false);
  });
});
