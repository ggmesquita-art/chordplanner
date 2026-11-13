import { describe, expect, it } from "vitest";
import { makeChord, type Chord } from "./chords";
import { chromaticFunction, scaleContext, romanFor } from "./diatonic";
import { chordIntervals, chordSymbol, inversionBass, modifierStatus, resolveChord, toggleModifier, type Modifier } from "./modifiers";
import { makeSpeller, mod12, pcName, spellScale } from "./pitch";
import { SCALES, getScale, pitchSet, scaleFormula, searchScales } from "./scales";
import { expandArrangement, makeBlock, makeSong } from "./song";
import { formatPosition, missingBeats } from "./timeline";
import { fitToRange, voiceChord } from "./voicing";
import { songToText } from "../export/text";

const sharpSpell = (pc: number) => pcName(pc, false);
const flatSpell = (pc: number) => pcName(pc, true);

function diatonicTriads(tonic: number, scaleId: string, spell = sharpSpell) {
  const ctx = scaleContext(tonic, scaleId);
  return ctx.degrees.map((d) => chordSymbol(makeChord(d.root, d.primary!), spell));
}

describe("catálogo de escalas", () => {
  it("tem ids únicos e intervalos válidos", () => {
    const ids = new Set<string>();
    for (const sc of SCALES) {
      expect(ids.has(sc.id), sc.id).toBe(false);
      ids.add(sc.id);
      expect(sc.intervals[0], sc.id).toBe(0);
      expect(new Set(sc.intervals).size, sc.id).toBe(sc.intervals.length);
      for (let i = 1; i < sc.intervals.length; i++) expect(sc.intervals[i], sc.id).toBeGreaterThan(sc.intervals[i - 1]);
      expect(Math.max(...sc.intervals), sc.id).toBeLessThan(12);
    }
    expect(SCALES.length).toBeGreaterThanOrEqual(65);
  });

  it("gera modos por rotação", () => {
    expect(getScale("dorian").intervals).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(getScale("phrygian-dominant").intervals).toEqual([0, 1, 4, 5, 7, 8, 10]);
    expect(getScale("altered").intervals).toEqual([0, 1, 3, 4, 6, 8, 10]);
    expect(getScale("hungarian-minor").intervals).toEqual([0, 2, 3, 6, 7, 8, 11]);
    expect(getScale("lydian-dominant").intervals).toEqual([0, 2, 4, 6, 7, 9, 10]);
  });

  it("fórmula e busca sem acento", () => {
    expect(scaleFormula(getScale("dorian"))).toBe("1 2 ♭3 4 5 6 ♭7");
    expect(scaleFormula(getScale("lydian-sharp2"))).toBe("1 ♯2 3 ♯4 5 6 7");
    expect(scaleFormula(getScale("minor-pentatonic"))).toBe("1 ♭3 4 5 ♭7");
    expect(searchScales("dorico").map((s) => s.id)).toContain("dorian");
    expect(searchScales("ahava").map((s) => s.id)).toEqual(["phrygian-dominant"]);
  });

  it("pitchSet", () => {
    expect(pitchSet(2, getScale("dorian"))).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });
});

describe("acordes diatônicos (§2.5)", () => {
  it("Dó maior", () => {
    expect(diatonicTriads(0, "major")).toEqual(["C", "Dm", "Em", "F", "G", "Am", "B°"]);
  });

  it("Lá menor harmônica", () => {
    expect(diatonicTriads(9, "harmonic-minor")).toEqual(["Am", "B°", "C+", "Dm", "E", "F", "G♯°"]);
  });

  it("algarismos romanos", () => {
    const romans = (t: number, id: string) => scaleContext(t, id).degrees.map((d) => d.roman);
    expect(romans(0, "major")).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    expect(romans(2, "dorian")).toEqual(["i", "ii", "♭III", "IV", "v", "vi°", "♭VII"]);
    expect(romans(9, "harmonic-minor")).toEqual(["i", "ii°", "♭III+", "iv", "V", "♭VI", "vii°"]);
  });

  it("escalas não heptatônicas usam a prioridade maj, m, dim, aug, sus4, sus2, 5", () => {
    const ctx = scaleContext(9, "minor-pentatonic"); // A C D E G
    expect(ctx.degrees.map((d) => d.primary)).toEqual(["m", "maj", "sus4", null, "sus4"]);
    const wt = scaleContext(0, "whole-tone");
    expect(wt.degrees.every((d) => d.primary === "aug")).toBe(true);
  });

  it("todas as escalas em todas as tônicas resolvem sem erro", () => {
    for (const sc of SCALES) for (let t = 0; t < 12; t++) expect(() => scaleContext(t, sc)).not.toThrow();
  });

  it("romano de acorde de fora da escala usa intervalo", () => {
    const ctx = scaleContext(0, "major");
    expect(romanFor(ctx, 10, "maj")).toBe("♭VII");
  });
});

describe("cromatismos idiomáticos (§3.7)", () => {
  const C = scaleContext(0, "major");
  const label = (root: number, q: Parameters<typeof chromaticFunction>[2]) => chromaticFunction(C, root, q);

  it("dominantes secundárias em Dó maior", () => {
    expect(label(2, "maj")).toMatchObject({ kind: "secondary", label: "V/V" });
    expect(label(4, "maj")).toMatchObject({ kind: "secondary", label: "V/vi" });
    expect(label(9, "maj")).toMatchObject({ kind: "secondary", label: "V/ii" });
    expect(label(11, "maj")).toMatchObject({ kind: "secondary", label: "V/iii" });
  });

  it("empréstimos do modo paralelo", () => {
    expect(label(10, "maj")).toMatchObject({ kind: "borrowed", label: "♭VII" });
    expect(label(8, "maj")).toMatchObject({ kind: "borrowed", label: "♭VI" });
    expect(label(5, "m")).toMatchObject({ kind: "borrowed", label: "iv" });
    const Am = scaleContext(9, "minor");
    expect(chromaticFunction(Am, 9, "maj")).toMatchObject({ kind: "secondary", label: "V/iv" });
    expect(chromaticFunction(Am, 4, "maj")).toMatchObject({ kind: "borrowed", label: "V" });
  });

  it("diatônicos e sem função ficam de fora", () => {
    expect(label(7, "maj")).toBeNull();
    expect(label(0, "dim")).toBeNull();
    expect(label(6, "maj")).toBeNull();
  });
});

describe("grafia (§2.6)", () => {
  it("toda escala heptatônica gera 7 letras distintas nas 12 tônicas", () => {
    for (const sc of SCALES.filter((s) => s.intervals.length === 7)) {
      for (let t = 0; t < 12; t++) {
        const names = [...spellScale(t, pitchSet(t, sc), "auto").values()];
        const letters = new Set(names.map((n) => n[0]));
        expect(letters.size, `${sc.id} @ ${t}: ${names.join(" ")}`).toBe(7);
      }
    }
  });

  it("Fá♯ maior tem E♯; Si♭ maior usa bemóis", () => {
    const fs = [...spellScale(6, pitchSet(6, getScale("major")), "sharp").values()];
    expect(fs).toEqual(["F♯", "G♯", "A♯", "B", "C♯", "D♯", "E♯"]);
    const bb = [...spellScale(10, pitchSet(10, getScale("major")), "auto").values()];
    expect(bb).toEqual(["B♭", "C", "D", "E♭", "F", "G", "A"]);
  });

  it("Ré♭ maior preferido a Dó♯ maior no automático", () => {
    const names = [...spellScale(1, pitchSet(1, getScale("major")), "auto").values()];
    expect(names[0]).toBe("D♭");
  });

  it("notas fora da escala seguem o grau relativo à tônica", () => {
    const spell = makeSpeller(0, pitchSet(0, getScale("major")), "auto");
    expect([1, 3, 6, 8, 10].map(spell)).toEqual(["D♭", "E♭", "F♯", "A♭", "B♭"]);
    const sharp = makeSpeller(0, pitchSet(0, getScale("major")), "sharp");
    expect(sharp(10)).toBe("A♯");
    const none = makeSpeller(null, [], "auto");
    expect([10, 3, 6, 1].map(none)).toEqual(["B♭", "E♭", "G♭", "D♭"]);
  });

  it("speller usa grafia da escala e cai na armadura fora dela", () => {
    const spell = makeSpeller(5, pitchSet(5, getScale("major")), "auto");
    expect(spell(10)).toBe("B♭");
    expect(spell(1)).toBe("D♭");
  });
});

describe("modificadores (§3.5, §4)", () => {
  const C = (quality: Chord["quality"], mods: Modifier[] = [], root = 0) => ({ ...makeChord(root, quality), modifiers: mods });

  it("símbolos canônicos", () => {
    expect(chordSymbol(C("maj", [{ kind: "ext", value: 7 }, { kind: "alt", value: "b9" }, { kind: "alt", value: "#11" }]), sharpSpell)).toBe("C7(♭9,♯11)");
    expect(chordSymbol(C("m", [{ kind: "ext", value: 9 }], 2), sharpSpell)).toBe("Dm9");
    expect(chordSymbol(C("maj", [{ kind: "ext", value: 13 }, { kind: "sus", value: 4 }], 7), sharpSpell)).toBe("G13sus4");
    expect(chordSymbol({ ...C("maj", [], 5), bass: 9 }, sharpSpell)).toBe("F/A");
    expect(chordSymbol({ ...C("dim", [{ kind: "ext", value: 7 }], 4), bass: 10 }, flatSpell)).toBe("Em7♭5/B♭");
    expect(chordSymbol(C("maj", [{ kind: "ext", value: "maj7" }]), sharpSpell)).toBe("Cmaj7");
    expect(chordSymbol(C("maj", [{ kind: "ext", value: 6 }, { kind: "ext", value: 9 }]), sharpSpell)).toBe("C6/9");
    expect(chordSymbol(C("maj", [{ kind: "add", value: 9 }]), sharpSpell)).toBe("Cadd9");
    expect(chordSymbol(C("m", [{ kind: "sus", value: 4 }], 9), sharpSpell)).toBe("Asus4");
    expect(chordSymbol(C("m", [{ kind: "ext", value: "maj7" }]), sharpSpell)).toBe("Cm(maj7)");
  });

  it("intervalos", () => {
    expect(chordIntervals(C("maj", [{ kind: "ext", value: 9 }]))).toEqual([0, 4, 7, 10, 14]);
    expect(chordIntervals(C("maj", [{ kind: "sus", value: 4 }]))).toEqual([0, 5, 7]);
    expect(chordIntervals(C("maj", [{ kind: "ext", value: 9 }, { kind: "alt", value: "b9" }]))).toEqual([0, 4, 7, 10, 13]);
    expect(chordIntervals(C("dim", [{ kind: "ext", value: 6 }]))).toEqual([0, 3, 6, 9]);
    expect(chordIntervals(C("maj", [{ kind: "ext", value: 6 }, { kind: "ext", value: 9 }]))).toEqual([0, 4, 7, 9, 14]);
  });

  it("conflitos: 7 × maj7, sus2 × sus4, ♭5 × ♯5, add9 × 9", () => {
    let mods = toggleModifier([], { kind: "ext", value: 7 });
    mods = toggleModifier(mods, { kind: "ext", value: "maj7" });
    expect(mods).toEqual([{ kind: "ext", value: "maj7" }]);
    mods = toggleModifier([{ kind: "sus", value: 2 }], { kind: "sus", value: 4 });
    expect(mods).toEqual([{ kind: "sus", value: 4 }]);
    mods = toggleModifier([{ kind: "alt", value: "b5" }], { kind: "alt", value: "#5" });
    expect(mods).toEqual([{ kind: "alt", value: "#5" }]);
    mods = toggleModifier([{ kind: "add", value: 9 }], { kind: "ext", value: 9 });
    expect(mods).toEqual([{ kind: "ext", value: 9 }]);
    mods = toggleModifier(mods, { kind: "ext", value: 9 });
    expect(mods).toEqual([]);
  });

  it("status das notas: diatônica, tensão, fora", () => {
    const ctx = scaleContext(9, "harmonic-minor"); // Lá menor harmônica
    const e7b9 = C("maj", [{ kind: "ext", value: 7 }, { kind: "alt", value: "b9" }], 4);
    const r = resolveChord(e7b9, ctx, sharpSpell);
    expect(r.status.every((s) => s === "diatonic")).toBe(true);

    const cMaj = scaleContext(0, "major");
    const cmaj7 = C("maj", [{ kind: "ext", value: "maj7" }]);
    expect(modifierStatus(cmaj7, { kind: "alt", value: "#11" }, cMaj)).toBe("tension");
    expect(modifierStatus(cmaj7, { kind: "ext", value: 9 }, cMaj)).toBe("diatonic");
    expect(modifierStatus(C("maj"), { kind: "alt", value: "b9" }, cMaj)).toBe("outside");
    expect(modifierStatus(C("maj", [], 7), { kind: "ext", value: 7 }, cMaj)).toBe("diatonic");
  });

  it("inversões", () => {
    const c7 = C("maj", [{ kind: "ext", value: 7 }]);
    expect(inversionBass(c7, 1)).toBe(4);
    expect(inversionBass(c7, 2)).toBe(7);
    expect(inversionBass(c7, 3)).toBe(10);
    expect(inversionBass(c7, 4)).toBeUndefined();
  });
});

describe("voicing", () => {
  it("inversão coloca o baixo embaixo", () => {
    const notes = voiceChord({ ...makeChord(0, "maj"), bass: 4 });
    expect(mod12(notes[0])).toBe(4);
    expect([...new Set(notes.map(mod12))].sort()).toEqual([0, 4, 7]);
  });
  it("baixo livre adiciona nota abaixo", () => {
    const notes = voiceChord({ ...makeChord(0, "maj"), bass: 2 });
    expect(notes.length).toBe(4);
    expect(mod12(notes[0])).toBe(2);
  });
  it("baixo separado e estrutura superior entre F3 e E4", () => {
    const c7 = voiceChord({ ...makeChord(0, "maj"), modifiers: [{ kind: "ext", value: 7 }] });
    expect(c7).toEqual([36, 60, 64, 67, 70]);
    const f = voiceChord(makeChord(5, "maj"));
    expect(f).toEqual([41, 53, 57, 60]);
  });
  it("tessitura", () => {
    const { notes } = fitToRange([36, 48, 90], [55, 80]);
    expect(notes.every((n) => n >= 55 && n <= 80)).toBe(true);
  });
});

describe("tempo e arranjo (§3.8)", () => {
  it("posições e compassos incompletos", () => {
    expect(formatPosition(9, [4, 4])).toBe("3.2");
    expect(formatPosition(7, [7, 8])).toBe("2.1");
    expect(missingBeats(14, [4, 4])).toBe(2);
    expect(missingBeats(12, [6, 8])).toBe(0);
  });

  it("expandArrangement desenrola repetições e blocos vinculados com overrides", () => {
    const song = makeSong();
    const a = song.blocks[song.arrangement[0].blockId];
    a.chords = [makeChord(0, "maj", 4), makeChord(7, "maj", 4)];
    const b = makeBlock("Refrão", 1, [makeChord(5, "maj", 6)]);
    b.bpm = 120;
    b.meter = [6, 8];
    song.blocks[b.id] = b;
    song.arrangement[0].repeat = 2;
    song.arrangement.push({ id: "x", blockId: b.id, repeat: 1 }, { id: "y", blockId: a.id, repeat: 1 });

    const ex = expandArrangement(song);
    expect(ex.events.map((e) => e.chord.root)).toEqual([0, 7, 0, 7, 5, 0, 7]);
    expect(ex.events[4].startSec).toBeCloseTo(16 * (60 / 90));
    expect(ex.events[4].durationSec).toBeCloseTo(6 * 0.5);
    expect(ex.tempoMap.map((t) => t.bpm)).toEqual([90, 120, 90]);
    expect(ex.markers.map((m) => m.startBar)).toEqual([0, 4, 5]);
    expect(ex.totalBars).toBe(7);
  });

  it("export de texto por seção", () => {
    const song = makeSong();
    const a = song.blocks[song.arrangement[0].blockId];
    a.chords = [
      { ...makeChord(2, "m", 4), modifiers: [{ kind: "ext", value: 7 }] },
      { ...makeChord(7, "maj", 4), modifiers: [{ kind: "ext", value: 7 }] },
      { ...makeChord(0, "maj", 8), modifiers: [{ kind: "ext", value: "maj7" }] },
    ];
    song.arrangement[0].repeat = 2;
    expect(songToText(song, sharpSpell)).toBe("[Verso A ×2]  4/4 ♩=90\n| Dm7 | G7 | Cmaj7 | % |");
  });
});
