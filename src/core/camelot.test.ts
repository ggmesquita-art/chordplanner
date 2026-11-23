import { describe, expect, it } from "vitest";
import { makeChord, makeRest } from "./chords";
import { makeMelodyNote } from "./melody";
import {
  AI_PPQ,
  beatsToTicks,
  ticksToBeats,
  toCamelotCode,
  fromCamelotCode,
  camelotNeighbors,
  melodyToNoteEvents,
  noteEventsToMelody,
  chordsToSymbolList,
  noteEventsToChords,
  type CamelotCode,
  type AINoteEvent,
} from "./camelot";

describe("Camelot Wheel (24 chaves e modos)", () => {
  const allCodes: CamelotCode[] = [
    "1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A", "9A", "10A", "11A", "12A",
    "1B", "2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "10B", "11B", "12B",
  ];

  it("converte ida e volta para todas as 24 chaves da roda Camelot", () => {
    for (const code of allCodes) {
      const decoded = fromCamelotCode(code);
      const reencoded = toCamelotCode(decoded.tonic, decoded.scaleId);
      expect(reencoded).toBe(code);
    }
  });

  it("mapeia tônicas específicas para o código oficial", () => {
    // Menores (A)
    expect(toCamelotCode(8, "minor")).toBe("1A"); // Abm
    expect(toCamelotCode(3, "minor")).toBe("2A"); // Ebm
    expect(toCamelotCode(10, "minor")).toBe("3A"); // Bbm
    expect(toCamelotCode(5, "minor")).toBe("4A"); // Fm
    expect(toCamelotCode(0, "minor")).toBe("5A"); // Cm
    expect(toCamelotCode(7, "minor")).toBe("6A"); // Gm
    expect(toCamelotCode(2, "minor")).toBe("7A"); // Dm
    expect(toCamelotCode(9, "minor")).toBe("8A"); // Am
    expect(toCamelotCode(4, "minor")).toBe("9A"); // Em
    expect(toCamelotCode(11, "minor")).toBe("10A"); // Bm
    expect(toCamelotCode(6, "minor")).toBe("11A"); // F#m
    expect(toCamelotCode(1, "minor")).toBe("12A"); // C#m / Dbm

    // Maiores (B)
    expect(toCamelotCode(11, "major")).toBe("1B"); // B
    expect(toCamelotCode(6, "major")).toBe("2B"); // F#
    expect(toCamelotCode(1, "major")).toBe("3B"); // Db
    expect(toCamelotCode(8, "major")).toBe("4B"); // Ab
    expect(toCamelotCode(3, "major")).toBe("5B"); // Eb
    expect(toCamelotCode(10, "major")).toBe("6B"); // Bb
    expect(toCamelotCode(5, "major")).toBe("7B"); // F
    expect(toCamelotCode(0, "major")).toBe("8B"); // C
    expect(toCamelotCode(7, "major")).toBe("9B"); // G
    expect(toCamelotCode(2, "major")).toBe("10B"); // D
    expect(toCamelotCode(9, "major")).toBe("11B"); // A
    expect(toCamelotCode(4, "major")).toBe("12B"); // E
  });

  it("assume C (0) quando tonic é null", () => {
    expect(toCamelotCode(null, "major")).toBe("8B");
    expect(toCamelotCode(null, "minor")).toBe("5A");
  });

  it("classifica escalas modais corretamente: Dórico -> A, Lídio/Mixolídio -> B", () => {
    // D Dórico tem terça menor (F, pc 5) e não tem terça maior (F#, pc 6) -> modo "A"
    expect(toCamelotCode(2, "dorian")).toBe("7A");
    // F Lídio tem terça maior (A, pc 9) e não tem terça menor (Ab, pc 8) -> modo "B"
    expect(toCamelotCode(5, "lydian")).toBe("7B");
    // G Mixolídio tem terça maior (B, pc 11) e não tem terça menor (Bb, pc 10) -> modo "B"
    expect(toCamelotCode(7, "mixolydian")).toBe("9B");
  });

  it("calcula vizinhos harmônicos (relative, dominant, subdominant, parallel)", () => {
    const n8B = camelotNeighbors("8B"); // C Maior
    expect(n8B.relative).toBe("8A"); // A Menor
    expect(n8B.dominant).toBe("9B"); // G Maior (+1 hora)
    expect(n8B.subdominant).toBe("7B"); // F Maior (-1 hora)
    expect(n8B.parallel).toBe("5A"); // C Menor (homônimo)

    const n8A = camelotNeighbors("8A"); // A Menor
    expect(n8A.relative).toBe("8B"); // C Maior
    expect(n8A.dominant).toBe("9A"); // E Menor (+1 hora)
    expect(n8A.subdominant).toBe("7A"); // D Menor (-1 hora)
    expect(n8A.parallel).toBe("11B"); // A Maior (homônimo)

    // Wrapar limites da roda (12 e 1)
    const n12A = camelotNeighbors("12A");
    expect(n12A.dominant).toBe("1A");
    expect(n12A.subdominant).toBe("11A");
    expect(n12A.relative).toBe("12B");
    expect(n12A.parallel).toBe("3B");

    const n1B = camelotNeighbors("1B");
    expect(n1B.dominant).toBe("2B");
    expect(n1B.subdominant).toBe("12B");
    expect(n1B.relative).toBe("1A");
    expect(n1B.parallel).toBe("10A");
  });

  it("lança erro em código Camelot inválido", () => {
    expect(() => fromCamelotCode("13A" as CamelotCode)).toThrow();
    expect(() => fromCamelotCode("0B" as CamelotCode)).toThrow();
  });
});

describe("Conversão de Ticks e Compassos", () => {
  it("converte tempos e ticks com precisão em 4/4 e 6/8", () => {
    // 4/4: 1 tempo = 480 ticks
    expect(beatsToTicks(1, [4, 4])).toBe(480);
    expect(beatsToTicks(4, [4, 4])).toBe(1920);
    expect(ticksToBeats(1920, [4, 4])).toBe(4);

    // 6/8: 1 tempo = 480 * (4 / 8) = 240 ticks
    expect(beatsToTicks(1, [6, 8])).toBe(240);
    expect(beatsToTicks(6, [6, 8])).toBe(1440);
    expect(ticksToBeats(1440, [6, 8])).toBe(6);
  });
});

describe("Melodia e Eventos MIDI (Round-trip e Invariantes)", () => {
  it("converte melodia para eventos de notas e preserva invariantes no round-trip (4/4)", () => {
    const inputNotes = [
      makeMelodyNote(60, 0, 1, 0.8),
      makeMelodyNote(64, 1, 0.5, 0.9),
      makeMelodyNote(67, 1.5, 1.5, 0.7),
    ];

    const events = melodyToNoteEvents(inputNotes, [4, 4], AI_PPQ);
    expect(events).toEqual([
      { pitch: 60, start_tick: 0, end_tick: 480, velocity: Math.round(0.8 * 127) },
      { pitch: 64, start_tick: 480, end_tick: 720, velocity: Math.round(0.9 * 127) },
      { pitch: 67, start_tick: 720, end_tick: 1440, velocity: Math.round(0.7 * 127) },
    ]);

    const reconstructed = noteEventsToMelody(events, [4, 4], 0.25, AI_PPQ);
    expect(reconstructed.length).toBe(3);
    expect(reconstructed[0].pitch).toBe(60);
    expect(reconstructed[0].start).toBe(0);
    expect(reconstructed[0].duration).toBe(1);
    expect(reconstructed[1].pitch).toBe(64);
    expect(reconstructed[1].start).toBe(1);
    expect(reconstructed[1].duration).toBe(0.5);
    expect(reconstructed[2].pitch).toBe(67);
    expect(reconstructed[2].start).toBe(1.5);
    expect(reconstructed[2].duration).toBe(1.5);
    expect(reconstructed[0].velocity).toBeCloseTo(0.8, 1);
  });

  it("suporta compasso composto (6/8) e quantização personalizada", () => {
    const inputNotes = [
      makeMelodyNote(62, 0, 3, 0.85),
      makeMelodyNote(65, 3, 3, 0.65),
    ];

    const events = melodyToNoteEvents(inputNotes, [6, 8], AI_PPQ);
    // Em 6/8, 1 tempo = 240 ticks; 3 tempos = 720 ticks
    expect(events[0].start_tick).toBe(0);
    expect(events[0].end_tick).toBe(720);
    expect(events[1].start_tick).toBe(720);
    expect(events[1].end_tick).toBe(1440);

    const reconstructed = noteEventsToMelody(events, [6, 8], 0.5, AI_PPQ);
    expect(reconstructed[0].duration).toBe(3);
    expect(reconstructed[1].duration).toBe(3);
  });

  it("garante invariante monofônica se eventos sobrepostos forem passados", () => {
    const overlappingEvents: AINoteEvent[] = [
      { pitch: 60, start_tick: 0, end_tick: 480, velocity: 80 },
      { pitch: 64, start_tick: 240, end_tick: 960, velocity: 80 }, // Começa no meio da primeira
    ];

    const melody = noteEventsToMelody(overlappingEvents, [4, 4], 0.25, AI_PPQ);
    expect(melody.length).toBe(2);
    // A primeira nota deve ter sido encurtada para abrir espaço para a segunda
    expect(melody[0].start).toBe(0);
    expect(melody[0].duration).toBe(0.5);
    expect(melody[1].start).toBe(0.5);
    expect(melody[1].duration).toBe(1.5);
  });

  it("trata listas vazias graciosamente", () => {
    expect(melodyToNoteEvents([])).toEqual([]);
    expect(noteEventsToMelody([])).toEqual([]);
  });
});

describe("Conversão de Cifras e Reconhecimento Harmônico", () => {
  it("converte Chord[] para lista de símbolos ASCII", () => {
    const cMaj7 = makeChord(0, "maj", 4);
    cMaj7.modifiers = [{ kind: "ext", value: "maj7" }];

    const am7 = makeChord(9, "m", 4);
    am7.modifiers = [{ kind: "ext", value: 7 }];

    const dm7 = makeChord(2, "m", 4);
    dm7.modifiers = [{ kind: "ext", value: 7 }];

    const g7 = makeChord(7, "maj", 4);
    g7.modifiers = [{ kind: "ext", value: 7 }];

    const rest = makeRest(4);

    const symbols = chordsToSymbolList([cMaj7, am7, dm7, g7, rest]);
    expect(symbols).toEqual(["Cmaj7", "Am7", "Dm7", "G7", "N.C."]);
  });

  it("reconhece progressão Cmaj7 - Am7 - Dm7 - G7 a partir de eventos MIDI polifônicos", () => {
    // 4 compassos de 4/4 (16 tempos = 7680 ticks a 480 PPQ)
    // Compasso 1 (0..1920): Cmaj7 (C3=48, E4=64, G4=67, B4=71)
    // Compasso 2 (1920..3840): Am7 (A2=45, C4=60, E4=64, G4=67)
    // Compasso 3 (3840..5760): Dm7 (D3=50, F4=65, A4=69, C5=72)
    // Compasso 4 (5760..7680): G7 (G2=43, B3=59, D4=62, F4=65)

    const events: AINoteEvent[] = [
      // Cmaj7
      { pitch: 48, start_tick: 0, end_tick: 1920, velocity: 90 },
      { pitch: 64, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 67, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 71, start_tick: 0, end_tick: 1920, velocity: 80 },

      // Am7
      { pitch: 45, start_tick: 1920, end_tick: 3840, velocity: 90 },
      { pitch: 60, start_tick: 1920, end_tick: 3840, velocity: 80 },
      { pitch: 64, start_tick: 1920, end_tick: 3840, velocity: 80 },
      { pitch: 67, start_tick: 1920, end_tick: 3840, velocity: 80 },

      // Dm7
      { pitch: 50, start_tick: 3840, end_tick: 5760, velocity: 90 },
      { pitch: 65, start_tick: 3840, end_tick: 5760, velocity: 80 },
      { pitch: 69, start_tick: 3840, end_tick: 5760, velocity: 80 },
      { pitch: 72, start_tick: 3840, end_tick: 5760, velocity: 80 },

      // G7
      { pitch: 43, start_tick: 5760, end_tick: 7680, velocity: 90 },
      { pitch: 59, start_tick: 5760, end_tick: 7680, velocity: 80 },
      { pitch: 62, start_tick: 5760, end_tick: 7680, velocity: 80 },
      { pitch: 65, start_tick: 5760, end_tick: 7680, velocity: 80 },
    ];

    const chords = noteEventsToChords(events, [4, 4], 4);
    expect(chords.length).toBe(4);

    const symbols = chordsToSymbolList(chords);
    expect(symbols).toEqual(["Cmaj7", "Am7", "Dm7", "G7"]);
  });

  it("reconhece pausas (N.C.) para janelas silenciosas", () => {
    // Compasso 1: C (0..1920)
    // Compasso 2: Silêncio (1920..3840)
    // Compasso 3: G (3840..5760)
    const events: AINoteEvent[] = [
      { pitch: 48, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 64, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 67, start_tick: 0, end_tick: 1920, velocity: 80 },

      { pitch: 43, start_tick: 3840, end_tick: 5760, velocity: 80 },
      { pitch: 59, start_tick: 3840, end_tick: 5760, velocity: 80 },
      { pitch: 62, start_tick: 3840, end_tick: 5760, velocity: 80 },
    ];

    const chords = noteEventsToChords(events, [4, 4], 4);
    expect(chords.length).toBe(3);

    const symbols = chordsToSymbolList(chords);
    expect(symbols).toEqual(["C", "N.C.", "G"]);
  });

  it("mescla janelas adjacentes idênticas dentro do mesmo compasso", () => {
    // Janelas de 2 tempos em compasso 4/4 (2 janelas por compasso)
    // Compasso 1 (0..4 tempos): ambos tempos têm Cmaj7 -> deve mesclar em 1 acorde de duração 4
    // Compasso 2 (4..8 tempos): primeiros 2 tempos Cmaj7, últimos 2 tempos Am7 -> não mesclam
    const events: AINoteEvent[] = [
      // Compasso 1: Cmaj7 sustentado por 4 tempos (0..1920 ticks)
      { pitch: 48, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 64, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 67, start_tick: 0, end_tick: 1920, velocity: 80 },
      { pitch: 71, start_tick: 0, end_tick: 1920, velocity: 80 },

      // Compasso 2 - Parte 1 (1920..2880 ticks, tempos 4..6): Cmaj7
      { pitch: 48, start_tick: 1920, end_tick: 2880, velocity: 80 },
      { pitch: 64, start_tick: 1920, end_tick: 2880, velocity: 80 },
      { pitch: 67, start_tick: 1920, end_tick: 2880, velocity: 80 },
      { pitch: 71, start_tick: 1920, end_tick: 2880, velocity: 80 },

      // Compasso 2 - Parte 2 (2880..3840 ticks, tempos 6..8): Am7
      { pitch: 45, start_tick: 2880, end_tick: 3840, velocity: 80 },
      { pitch: 60, start_tick: 2880, end_tick: 3840, velocity: 80 },
      { pitch: 64, start_tick: 2880, end_tick: 3840, velocity: 80 },
      { pitch: 67, start_tick: 2880, end_tick: 3840, velocity: 80 },
    ];

    // harmonicRhythmBeats = 2
    const chords = noteEventsToChords(events, [4, 4], 2);
    // Compasso 1: duas janelas de 2 tempos mescladas -> duração 4
    // Compasso 2: Cmaj7 duração 2 e Am7 duração 2 (não mesclam porque são diferentes)
    expect(chords.length).toBe(3);
    expect(chords[0].duration).toBe(4);
    expect(chords[1].duration).toBe(2);
    expect(chords[2].duration).toBe(2);

    const symbols = chordsToSymbolList(chords);
    expect(symbols).toEqual(["Cmaj7", "Cmaj7", "Am7"]);
  });

  it("reconhece baixo invertido (slash chord)", () => {
    // C/E: E2 (40) no baixo com tríade de C (C4=60, G4=67)
    const events: AINoteEvent[] = [
      { pitch: 40, start_tick: 0, end_tick: 1920, velocity: 90 }, // E2
      { pitch: 60, start_tick: 0, end_tick: 1920, velocity: 80 }, // C4
      { pitch: 67, start_tick: 0, end_tick: 1920, velocity: 80 }, // G4
    ];

    const chords = noteEventsToChords(events, [4, 4], 4);
    expect(chords.length).toBe(1);
    expect(chords[0].root).toBe(0);
    expect(chords[0].bass).toBe(4);

    const symbols = chordsToSymbolList(chords);
    expect(symbols).toEqual(["C/E"]);
  });
});
