import { describe, expect, it, vi } from "vitest";
import {
  AIServerError,
  buildGenerationRequest,
  chordsToNoteEvents,
  createMusicAIClient,
  generationResultToBlockPatch,
  parseChordSymbol,
  planToChords,
  type GenerationResult,
} from "./client";
import { makeChord } from "../core/chords";
import { scaleContext } from "../core/diatonic";
import { makeMelodyNote } from "../core/melody";
import { makeBlock, makeSong } from "../core/song";

describe("parseChordSymbol", () => {
  it("interpreta cifras comuns, extensões, alterações, baixo invertido e N.C.", () => {
    expect(parseChordSymbol("C")).toEqual({ root: 0, quality: "maj", modifiers: [] });
    expect(parseChordSymbol("Am7")).toEqual({
      root: 9,
      quality: "m",
      modifiers: [{ kind: "ext", value: 7 }],
    });
    expect(parseChordSymbol("Cmaj7")).toEqual({
      root: 0,
      quality: "maj",
      modifiers: [{ kind: "ext", value: "maj7" }],
    });
    expect(parseChordSymbol("F#m7b5")).toEqual({
      root: 6,
      quality: "dim",
      modifiers: [{ kind: "ext", value: 7 }],
    });
    expect(parseChordSymbol("B♭maj7")).toEqual({
      root: 10,
      quality: "maj",
      modifiers: [{ kind: "ext", value: "maj7" }],
    });
    expect(parseChordSymbol("G/B")).toEqual({
      root: 7,
      quality: "maj",
      modifiers: [],
      bass: 11,
    });
    expect(parseChordSymbol("D°7")).toEqual({
      root: 2,
      quality: "dim",
      modifiers: [{ kind: "ext", value: 6 }],
    });
    expect(parseChordSymbol("Esus4")).toEqual({
      root: 4,
      quality: "sus4",
      modifiers: [],
    });
    expect(parseChordSymbol("N.C.")).toEqual({
      root: 0,
      quality: "maj",
      modifiers: [],
      rest: true,
    });
  });
});

describe("buildGenerationRequest", () => {
  it("monta payload estrito para harmonização de melodia com Camelot sincronizado", () => {
    const song = makeSong();
    song.bpm = 112;
    const block = makeBlock("Verso", 0);
    block.melody = [makeMelodyNote(69, 0, 1, 0.8), makeMelodyNote(72, 1, 1, 0.75)];

    const req = buildGenerationRequest({
      block,
      song,
      tonic: 9,
      scaleId: "minor",
      options: {
        mode: "harmonize",
        modelName: "expressive_medium",
        genre: "pop",
        stylePrompt: "Emotional synth pop",
        bars: 4,
        density: 6,
        polyphony: 4,
        noteDuration: 0.65,
        temperature: 1.0,
        useVelocity: true,
        useMicrotiming: false,
      },
    });

    expect(req.camelot_key).toBe("8A");
    expect(req.tonic_pc).toBe(9);
    expect(req.scale_id).toBe("minor");
    expect(req.bpm).toBe(112);
    expect(req.target_tracks).toEqual(["chords", "bass"]);
    expect(req.generate_melody).toBe(false);
    expect(req.inpaint_range).toBeNull();
    expect(req.input_tracks).toHaveLength(1);
    expect(req.input_tracks[0].role).toBe("melody");
    expect(req.input_tracks[0].notes).toHaveLength(2);
    expect(req.use_velocity).toBe(true);
    expect(req.use_microtiming).toBe(false);
  });

  it("monta payload para geração de melodia com acordes e cifras por compasso", () => {
    const song = makeSong();
    const block = makeBlock("Refrão", 1, [
      makeChord(0, "maj", 4),
      makeChord(7, "maj", 4),
    ]);

    const req = buildGenerationRequest({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: {
        mode: "melody",
        modelName: "yellow_small",
        genre: "rock",
        stylePrompt: "Anthem chorus",
        bars: 4,
        density: 7,
        polyphony: 3,
        noteDuration: 0.5,
        temperature: 1.1,
        useVelocity: true,
        useMicrotiming: true,
      },
    });

    expect(req.camelot_key).toBe("8B");
    expect(req.target_tracks).toEqual(["melody"]);
    expect(req.generate_melody).toBe(true);
    expect(req.input_tracks).toHaveLength(1);
    expect(req.input_tracks[0].role).toBe("chords");
    expect(req.input_tracks[0].chord_symbols).toEqual(["C", "G", "G", "G"]);
    expect(req.input_tracks[0].notes.length).toBeGreaterThanOrEqual(6);
  });

  it("monta payload para inpainting com intervalo 0-indexed", () => {
    const song = makeSong();
    const block = makeBlock("Ponte", 2, [
      makeChord(2, "m", 4),
      makeChord(7, "maj", 4),
      makeChord(0, "maj", 4),
      makeChord(9, "m", 4),
    ]);
    block.melody = [makeMelodyNote(62, 0, 2)];

    const req = buildGenerationRequest({
      block,
      song,
      tonic: 0,
      scaleId: "major",
      options: {
        mode: "inpaint",
        modelName: "prism_medium",
        genre: "jazz",
        stylePrompt: "II-V-I bridge",
        bars: 4,
        density: 5,
        polyphony: 4,
        noteDuration: 0.7,
        temperature: 0.9,
        useVelocity: true,
        useMicrotiming: true,
        inpaintRange: { startBar: 1, endBar: 3, roles: ["chords", "melody"] },
      },
    });

    expect(req.inpaint_range).toEqual({
      start_bar: 1,
      end_bar: 3,
      roles: ["chords", "melody"],
    });
    expect(req.input_tracks).toHaveLength(2);
    expect(chordsToNoteEvents(block.chords, song.meter).length).toBe(12);
  });
});

describe("generationResultToBlockPatch", () => {
  it("converte notas de tríade via noteEventsToChords e usa chord_symbols/plan como fallback sem tríade", () => {
    const result: GenerationResult = {
      success: true,
      message: "ok",
      bpm: 120,
      time_signature: [4, 4],
      camelot_key: "8B",
      tracks: [
        {
          role: "chords",
          program: 0,
          name: "Chords (AI)",
          notes: [
            // Compasso 0: tríade completa de C (C4, E4, G4)
            { pitch: 60, start_tick: 0, end_tick: 1920, velocity: 85 },
            { pitch: 64, start_tick: 0, end_tick: 1920, velocity: 85 },
            { pitch: 67, start_tick: 0, end_tick: 1920, velocity: 85 },
            // Compasso 1: apenas 1 nota (sem tríade -> deve cair no chord_symbols "Am7")
            { pitch: 57, start_tick: 1920, end_tick: 3840, velocity: 80 },
            // Compasso 2: vazio (sem notas -> deve cair no theoretical_plan "Fmaj7")
          ],
          chord_symbols: [
            { symbol: "C", root_pc: 0, quality: "major", start_tick: 0, end_tick: 1920 },
            { symbol: "Am7", root_pc: 9, quality: "minor7", start_tick: 1920, end_tick: 3840 },
          ],
        },
        {
          role: "bass",
          program: 33,
          name: "Bass (AI)",
          notes: [{ pitch: 36, start_tick: 0, end_tick: 960, velocity: 90 }],
          chord_symbols: [],
        },
        {
          role: "melody",
          program: 0,
          name: "Melody (AI)",
          notes: [
            { pitch: 72, start_tick: 0, end_tick: 480, velocity: 100 },
            { pitch: 74, start_tick: 480, end_tick: 960, velocity: 95 },
          ],
          chord_symbols: [],
        },
      ],
      theoretical_plan: {
        camelot_key: "8B",
        tonic_pc: 0,
        tonic_name: "C",
        scale_id: "major",
        scale_pitches: [0, 2, 4, 5, 7, 9, 11],
        genre: "pop",
        total_bars: 4,
        chord_progression_per_bar: ["C", "Am7", "Fmaj7", "G7"],
        voice_leading_style: "drop2",
        groove_style: "straight",
        target_roles_order: ["chords", "bass", "melody"],
        primer_python_code: "def build_primer(): ...",
        theoretical_explanation: "I - vi7 - IVmaj7 - V7",
      },
      validation_report: {
        is_valid: true,
        scale_adherence: 1,
        voice_leading_score: 0.92,
        out_of_scale_bars: [],
        warnings: [],
      },
      primer_midi_b64: null,
      generation_time_sec: 1.2,
      vram_used_mb: 0,
      model_used: "expressive_medium",
    };

    const patch = generationResultToBlockPatch(result, {
      mode: "full",
      meter: [4, 4],
      scaleCtx: scaleContext(0, "major"),
      syncKey: true,
    });

    expect(patch.chords).toHaveLength(4);
    expect(patch.chords![0]).toMatchObject({ root: 0, quality: "maj" });
    expect(patch.chords![1]).toMatchObject({ root: 9, quality: "m", modifiers: [{ kind: "ext", value: 7 }] });
    expect(patch.chords![2]).toMatchObject({ root: 5, quality: "maj", modifiers: [{ kind: "ext", value: "maj7" }] });
    expect(patch.chords![3]).toMatchObject({ root: 7, quality: "maj", modifiers: [{ kind: "ext", value: 7 }] });

    expect(patch.melody).toHaveLength(2);
    expect(patch.melody![0]).toMatchObject({ pitch: 72, start: 0, duration: 1 });
    expect(patch.melody![1]).toMatchObject({ pitch: 74, start: 1, duration: 1 });
    expect(patch.bassInstrument).toBe("contrabass-pizz");
    expect(patch.tonic).toBe(0);
    expect(patch.scaleId).toBe("major");
  });

  it("converte plano teórico em acordes mesmo sem geração neural", () => {
    const chords = planToChords(
      {
        camelot_key: "8A",
        tonic_pc: 9,
        tonic_name: "A",
        scale_id: "minor",
        scale_pitches: [9, 11, 0, 2, 4, 5, 7],
        genre: "pop",
        total_bars: 4,
        chord_progression_per_bar: ["Am", "F", "C", "G"],
        voice_leading_style: "close",
        groove_style: "straight",
        target_roles_order: ["chords"],
        primer_python_code: "",
        theoretical_explanation: "",
      },
      [4, 4],
    );
    expect(chords.map((c) => [c.root, c.quality])).toEqual([
      [9, "m"],
      [5, "maj"],
      [0, "maj"],
      [7, "maj"],
    ]);
  });
});

describe("createMusicAIClient", () => {
  it("consulta /health, /plan, /generate, /inpaint e trata erros HTTP e offline", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "ok",
            model_loaded: true,
            default_model: "expressive_medium",
            available_models: ["expressive_medium", "yellow_small"],
            skill_loaded: true,
            device: "cpu",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Campo inválido" }), { status: 422 }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const client = createMusicAIClient("http://127.0.0.1:8765", fetchMock);
    const health = await client.checkHealth();
    expect(health.status).toBe("ok");
    expect(health.available_models).toContain("expressive_medium");

    const req = buildGenerationRequest({
      block: makeBlock("A", 0),
      song: makeSong(),
      tonic: 0,
      scaleId: "major",
      options: {
        mode: "full",
        modelName: "expressive_medium",
        genre: "pop",
        stylePrompt: "Pop",
        density: 5,
        polyphony: 4,
        noteDuration: 0.6,
        temperature: 1.0,
        useVelocity: true,
        useMicrotiming: true,
      },
    });

    await expect(client.createPlan(req)).rejects.toThrow(AIServerError);
    await expect(client.generate(req)).rejects.toThrow(/Servidor IA local indisponível/);
  });
});
