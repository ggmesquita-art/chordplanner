import { describe, expect, it } from "vitest";
import {
  AI_GENRES,
  parseChordSymbol,
  planToChords,
  type AIGenerationOptions,
} from "./client";
import { buildOfflineSkillPlan, generateOfflineSkillPatch } from "./skillFallback";
import { isRest, makeChord } from "../core/chords";
import { scaleContext } from "../core/diatonic";
import { chordAtBeat } from "../core/harmonize";
import { MELODY_DEFAULT_HIGH, MELODY_DEFAULT_LOW, MELODY_EPS, makeMelodyNote } from "../core/melody";
import { chordIntervals } from "../core/modifiers";
import { mod12 } from "../core/pitch";
import { makeBlock, makeSong } from "../core/song";

function baseOptions(overrides: Partial<AIGenerationOptions> = {}): AIGenerationOptions {
  return {
    mode: "full",
    modelName: "expressive_medium",
    genre: "pop",
    stylePrompt: "Offline test",
    bars: 4,
    density: 5,
    polyphony: 4,
    noteDuration: 0.75,
    temperature: 0.8,
    useVelocity: true,
    useMicrotiming: false,
    seed: 42,
    ...overrides,
  };
}

describe("skillFallback — catálogo por gênero e modo", () => {
  it("gera progressões válidas e parseáveis para todos os 10 gêneros em maior e menor", () => {
    const song = makeSong();
    const block = makeBlock("Seção", 0);

    for (const genre of AI_GENRES) {
      for (const modeSpec of [
        { tonic: 2, scaleId: "major", expectedBars: 8 },
        { tonic: 9, scaleId: "minor", expectedBars: 12 },
      ]) {
        const plan = buildOfflineSkillPlan({
          block,
          song,
          tonic: modeSpec.tonic,
          scaleId: modeSpec.scaleId,
          options: baseOptions({ genre, mode: "full", bars: modeSpec.expectedBars }),
        });

        expect(plan.genre).toBe(genre);
        expect(plan.total_bars).toBe(modeSpec.expectedBars);
        expect(plan.chord_progression_per_bar).toHaveLength(modeSpec.expectedBars);
        expect(plan.primer_python_code).toBe("");
        expect(plan.theoretical_explanation).toContain("music-composition");
        expect(plan.theoretical_explanation.toLowerCase()).toContain("offline");

        if (genre === "jazz" || genre === "latin") {
          expect(plan.voice_leading_style).toBe("drop2");
        } else if (genre === "blues" || genre === "hip-hop") {
          expect(plan.voice_leading_style).toBe("shell");
        } else {
          expect(plan.voice_leading_style).toBe("close");
        }

        for (const sym of plan.chord_progression_per_bar) {
          expect(parseChordSymbol(sym)).not.toBeNull();
        }
        const chords = planToChords(plan, song.meter);
        expect(chords).toHaveLength(modeSpec.expectedBars);
      }
    }
  });

  it("respeita block.key sobre a tonalidade global e preenche tonic/scaleId quando tonic === null", () => {
    const song = makeSong();
    const modBlock = makeBlock("Modulação", 1);
    modBlock.key = { tonic: 5, scaleId: "minor" }; // Fm = 4A

    const modPlan = buildOfflineSkillPlan({
      block: modBlock,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({ mode: "full", genre: "pop", bars: 4 }),
    });
    expect(modPlan.tonic_pc).toBe(5);
    expect(modPlan.scale_id).toBe("minor");
    expect(modPlan.camelot_key).toBe("4A");

    const keylessBlock = makeBlock("Sem tom", 0);
    const { patch } = generateOfflineSkillPatch({
      block: keylessBlock,
      song,
      tonic: null,
      scaleId: "major",
      options: baseOptions({ mode: "full", bars: 4 }),
      melodyGridBeats: 0.25,
    });
    expect(patch.tonic).toBe(0);
    expect(patch.scaleId).toBe("major");
  });
});

describe("skillFallback — modo harmonize", () => {
  it("harmoniza uma melodia real existente no bloco via autoHarmonize", () => {
    const song = makeSong();
    const block = makeBlock("Melodia", 0);
    // Melodia em Dó maior: C5-E5 (c.0), F5-A5 (c.1), G5-B5 (c.2), C5 (c.3)
    block.melody = [
      makeMelodyNote(72, 0, 2, 0.85),
      makeMelodyNote(76, 2, 2, 0.8),
      makeMelodyNote(77, 4, 2, 0.85),
      makeMelodyNote(81, 6, 2, 0.8),
      makeMelodyNote(79, 8, 2, 0.9),
      makeMelodyNote(83, 10, 2, 0.85),
      makeMelodyNote(72, 12, 4, 0.9),
    ];

    const { plan, patch } = generateOfflineSkillPatch({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({ mode: "harmonize", genre: "pop", bars: 4 }),
      melodyGridBeats: 0.25,
    });

    expect(plan.chord_progression_per_bar).toHaveLength(4);
    expect(patch.chords).toBeDefined();
    expect(patch.chords!.some((c) => !isRest(c))).toBe(true);
    expect(patch.melody).toBeUndefined();
    expect(patch.bassInstrument).toBe("contrabass-pizz");

    // Verifica que os acordes gerados cobrem os 16 tempos da melodia e harmonizam com a tônica/dominante
    const totalBeats = patch.chords!.reduce((sum, c) => sum + c.duration, 0);
    expect(totalBeats).toBe(16);
    expect(patch.chords![0].root).toBe(0); // Compasso 0 (C-E) -> C
  });
});

describe("skillFallback — modo melody", () => {
  it("gera melodia monofônica na escala/acorde dentro de C4–C6 e preserva acordes existentes", () => {
    const song = makeSong();
    const block = makeBlock("Base", 0, [
      makeChord(0, "maj", 4),
      makeChord(9, "m", 4),
      makeChord(5, "maj", 4),
      makeChord(7, "maj", 4),
    ]);

    const { plan, patch } = generateOfflineSkillPatch({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({
        mode: "melody",
        genre: "jazz",
        bars: 4,
        density: 6,
        noteDuration: 0.75,
        useVelocity: true,
        seed: 123,
      }),
      melodyGridBeats: 0.5,
    });

    expect(plan.chord_progression_per_bar).toEqual(["C", "Am", "F", "G"]);
    expect(patch.chords).toBeUndefined();
    expect(patch.melody).toBeDefined();
    const melody = patch.melody!;
    expect(melody.length).toBeGreaterThan(0);

    const ctx = scaleContext(0, "major");
    for (let i = 0; i < melody.length; i++) {
      const note = melody[i];
      // Faixa C4–C6
      expect(note.pitch).toBeGreaterThanOrEqual(MELODY_DEFAULT_LOW);
      expect(note.pitch).toBeLessThanOrEqual(MELODY_DEFAULT_HIGH);
      // Quantização pela grade 0.5
      expect(Math.abs((note.start / 0.5) - Math.round(note.start / 0.5))).toBeLessThan(1e-6);
      expect(Math.abs((note.duration / 0.5) - Math.round(note.duration / 0.5))).toBeLessThan(1e-6);
      // Velocity dinâmica quando useVelocity=true
      expect(note.velocity).toBeDefined();
      expect(note.velocity!).toBeGreaterThanOrEqual(0.05);
      expect(note.velocity!).toBeLessThanOrEqual(1);

      // Monofônica (sem sobreposição)
      if (i > 0) {
        const prev = melody[i - 1];
        expect(prev.start + prev.duration).toBeLessThanOrEqual(note.start + MELODY_EPS);
      }

      // Nota pertence à escala ou ao acorde ativo
      const span = chordAtBeat(block.chords, note.start);
      const chordPcs = new Set(
        span && !isRest(span.chord)
          ? chordIntervals(span.chord).map((iv) => mod12(span.chord.root + iv))
          : [],
      );
      const pc = mod12(note.pitch);
      expect(ctx.pcSet.has(pc) || chordPcs.has(pc)).toBe(true);
    }
  });

  it("respeita controle de densidade (density baixa vs density alta) e useVelocity=false", () => {
    const song = makeSong();
    const block = makeBlock("Denso", 0, [
      makeChord(2, "m", 4),
      makeChord(7, "maj", 4),
      makeChord(0, "maj", 4),
      makeChord(9, "m", 4),
    ]);

    const sparse = generateOfflineSkillPatch({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({ mode: "melody", density: 1, useVelocity: false, seed: 7 }),
      melodyGridBeats: 0.25,
    });

    const dense = generateOfflineSkillPatch({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({ mode: "melody", density: 9, useVelocity: false, seed: 7 }),
      melodyGridBeats: 0.25,
    });

    expect(sparse.patch.melody!.length).toBeLessThan(dense.patch.melody!.length);
    for (const n of sparse.patch.melody!) {
      expect(n.velocity).toBeUndefined();
    }
  });
});

describe("skillFallback — modo full", () => {
  it("gera acordes, melodia e timbre de baixo adequado por gênero", () => {
    const song = makeSong();
    const block = makeBlock("Novo Bloco", 0);

    const { plan, patch } = generateOfflineSkillPatch({
      block,
      song,
      tonic: 4,
      scaleId: "minor",
      options: baseOptions({ mode: "full", genre: "classical", bars: 4 }),
      melodyGridBeats: 0.25,
    });

    expect(plan.chord_progression_per_bar).toHaveLength(4);
    expect(patch.chords).toHaveLength(4);
    expect(patch.melody!.length).toBeGreaterThan(0);
    expect(patch.bassInstrument).toBe("contrabass");

    // Não sobrescreve bassInstrument já definido no bloco
    const blockWithBass = makeBlock("Com baixo", 0);
    blockWithBass.bassInstrument = "piano";
    const second = generateOfflineSkillPatch({
      block: blockWithBass,
      song,
      tonic: 4,
      scaleId: "minor",
      options: baseOptions({ mode: "full", genre: "classical", bars: 4 }),
      melodyGridBeats: 0.25,
    });
    expect(second.patch.bassInstrument).toBeUndefined();
  });
});

describe("skillFallback — modo inpaint", () => {
  it("preserva acordes e notas melódicas fora de [startBar, endBar) e regenera apenas o alvo", () => {
    const song = makeSong();
    const c0 = makeChord(0, "maj", 4);
    const c1 = makeChord(5, "maj", 4);
    const c2 = makeChord(7, "maj", 4);
    const c3 = makeChord(0, "maj", 4);
    const block = makeBlock("Ponte", 2, [c0, c1, c2, c3]);

    const nBar0 = makeMelodyNote(72, 0.5, 1.5, 0.8);
    const nBar1 = makeMelodyNote(65, 4.0, 2.0, 0.7);
    const nBar2 = makeMelodyNote(67, 8.0, 2.0, 0.7);
    const nBar3 = makeMelodyNote(76, 13.0, 1.5, 0.9);
    block.melody = [nBar0, nBar1, nBar2, nBar3];

    const { patch } = generateOfflineSkillPatch({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({
        mode: "inpaint",
        genre: "jazz",
        bars: 4,
        density: 6,
        inpaintRange: { startBar: 1, endBar: 3, roles: ["chords", "melody"] },
      }),
      melodyGridBeats: 0.25,
    });

    // Acordes nos compassos 0 e 3 preservados; compassos 1 e 2 regenerados (jazz ii7-V7-Imaj7-vi7 -> V7, Imaj7)
    expect(patch.chords).toHaveLength(4);
    expect(patch.chords![0].id).toBe(c0.id);
    expect(patch.chords![0].root).toBe(0);
    expect(patch.chords![3].id).toBe(c3.id);
    expect(patch.chords![3].root).toBe(0);
    expect(patch.chords![1].id).not.toBe(c1.id);
    expect(patch.chords![2].id).not.toBe(c2.id);

    // Melodia nos compassos 0 e 3 preservada integralmente
    const melody = patch.melody!;
    expect(melody.find((n) => n.id === nBar0.id)).toEqual(nBar0);
    expect(melody.find((n) => n.id === nBar3.id)).toEqual(nBar3);
    // Notas antigas dos compassos 1..2 substituídas
    expect(melody.find((n) => n.id === nBar1.id)).toBeUndefined();
    expect(melody.find((n) => n.id === nBar2.id)).toBeUndefined();
    // Novas notas existem dentro de [4, 12)
    const inpaintedNotes = melody.filter((n) => n.start >= 4 - 1e-6 && n.start < 12 - 1e-6);
    expect(inpaintedNotes.length).toBeGreaterThan(0);
  });

  it("respeita inpaintRange.roles omitindo chords quando apenas melody foi selecionado", () => {
    const song = makeSong();
    const block = makeBlock("Só melodia", 0, [
      makeChord(0, "maj", 4),
      makeChord(5, "maj", 4),
      makeChord(7, "maj", 4),
      makeChord(0, "maj", 4),
    ]);
    const keepStart = makeMelodyNote(72, 0, 2);
    const keepEnd = makeMelodyNote(72, 12, 2);
    block.melody = [keepStart, makeMelodyNote(64, 5, 1), keepEnd];

    const { patch } = generateOfflineSkillPatch({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: baseOptions({
        mode: "inpaint",
        bars: 4,
        inpaintRange: { startBar: 1, endBar: 3, roles: ["melody"] },
      }),
      melodyGridBeats: 0.25,
    });

    expect(patch.chords).toBeUndefined();
    expect(patch.melody).toBeDefined();
    expect(patch.melody!.some((n) => n.id === keepStart.id)).toBe(true);
    expect(patch.melody!.some((n) => n.id === keepEnd.id)).toBe(true);
  });
});
