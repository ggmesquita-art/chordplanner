import { describe, expect, it } from "vitest";
import { isRest, makeChord, makeRest } from "./chords";
import { scaleContext } from "./diatonic";
import { autoHarmonize, beatWeight, chordAtBeat, melodyNoteRelation, melodyTargetSpan, scoreChordsForMelody } from "./harmonize";
import { makeMelodyNote } from "./melody";

const C_MAJ = scaleContext(0, "major");

describe("chordAtBeat e melodyNoteRelation", () => {
  it("localiza acorde no tempo certo e trata N.C. / fora do intervalo", () => {
    const chords = [makeChord(0, "maj", 2), makeRest(2), makeChord(7, "maj", 2)];
    expect(chordAtBeat(chords, 0)?.index).toBe(0);
    expect(chordAtBeat(chords, 1.5)?.index).toBe(0);
    expect(chordAtBeat(chords, 2)?.chord.rest).toBe(true);
    expect(chordAtBeat(chords, 4.5)?.chord.root).toBe(7);
    expect(chordAtBeat(chords, 6)).toBeNull();
    expect(chordAtBeat(chords, -0.5)).toBeNull();
  });

  it("classifica nota do acorde, tensão compatível, avoid note / fora da escala e N.C.", () => {
    const c = makeChord(0, "maj", 4);
    const dm = makeChord(2, "m", 4);
    expect(melodyNoteRelation(64, c, C_MAJ)).toBe("chord-tone"); // E
    expect(melodyNoteRelation(62, c, C_MAJ)).toBe("tension"); // D (9ª)
    expect(melodyNoteRelation(71, c, C_MAJ)).toBe("tension"); // B (maj7)
    expect(melodyNoteRelation(65, c, C_MAJ)).toBe("passing"); // F (4ª justa avoid sobre tríade maior)
    expect(melodyNoteRelation(66, c, C_MAJ)).toBe("passing"); // F# (fora da escala de C)
    expect(melodyNoteRelation(67, dm, C_MAJ)).toBe("tension"); // G (11ª de Dm)
    expect(melodyNoteRelation(60, makeRest(4), C_MAJ)).toBe("nc");
    expect(melodyNoteRelation(60, null, C_MAJ)).toBe("nc");
  });
});

describe("peso métrico, janela alvo e scoreChordsForMelody", () => {
  it("beatWeight dá maior peso à cabeça do compasso e meio de 4/4", () => {
    expect(beatWeight(0, [4, 4])).toBe(3.0);
    expect(beatWeight(2, [4, 4])).toBe(2.0);
    expect(beatWeight(1, [4, 4])).toBe(1.5);
    expect(beatWeight(0.5, [4, 4])).toBe(0.75);
    expect(beatWeight(3, [6, 8])).toBe(2.0);
  });

  it("melodyTargetSpan seleciona acorde atual, nota selecionada ou trecho à frente", () => {
    const c1 = makeChord(0, "maj", 2);
    const mel = [makeMelodyNote(64, 0, 1), makeMelodyNote(69, 3.25, 0.5)];
    expect(melodyTargetSpan([], null, [], null, 1)).toBeNull();
    expect(melodyTargetSpan([c1], c1.id, mel, null, 1)).toEqual([0, 2]);
    expect(melodyTargetSpan([c1], null, mel, mel[1].id, 0.5)).toEqual([3, 3.5]);
    expect(melodyTargetSpan([c1], null, mel, null, 1)).toEqual([2, 3]);
  });

  it("scoreChordsForMelody prioriza o acorde apoiado pelas notas em tempo forte", () => {
    // Tempo 1 (peso 3): C4 (1s); tempo 2 (peso 1.5): E4; contratempo: D4 (nota de passagem curta).
    const mel = [makeMelodyNote(60, 0, 1), makeMelodyNote(64, 1, 1), makeMelodyNote(62, 1.5, 0.5)];
    const ranked = scoreChordsForMelody(mel, [0, 4], C_MAJ, [4, 4], "strict");
    expect(ranked[0]).toMatchObject({ root: 0, quality: "maj" });
  });
});

describe("autoHarmonize", () => {
  it("harmoniza melodia em Dó maior preservando coerência funcional e silêncio inicial como N.C.", () => {
    // Compasso 1 silencioso; c2 (4..8): G e B (pede G); c3 (8..12): C e E (pede C).
    const mel = [
      makeMelodyNote(67, 4, 2),
      makeMelodyNote(71, 6, 2),
      makeMelodyNote(60, 8, 2),
      makeMelodyNote(64, 10, 2),
    ];
    const chords = autoHarmonize({ melody: mel, ctx: C_MAJ, meter: [4, 4], stepBeats: 4, mode: "replace" });
    expect(chords).toHaveLength(3);
    expect(isRest(chords[0])).toBe(true);
    expect(chords[0].duration).toBe(4);
    expect(chords[1]).toMatchObject({ root: 7, quality: "maj", duration: 4 });
    expect(chords[2]).toMatchObject({ root: 0, quality: "maj", duration: 4 });
  });

  it("modo fill mantém acordes existentes, preenche N.C. com melodia e completa trecho restante", () => {
    const existing = [makeChord(5, "maj", 4), makeRest(4)];
    const mel = [
      makeMelodyNote(65, 0, 2),
      makeMelodyNote(67, 4, 2),
      makeMelodyNote(71, 6, 2),
      makeMelodyNote(60, 8, 4),
    ];
    const chords = autoHarmonize({ melody: mel, ctx: C_MAJ, meter: [4, 4], stepBeats: 4, existingChords: existing, mode: "fill" });
    expect(chords).toHaveLength(3);
    expect(chords[0].id).toBe(existing[0].id);
    expect(chords[0]).toMatchObject({ root: 5, quality: "maj" });
    expect(chords[1]).toMatchObject({ root: 7, quality: "maj", duration: 4 });
    expect(chords[2]).toMatchObject({ root: 0, quality: "maj", duration: 4 });
  });
});
