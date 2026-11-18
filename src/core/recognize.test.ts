import { describe, expect, it } from "vitest";
import type { Chord, QualityId } from "./chords";
import { scaleContext } from "./diatonic";
import { chordIntervals, chordSymbol, conflictsWith, type Modifier } from "./modifiers";
import { makeSpeller, mod12 } from "./pitch";
import { recognizeCandidates, recognizeChord } from "./recognize";

const spell = makeSpeller(null, [], "auto");
const E = 4, A = 9;

function sym(notes: number[], ctx?: Parameters<typeof recognizeChord>[1]): string | null {
  const r = recognizeChord(notes, ctx);
  if (!r) return null;
  return chordSymbol({ id: "t", duration: 4, ...r } as Chord, spell);
}

describe("recognizeChord: casos nomeados", () => {
  const cases: [string, number[], string | null][] = [
    ["C-E-G", [60, 64, 67], "C"],
    ["E-G-C (grave E)", [52, 55, 60], "C/E"],
    ["A-C-E-G", [57, 60, 64, 67], "Am7"],
    ["C-E-G-A grave C", [48, 52, 55, 57], "C6"],
    ["G-B-D-F", [55, 59, 62, 65], "G7"],
    ["B-D-F-A", [59, 62, 65, 69], "Bm7♭5"],
    ["B-D-F-Ab", [59, 62, 65, 68], "B°7"],
    ["C-Eb-Gb-A", [48, 51, 54, 57], "C°7"],
    ["C-E-G#", [60, 64, 68], "C+"],
    ["E-G#-C grave E", [52, 56, 60], "E+"],
    ["C-E-G-Bb-D", [60, 64, 67, 70, 74], "C9"],
    ["C-E-G-D", [60, 64, 67, 74], "Cadd9"],
    ["C-F-G", [60, 65, 67], "Csus4"],
    ["C-D-G", [60, 62, 67], "Csus2"],
    ["C-G", [60, 67], "C5"],
    ["C-E", [60, 64], null],
    ["C", [60], null],
    ["vazio", [], null],
    ["C-E-Bb", [60, 64, 70], "C7(no5)"],
    ["C-E-G-B", [60, 64, 67, 71], "Cmaj7"],
    ["D-F-A-C-E", [62, 65, 69, 72, 76], "Dm9"],
    ["G-B-D-F-Ab", [55, 59, 62, 65, 68], "G7(♭9)"],
    ["duplicatas e oitavas", [48, 64, 67, 79, 60], "C"],
    ["impossível C-C#-D-D#", [60, 61, 62, 63], null],
  ];
  for (const [name, notes, expected] of cases) {
    it(name, () => expect(sym(notes)).toBe(expected));
  }

  it("ordem das notas não importa", () => {
    expect(sym([67, 48, 64])).toBe("C");
  });

  it("baixo igual à fundamental omite bass", () => {
    expect(recognizeChord([48, 64, 67])?.bass).toBeUndefined();
    expect(recognizeChord([52, 55, 60])?.bass).toBe(E);
  });
});

describe("ctx", () => {
  it("Lá menor natural prefere Am7 a C6/A", () => {
    const ctx = scaleContext(A, "minor");
    expect(sym([57, 60, 64, 67], ctx)).toBe("Am7");
    const cands = recognizeCandidates([57, 60, 64, 67], ctx);
    expect(cands.length).toBeGreaterThan(1);
  });
});

describe("recognizeCandidates", () => {
  it("primeira = recognizeChord e respeita max", () => {
    const notes = [57, 60, 64, 67];
    expect(recognizeCandidates(notes)[0]).toEqual(recognizeChord(notes));
    expect(recognizeCandidates(notes, null, 2).length).toBeLessThanOrEqual(2);
  });
});

describe("ida e volta", () => {
  const mods: Modifier[] = [
    { kind: "ext", value: 7 }, { kind: "ext", value: "maj7" }, { kind: "ext", value: 6 }, { kind: "ext", value: 9 },
    { kind: "ext", value: 11 }, { kind: "ext", value: 13 }, { kind: "sus", value: 4 }, { kind: "add", value: 9 },
    { kind: "alt", value: "b9" }, { kind: "alt", value: "#11" }, { kind: "omit", value: 5 },
  ];
  const qualities: QualityId[] = ["maj", "m", "dim", "aug", "sus4", "sus2"];
  const combos: Modifier[][] = [[], ...mods.map((m) => [m])];
  for (let i = 0; i < mods.length; i++) {
    for (let j = i + 1; j < mods.length; j++) if (!conflictsWith(mods[i], mods[j])) combos.push([mods[i], mods[j]]);
  }

  it("mesmas classes de altura e fundamental = baixo", () => {
    let checked = 0;
    for (const quality of qualities) {
      for (const modifiers of combos) {
        const ivs = chordIntervals({ quality, modifiers });
        const pcsOf = (root: number) => new Set(ivs.map((i) => mod12(root + i)));
        // Simétricos/ambíguos: só comparamos conjunto e raiz quando a raiz é única por custo.
        for (let root = 0; root < 12; root++) {
          const notes = ivs.map((i) => 48 + root + i);
          if (pcsOf(root).size < 3) continue;
          const r = recognizeChord(notes);
          expect(r, `${quality} ${JSON.stringify(modifiers)} @${root}`).not.toBeNull();
          const rec = chordIntervals({ quality: r!.quality, modifiers: r!.modifiers });
          expect(new Set(rec.map((i) => mod12(r!.root + i)))).toEqual(pcsOf(root));
          // Baixo da leitura sempre = nota mais grave tocada.
          expect(r!.bass ?? r!.root).toBe(mod12(Math.min(...notes)));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("fundamental preservada em acordes sem ambiguidade (tríades e sétimas comuns)", () => {
    const simple: [QualityId, Modifier[]][] = [
      ["maj", []], ["m", []], ["dim", []], ["sus4", []], ["sus2", []], ["maj", [{ kind: "ext", value: 7 }]],
      ["m", [{ kind: "ext", value: 7 }]], ["maj", [{ kind: "ext", value: "maj7" }]], ["maj", [{ kind: "ext", value: 9 }]],
    ];
    for (const [quality, modifiers] of simple) {
      for (let root = 0; root < 12; root++) {
        const notes = chordIntervals({ quality, modifiers }).map((i) => 48 + root + i);
        expect(recognizeChord(notes)?.root, `${quality} @${root}`).toBe(root);
      }
    }
  });
});

describe("desempenho", () => {
  it("1000 reconhecimentos em < 200 ms", () => {
    recognizeChord([60, 64, 67]); // aquece a tabela
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) recognizeChord([48 + (i % 12), 52 + (i % 12), 55 + (i % 12), 58 + (i % 12), 62 + (i % 12)]);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
