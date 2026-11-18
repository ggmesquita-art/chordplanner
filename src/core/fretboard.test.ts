import { describe, expect, it } from "vitest";
import { makeChord, type Chord, type QualityId } from "./chords";
import { GUITAR_TUNING, guitarVoicing } from "./fretboard";
import { chordIntervals, type Modifier } from "./modifiers";
import { mod12 } from "./pitch";

const mk = (root: number, quality: QualityId, modifiers: Modifier[] = [], bass?: number): Chord => ({ ...makeChord(root, quality), modifiers, ...(bass === undefined ? {} : { bass }) });
const str = (c: Chord) => guitarVoicing(c)?.strings.map((f) => (f === null ? "x" : f)).join("");
const seventh: Modifier = { kind: "ext", value: 7 };

describe("guitarVoicing", () => {
  it("formas abertas clássicas", () => {
    expect(str(mk(0, "maj"))).toBe("x32010");
    expect(str(mk(9, "m"))).toBe("x02210");
    expect(str(mk(4, "maj", [seventh]))).toBe("020100");
    expect(str(mk(4, "m"))).toBe("022000");
    expect(["320003", "320033", "320000"]).toContain(str(mk(7, "maj")));
    expect(str(mk(2, "maj"))).toBe("xx0232");
    expect(str(mk(2, "m", [seventh]))).toBe("xx0211");
  });

  it("Fmaj7 tem F no baixo e as quatro notas", () => {
    const v = guitarVoicing(mk(5, "maj", [{ kind: "ext", value: "maj7" }]))!;
    expect(new Set(v.notes.map(mod12))).toEqual(new Set([5, 9, 0, 4]));
    expect(mod12(v.notes[0])).toBe(5);
  });

  it("baixo slash: C/E tem E na corda mais grave tocada", () => {
    const v = guitarVoicing(mk(0, "maj", [], 4))!;
    expect(mod12(v.notes[0])).toBe(4);
    expect(new Set(v.notes.map(mod12))).toEqual(new Set([0, 4, 7]));
  });

  it("todas as saídas: abertura ≤ 4 casas, notas do acorde, baixo e essenciais corretos", () => {
    const qualities: QualityId[] = ["maj", "m", "dim", "aug", "sus4", "sus2", "5"];
    const modsets: Modifier[][] = [[], [seventh], [{ kind: "ext", value: "maj7" }], [{ kind: "ext", value: 9 }], [{ kind: "add", value: 9 }]];
    for (let root = 0; root < 12; root++)
      for (const q of qualities)
        for (const mods of modsets) {
          const chord = mk(root, q, mods);
          const v = guitarVoicing(chord);
          if (!v) continue;
          const pcs = new Set(chordIntervals(chord).map((i) => mod12(root + i)));
          const fretted = v.strings.filter((f): f is number => !!f);
          if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
          v.notes.forEach((n) => expect(pcs.has(mod12(n))).toBe(true));
          expect(mod12(v.notes[0])).toBe(root);
          const played = v.strings.flatMap((f, s) => (f === null ? [] : [GUITAR_TUNING[s] + f]));
          expect(played).toEqual(v.notes);
        }
  });

  it("acorde denso: 13(♭9,♯11) devolve digitação com fundamental, 3ª e 7ª (a 5ª e a 13ª podem faltar)", () => {
    const chord = mk(0, "maj", [{ kind: "ext", value: 13 }, { kind: "alt", value: "b9" }, { kind: "alt", value: "#11" }]);
    const v = guitarVoicing(chord)!;
    expect(v).not.toBeNull();
    const pcs = new Set(v.notes.map(mod12));
    for (const pc of [0, 4, 10]) expect(pcs.has(pc)).toBe(true);
    expect(v.notes.length).toBeLessThanOrEqual(6);
  });

  it("casa inicial: posições altas mostram a casa; abertas ficam em 1", () => {
    expect(guitarVoicing(mk(0, "maj"))!.baseFret).toBe(1);
    const high = guitarVoicing(mk(6, "maj"), { maxFret: 12 })!;
    expect(high.baseFret).toBeGreaterThanOrEqual(1);
  });

  it("sem digitação viável devolve null", () => {
    expect(guitarVoicing(mk(0, "maj"), { maxFret: 0 })).toBeNull();
  });
});
