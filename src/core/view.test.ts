import { describe, expect, it } from "vitest";
import { makeChord } from "./chords";
import { scaleContext } from "./diatonic";
import { resolveChord } from "./modifiers";
import { makeSpeller } from "./pitch";
import { getScale } from "./scales";
import { makeBlock, makeSong } from "./song";
import {
  arrangementLayout,
  blockUsage,
  chordNoteList,
  chordRole,
  chordStarts,
  currentInversion,
  droppedByChord,
  extraQualities,
  hoverChordInfo,
  keyLabel,
  midiStatus,
  previewChordNotes,
  relativeTonic,
  rulerMarks,
  scalePreviewNotes,
  scalePreviewText,
  sliceClickable,
  sliceState,
  voicedInRange,
  wheelCounts,
  wheelSlices,
} from "./view";

const major = getScale("major");
const dorian = getScale("dorian");
const ctxC = scaleContext(0, "major");

describe("escala", () => {
  it("Ré dórico -> Dó jônio (e de volta)", () => {
    expect(relativeTonic(2, dorian, major)).toBe(0);
    expect(relativeTonic(0, major, dorian)).toBe(2);
    expect(relativeTonic(9, getScale("phrygian"), dorian)).toBe(7);
  });

  it("preview começa em 60 + tônica e fecha a oitava", () => {
    expect(scalePreviewNotes(0, major)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(scalePreviewNotes(7, major)[0]).toBe(67);
    expect(scalePreviewNotes(7, major).at(-1)).toBe(79);
  });

  it("fórmula e notas do preview", () => {
    expect(scalePreviewText(2, dorian, "auto")).toEqual({ formula: "1 2 ♭3 4 5 6 ♭7", notes: "D E F G A B C" });
  });
});

describe("roda", () => {
  it("fatias: pos 1 -> Sol (maior), Mi (menor), Fá♯ (dim)", () => {
    const s = wheelSlices(ctxC, "colorful");
    expect(s[0][1].root).toBe(7);
    expect(s[1][1].root).toBe(4);
    expect(s[2][1].root).toBe(6);
    expect(s[0][5].root).toBe(11); // 5·7 mod 12 -> Si
  });

  it("estados em Dó maior", () => {
    expect(sliceState(null, 0, "maj")).toBe("explore");
    expect(sliceState(ctxC, 0, "maj")).toBe("diatonic");
    expect(sliceState(ctxC, 2, "maj")).toBe("chromatic"); // V/ii
    expect(sliceState(ctxC, 4, "maj")).toBe("chromatic"); // V/vi
    expect(sliceState(ctxC, 2, "aug")).not.toBe("diatonic");
    expect(sliceState(ctxC, 1, "maj")).toBe("chromatic"); // subV
    expect(sliceState(ctxC, 6, "maj")).toBe("out");
    const s = wheelSlices(ctxC, "free");
    const fsharp = s[0].find((x) => x.root === 6)!;
    expect(fsharp.state).toBe("out");
    expect(fsharp.icon).toBe("⚠");
    expect(s[0][0].roman).toBe("I");
    expect(s[1][1].roman).toBe("iii");
  });

  it("clicável por modo", () => {
    expect(sliceClickable("chromatic", "strict")).toBe(false);
    expect(sliceClickable("chromatic", "colorful")).toBe(true);
    expect(sliceClickable("out", "colorful")).toBe(false);
    expect(sliceClickable("out", "free")).toBe(true);
  });

  it("contagem de acordes liberados em Dó maior", () => {
    const { diatonic, chromatic } = wheelCounts(ctxC);
    expect(diatonic).toBe(7);
    expect(chromatic).toBeGreaterThan(0);
    const total = wheelSlices(ctxC, "colorful").flat().filter((x) => x.state === "diatonic").length;
    expect(total).toBe(diatonic);
    expect(wheelSlices(ctxC, "colorful").flat().filter((x) => x.state === "chromatic").length).toBe(chromatic);
  });

  it("hover: notas e comuns com o acorde anterior", () => {
    const info = hoverChordInfo(ctxC, { root: 7, quality: "maj" }, makeChord(0, "maj"));
    expect(info.pcs).toEqual([7, 11, 2]);
    expect(info.shared).toEqual([7]);
    expect(info.roman).toBe("V");
    expect(hoverChordInfo(null, { root: 7, quality: "maj" }, null)).toMatchObject({ roman: "", shared: null });
  });

  it("qualidades extras do badge", () => {
    for (const d of ctxC.degrees) {
      const ex = extraQualities(d);
      expect(ex.every((q) => ["aug", "sus4", "sus2", "5"].includes(q))).toBe(true);
      if (d.qualities.includes("maj") || d.qualities.includes("m") || d.qualities.includes("dim")) expect(ex).not.toContain("5");
    }
  });
});

describe("painel de modificadores", () => {
  it("inversão: 1ª de Dó maior tem baixo Mi; 2ª tem Sol; slash fora = -1", () => {
    const c = makeChord(0, "maj");
    expect(currentInversion(c, 3)).toBe(0);
    expect(currentInversion({ ...c, bass: 4 }, 3)).toBe(1);
    expect(currentInversion({ ...c, bass: 7 }, 3)).toBe(2);
    expect(currentInversion({ ...c, bass: 2 }, 3)).toBe(-1);
    expect(currentInversion({ ...c, bass: 7 }, 2)).toBe(-1);
  });

  it("voicing ajustado à tessitura e notas omitidas", () => {
    const c = makeChord(0, "maj");
    const wide = voicedInRange(c, [0, 127]);
    expect(wide.dropped).toBe(0);
    expect(wide.notes).toEqual([36, 60, 64, 67]);
    const narrow = voicedInRange(c, [60, 62]);
    expect(narrow.notes).toEqual([60]);
    expect(narrow.dropped).toBe(2);
  });

  it("lista de notas com status e baixo fora do acorde", () => {
    const spell = makeSpeller(0, ctxC.pcs, "auto");
    const c = { ...makeChord(0, "maj"), bass: 2 };
    const r = resolveChord(c, ctxC, spell);
    const l = chordNoteList(c, r);
    expect(l.notes.map((n) => n.pc)).toEqual([0, 4, 7]);
    expect(l.extraBass).toBe(2);
    expect(chordNoteList({ ...c, bass: 4 }, r).extraBass).toBeNull();
    expect(chordNoteList(makeChord(0, "maj"), r).extraBass).toBeNull();
    expect(midiStatus(r, 64)).toBe("diatonic");
  });
});

describe("preview de instrumento", () => {
  it("sem acorde selecionado usa a tônica com a qualidade do 1º grau", () => {
    const ctxA = scaleContext(9, "minor");
    const notes = previewChordNotes(null, 9, ctxA);
    expect(notes).toEqual([45, 57, 60, 64]); // Lá menor
    expect(previewChordNotes(null, null, null)[0]).toBe(36);
    const sel = makeChord(7, "maj");
    expect(previewChordNotes(sel, 0, ctxC)[0]).toBe(36 + 7);
  });
});

describe("progressão", () => {
  it("posições iniciais em tempos", () => {
    expect(chordStarts([{ duration: 4 }, { duration: 2 }, { duration: 1.5 }])).toEqual([0, 4, 6]);
    expect(chordStarts([])).toEqual([]);
  });

  it("notas fora da tessitura por acorde", () => {
    const a = makeChord(0, "maj");
    const b = makeChord(7, "maj");
    const m = droppedByChord([a, b], [0, 127]);
    expect(m.get(a.id)).toBe(0);
    expect(droppedByChord([a], [60, 62]).get(a.id)).toBe(2);
  });

  it("papel do acorde", () => {
    expect(chordRole(null, makeChord(1, "maj"))).toEqual({ inScale: true, chromatic: null, roman: "" });
    expect(chordRole(ctxC, makeChord(7, "maj"))).toMatchObject({ inScale: true, roman: "V" });
    const sec = chordRole(ctxC, makeChord(2, "maj"));
    expect(sec.inScale).toBe(false);
    expect(sec.chromatic?.kind).toBe("secondary");
    // ♭II maior é o subV; Fá♯ maior continua sem função em Dó maior.
    expect(chordRole(ctxC, makeChord(1, "maj")).chromatic?.kind).toBe("subV");
    expect(chordRole(ctxC, makeChord(6, "maj")).chromatic).toBeNull();
  });

  it("régua: marcas por tempo e número do compasso", () => {
    expect(rulerMarks(0, 4, 4).map((m) => ({ ...m, at: m.at + 0 }))).toEqual([
      { at: 0, bar: 1 },
      { at: 1, bar: null },
      { at: 2, bar: null },
      { at: 3, bar: null },
    ]);
    expect(rulerMarks(2, 4, 4).map((m) => m.bar)).toEqual([null, null, 2, null]);
    expect(rulerMarks(2.5, 2, 4).map((m) => m.at)).toEqual([0.5, 1.5]);
    expect(rulerMarks(0, 32, 4).map((m) => m.at + 0)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });
});

describe("arranjo", () => {
  it("compassos e início de duas instâncias com repetição", () => {
    const song = makeSong();
    const b1 = song.blocks[song.arrangement[0].blockId];
    b1.chords = [makeChord(0, "maj", 4), makeChord(5, "maj", 4)]; // 8 tempos = 2 compassos em 4/4
    song.arrangement[0].repeat = 2;
    const b2 = makeBlock("B", 1, [makeChord(7, "maj", 6)]);
    b2.meter = [3, 4]; // 6 tempos = 2 compassos
    song.blocks[b2.id] = b2;
    song.arrangement.push({ id: "x2", blockId: b2.id, repeat: 3 });
    song.arrangement.push({ id: "x3", blockId: b1.id, repeat: 1 });
    const { entries, end } = arrangementLayout(song);
    expect(entries.map((e) => e.bars)).toEqual([4, 6, 2]);
    expect(entries.map((e) => e.start)).toEqual([1, 5, 11]);
    expect(end).toBe(13);
    expect(blockUsage(song).get(b1.id)).toBe(2);
    expect(blockUsage(song).get(b2.id)).toBe(1);
  });

  it("arranjo vazio termina no compasso 1", () => {
    const song = makeSong();
    song.arrangement = [];
    expect(arrangementLayout(song)).toEqual({ entries: [], end: 1 });
  });
});

describe("keyLabel", () => {
  it("tônica grafada pela escala + nome curto", () => {
    expect(keyLabel(4, "dorian", "auto")).toBe("E Dórico");
    expect(keyLabel(0, "major", "auto")).toBe("C Jônio");
  });
  it("bemóis quando a escala pede e sem tônica devolve o nome completo", () => {
    expect(keyLabel(5, "major", "auto")).toBe("F Jônio");
    expect(keyLabel(10, "major", "auto")).toBe("B♭ Jônio");
    expect(keyLabel(null, "major", "auto")).toBe("Jônio (Maior)");
  });
});
