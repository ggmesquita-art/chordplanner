// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeChord, type Chord } from "../core/chords";
import type { Modifier } from "../core/modifiers";
import { chordKind } from "../core/notation";
import { makeBlock, makeSong, type Song } from "../core/song";
import { songToAbc } from "./abc";
import { songToChordPro } from "./chordpro";
import { songToMusicXml } from "./musicxml";

const mk = (root: number, quality: Chord["quality"], duration: number, modifiers: Modifier[] = [], bass?: number): Chord => ({ ...makeChord(root, quality, duration), modifiers, ...(bass !== undefined ? { bass } : {}) });

function fixture(): Song {
  const song = makeSong();
  song.bpm = 100;
  const a = song.blocks[song.arrangement[0].blockId];
  a.name = 'Verso & <"A">';
  a.chords = [
    mk(0, "maj", 2, [], 4), // C/E
    mk(9, "m", 3, [{ kind: "ext", value: 7 }]), // Am7 cruza a barra (2..5)
    mk(7, "maj", 0.5, [], 11), // G/B (meio tempo)
    mk(7, "maj", 1.5, [{ kind: "ext", value: 9 }]), // G9
    mk(5, "maj", 1),
  ];
  a.ending = [mk(4, "maj", 4, [{ kind: "ext", value: 7 }, { kind: "alt", value: "b9" }])];
  song.arrangement[0].repeat = 2;
  const b = makeBlock("Refrão", 1, [mk(10, "maj", 3, [{ kind: "ext", value: 7 }]), mk(3, "maj", 3), mk(0, "m", 2, [{ kind: "ext", value: 7 }])]);
  b.meter = [3, 4];
  b.bpm = 120;
  b.key = { tonic: 3, scaleId: "major" };
  song.blocks[b.id] = b;
  song.arrangement.push({ id: "x", blockId: b.id, repeat: 1 });
  return song;
}

const bareSong = (chords: Chord[]) => {
  const song = makeSong();
  song.blocks[song.arrangement[0].blockId].chords = chords;
  return song;
};

describe("MusicXML", () => {
  const xml = songToMusicXml(fixture(), { title: "Teste & <cia>" });
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parts = [...doc.getElementsByTagName("part")];

  it("é XML bem-formado, com título e rehearsal escapados", () => {
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    expect(doc.getElementsByTagName("work-title")[0].textContent).toBe("Teste & <cia>");
    expect(xml).toContain("<!DOCTYPE score-partwise");
    expect([...doc.getElementsByTagName("rehearsal")].map((e) => e.textContent)).toEqual(['Verso & <"A">', 'Verso & <"A"> (2)', "Refrão"]);
  });

  it("soma das durações de cada compasso = capacidade (ambas as partes)", () => {
    expect(parts.length).toBe(2);
    for (const part of parts) {
      let divisions = 0;
      let beats = 4;
      let beatType = 4;
      const measures = [...part.getElementsByTagName("measure")];
      expect(measures.length).toBe(7); // 2 + 2 (casa 2) + 3 (Refrão, 3/4)
      for (const m of measures) {
        divisions = Number(m.getElementsByTagName("divisions")[0]?.textContent ?? divisions);
        beats = Number(m.getElementsByTagName("beats")[0]?.textContent ?? beats);
        beatType = Number(m.getElementsByTagName("beat-type")[0]?.textContent ?? beatType);
        const sum = [...m.getElementsByTagName("note")].filter((n) => !n.getElementsByTagName("chord").length).reduce((acc, n) => acc + Number(n.getElementsByTagName("duration")[0].textContent), 0);
        expect(sum).toBe((beats * divisions * 4) / beatType);
      }
    }
  });

  it("acorde que atravessa a barra vira nota ligada (tie start/stop)", () => {
    const [m1, m2] = [...parts[0].getElementsByTagName("measure")];
    const ties = (m: Element) => [...m.getElementsByTagName("tie")].map((t) => t.getAttribute("type"));
    expect(ties(m1).filter((t) => t === "start").length).toBe(4); // Am7: 4 notas
    expect(ties(m2).filter((t) => t === "stop").length).toBe(4);
    expect(m2.getElementsByTagName("tied").length).toBeGreaterThan(0);
  });

  it("harmony: root/alter, kind, text, bass e degree", () => {
    const h = [...doc.getElementsByTagName("harmony")].map((e) => ({
      step: e.getElementsByTagName("root-step")[0].textContent,
      alter: e.getElementsByTagName("root-alter")[0]?.textContent ?? null,
      kind: e.getElementsByTagName("kind")[0].textContent,
      text: e.getElementsByTagName("kind")[0].getAttribute("text"),
      bass: e.getElementsByTagName("bass-step")[0]?.textContent ?? null,
      degrees: [...e.getElementsByTagName("degree")].map((d) => `${d.getElementsByTagName("degree-value")[0].textContent}/${d.getElementsByTagName("degree-alter")[0].textContent}/${d.getElementsByTagName("degree-type")[0].textContent}`),
    }));
    expect(h[0]).toMatchObject({ step: "C", kind: "major", bass: "E" });
    expect(h[1]).toMatchObject({ step: "A", kind: "minor-seventh", text: "m7" });
    expect(h[2]).toMatchObject({ step: "G", bass: "B" });
    expect(h[3]).toMatchObject({ step: "G", kind: "dominant-ninth", text: "9" });
    const e7 = h.find((x) => x.step === "E");
    expect(e7).toMatchObject({ kind: "dominant", degrees: ["9/-1/add"] });
    expect(h.find((x) => x.step === "B")).toMatchObject({ alter: "-1", kind: "dominant", text: "7" });
  });

  it("armadura, compasso e andamento mudam no bloco com tom próprio", () => {
    const measures = [...parts[0].getElementsByTagName("measure")];
    expect(measures[0].getElementsByTagName("fifths")[0].textContent).toBe("0");
    const m5 = measures[4];
    expect(m5.getElementsByTagName("fifths")[0].textContent).toBe("-3");
    expect(m5.getElementsByTagName("mode")[0].textContent).toBe("major");
    expect(m5.getElementsByTagName("beats")[0].textContent).toBe("3");
    expect([...doc.getElementsByTagName("sound")].map((e) => e.getAttribute("tempo"))).toEqual(["100", "120"]);
  });

  it("pausa preenche o compasso incompleto e meio tempo vira colcheia", () => {
    const m7 = [...parts[0].getElementsByTagName("measure")][6];
    expect(m7.getElementsByTagName("rest").length).toBe(1);
    expect(xml).toContain("<type>eighth</type>"); // G/B: meio tempo
  });

  it("acidentes na grafia técnica: Bb7 em Mib usa notas da armadura; E7(b9) pede ♯ explícito", () => {
    const notes = (m: Element) => [...m.getElementsByTagName("note")].map((n) => `${n.getElementsByTagName("step")[0]?.textContent}${n.getElementsByTagName("alter")[0]?.textContent ?? ""}`);
    const measures = [...parts[0].getElementsByTagName("measure")];
    expect(notes(measures[4])).toEqual(["B-1", "D", "F", "A-1"]);
    expect(measures[4].getElementsByTagName("accidental").length).toBe(0);
    expect(notes(measures[3])).toEqual(["E", "G1", "B", "D", "F"]);
    expect(measures[3].getElementsByTagName("accidental")[0].textContent).toBe("sharp");
  });
});

describe("chordKind", () => {
  const k = (c: Chord) => chordKind(c);
  it("mapeia qualidades e extensões", () => {
    expect(k(mk(0, "m", 4, [{ kind: "ext", value: "maj7" }])).kind).toBe("major-minor");
    expect(k(mk(0, "dim", 4, [{ kind: "ext", value: 7 }])).kind).toBe("half-diminished");
    expect(k(mk(0, "dim", 4, [{ kind: "ext", value: 6 }])).kind).toBe("diminished-seventh");
    expect(k(mk(0, "aug", 4)).kind).toBe("augmented");
    expect(k(mk(0, "sus4", 4)).kind).toBe("suspended-fourth");
    expect(k(mk(0, "sus2", 4)).kind).toBe("suspended-second");
    expect(k(mk(0, "maj", 4, [{ kind: "ext", value: 6 }])).kind).toBe("major-sixth");
    expect(k(mk(0, "m", 4, [{ kind: "ext", value: 6 }])).kind).toBe("minor-sixth");
    expect(k(mk(0, "maj", 4, [{ kind: "ext", value: "maj7" }, { kind: "ext", value: 9 }])).kind).toBe("major-ninth");
    expect(k(mk(0, "m", 4, [{ kind: "ext", value: 11 }])).kind).toBe("minor-11th");
    expect(k(mk(0, "maj", 4, [{ kind: "ext", value: 13 }])).kind).toBe("dominant-13th");
    expect(k(mk(0, "5", 4)).kind).toBe("power");
  });
  it("graus para o que o kind não cobre", () => {
    expect(k(mk(0, "maj", 4, [{ kind: "ext", value: 7 }, { kind: "alt", value: "#11" }])).degrees).toEqual([{ value: 11, alter: 1, type: "add" }]);
    expect(k(mk(0, "maj", 4, [{ kind: "ext", value: 9 }, { kind: "alt", value: "#9" }])).degrees).toEqual([{ value: 9, alter: 1, type: "alter" }]);
    expect(k(mk(0, "maj", 4, [{ kind: "add", value: 9 }, { kind: "omit", value: 5 }])).degrees).toEqual([
      { value: 9, alter: 0, type: "add" },
      { value: 5, alter: 0, type: "subtract" },
    ]);
    expect(k(mk(0, "maj", 4, [{ kind: "sus", value: 4 }, { kind: "ext", value: 7 }])).degrees).toEqual([{ value: 7, alter: -1, type: "add" }]);
  });
});

/** Soma (em semibreves) de cada compasso de uma voz ABC, seguindo M:/L: do cabeçalho e inline. */
function abcBarSums(abc: string, voice: "V:1" | "V:2") {
  const lines = abc.split("\n");
  let meter = lines.find((l) => l.startsWith("M:"))!.slice(2).split("/").map(Number);
  const unit = Number(lines.find((l) => l.startsWith("L:1/"))!.slice(4));
  const sums: { sum: number; meter: number[] }[] = [];
  let current = "";
  for (const line of lines) {
    if (line.startsWith("V:")) current = line.slice(0, 3);
    else if (current === voice && !/^[A-Z%]:|^%%/.test(line)) {
      let text = line.replace(/"[^"]*"/g, "");
      for (const f of text.matchAll(/\[M:(\d+)\/(\d+)\]/g)) meter = [Number(f[1]), Number(f[2])];
      text = text.replace(/\[[KMQ]:[^\]]*\]/g, "");
      for (const bar of text.split(/\|\]?/).map((b) => b.trim()).filter(Boolean)) {
        let sum = 0;
        for (const t of bar.matchAll(/(\[[^\]]+\]|[=^_]*[A-Ga-gz][,']*)(\d*)-?/g)) sum += (t[2] ? Number(t[2]) : 1) / unit;
        sums.push({ sum, meter: [...meter] });
      }
    }
  }
  return sums;
}

describe("ABC", () => {
  const abc = songToAbc(fixture(), { title: "Teste" });
  it("cabeçalho, símbolos, ligadura, anotação de bloco e mudanças inline", () => {
    expect(abc).toMatch(/^X:1\nT:Teste\nM:4\/4\nL:1\/8\nQ:1\/4=100\n/);
    expect(abc).toContain("K:C\n");
    expect(abc).toContain('"C/E"[CEG]4');
    expect(abc).toContain('"Am7"[A,CEG]4- | [A,CEG]2'); // ligadura através da barra
    expect(abc).toContain('"G/B"[G,B,D]'); // meio tempo = 1 unidade de colcheia
    expect(abc).toContain('"G9"[G,B,DFA]3');
    expect(abc).toContain('"E7(b9)"[E^GBdf]8');
    expect(abc).toContain("[K:Eb][M:3/4][Q:1/4=120]");
    expect(abc).toContain('"^Refrão"');
    expect(abc).toContain("z2 |]");
  });
  it("soma das durações de cada compasso = capacidade (duas vozes)", () => {
    for (const v of ["V:1", "V:2"] as const) {
      const bars = abcBarSums(abc, v);
      expect(bars.length).toBe(7);
      for (const b of bars) expect(b.sum).toBeCloseTo(b.meter[0] / b.meter[1], 9);
    }
  });
});

describe("ChordPro", () => {
  const cho = songToChordPro(fixture(), undefined, { title: "Teste" });
  it("diretivas, seções, repetição ×N e casa 2", () => {
    expect(cho).toContain("{title: Teste}");
    expect(cho).toContain("{tempo: 100}\n{time: 4/4}");
    expect(cho).toContain('{start_of_verse: Verso & <"A"> ×2}');
    expect(cho).toContain("|: [C/E] . [Am7] . | 1. . [G/B]~[G9] . [F] :| 2. [E7(b9)] . . . |");
    expect(cho).toContain("{key: Eb}\n{tempo: 120}\n{time: 3/4}");
    expect(cho).toContain("| [Bb7] . . | [Eb] . . | [Cm7] . . |");
    expect(cho.match(/\{end_of_verse\}/g)?.length).toBe(2);
  });
  it("repetição sem casa 2 e inversão de grafia por bloco", () => {
    const song = bareSong([mk(10, "maj", 4), mk(0, "maj", 4)]);
    song.arrangement[0].repeat = 3;
    const out = songToChordPro(song, () => (pc) => ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"][pc]);
    expect(out).toContain("|: [Bb] . . . | [C] . . . :|");
    expect(out).toContain("×3");
  });
});

describe("correções da revisão", () => {
  it("ChordPro: chaves e quebras de linha no título não fecham a diretiva", () => {
    const out = songToChordPro(bareSong([mk(0, "maj", 4)]), undefined, { title: "Song {live}\nX" });
    expect(out.split("\n")[0]).toBe("{title: Song live X}");
  });

  it("MusicXML: Ré dórico sai com mode dorian (fifths 0 + minor seria Lá menor)", () => {
    const xml = songToMusicXml(bareSong([mk(2, "m", 4)]), { keyFor: () => ({ tonic: 2, scaleId: "dorian" }) });
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("fifths")[0].textContent).toBe("0");
    expect(doc.getElementsByTagName("mode")[0].textContent).toBe("dorian");
  });
});
