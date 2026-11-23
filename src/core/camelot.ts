// Módulo puro de mapeamento Camelot e conversão entre ChordPlanner e IA musical (PPQ = 480).
// Sem dependências externas nem efeitos colaterais.

import { makeChord, makeRest, isRest, type Chord } from "./chords";
import type { ScaleContext } from "./diatonic";
import { makeMelodyNote, normalizeMonophonic, type MelodyNote } from "./melody";
import { chordSymbol, sameModifier } from "./modifiers";
import { toAscii } from "./notation";
import { mod12, makeSpeller, type PitchClass } from "./pitch";
import { recognizeChord } from "./recognize";
import { getScale } from "./scales";
import type { Meter } from "./timeline";

export type CamelotCode =
  | "1A"
  | "2A"
  | "3A"
  | "4A"
  | "5A"
  | "6A"
  | "7A"
  | "8A"
  | "9A"
  | "10A"
  | "11A"
  | "12A"
  | "1B"
  | "2B"
  | "3B"
  | "4B"
  | "5B"
  | "6B"
  | "7B"
  | "8B"
  | "9B"
  | "10B"
  | "11B"
  | "12B";

export const AI_PPQ = 480;

export type AINoteEvent = {
  pitch: number;
  start_tick: number;
  end_tick: number;
  velocity: number;
};

// Mapeamento oficial da roda Camelot:
// Menores (A): 1A=Abm(8), 2A=Ebm(3), 3A=Bbm(10), 4A=Fm(5), 5A=Cm(0), 6A=Gm(7),
//              7A=Dm(2), 8A=Am(9), 9A=Em(4), 10A=Bm(11), 11A=F#m(6), 12A=Dbm(1).
const PC_TO_CAMELOT_A: Record<PitchClass, number> = {
  8: 1,
  3: 2,
  10: 3,
  5: 4,
  0: 5,
  7: 6,
  2: 7,
  9: 8,
  4: 9,
  11: 10,
  6: 11,
  1: 12,
};

// Maiores (B): 1B=B(11), 2B=F#(6), 3B=Db(1), 4B=Ab(8), 5B=Eb(3), 6B=Bb(10),
//              7B=F(5), 8B=C(0), 9B=G(7), 10B=D(2), 11B=A(9), 12B=E(4).
const PC_TO_CAMELOT_B: Record<PitchClass, number> = {
  11: 1,
  6: 2,
  1: 3,
  8: 4,
  3: 5,
  10: 6,
  5: 7,
  0: 8,
  7: 9,
  2: 10,
  9: 11,
  4: 12,
};

const CAMELOT_A_TO_PC: Record<number, PitchClass> = {
  1: 8,
  2: 3,
  3: 10,
  4: 5,
  5: 0,
  6: 7,
  7: 2,
  8: 9,
  9: 4,
  10: 11,
  11: 6,
  12: 1,
};

const CAMELOT_B_TO_PC: Record<number, PitchClass> = {
  1: 11,
  2: 6,
  3: 1,
  4: 8,
  5: 3,
  6: 10,
  7: 5,
  8: 0,
  9: 7,
  10: 2,
  11: 9,
  12: 4,
};

/**
 * Converte tônica e escala do ChordPlanner em código da roda Camelot (1A..12A / 1B..12B).
 * Se tonic === null, assume 0 (Dó).
 * Escala com terça menor (intervalo 3 semitons) sem terça maior (4) -> modo "A"; caso contrário, "B".
 */
export function toCamelotCode(tonic: PitchClass | null, scaleId: string): CamelotCode {
  const t = mod12(tonic ?? 0);
  let hasMinorThird = false;
  let hasMajorThird = false;
  try {
    const scale = getScale(scaleId);
    hasMinorThird = scale.intervals.includes(3);
    hasMajorThird = scale.intervals.includes(4);
  } catch {
    const lower = scaleId.toLowerCase();
    hasMinorThird = lower.includes("minor") || lower.includes("aeolian") || lower.includes("dorian");
  }
  const isMinor = hasMinorThird && !hasMajorThird;
  const mode = isMinor ? "A" : "B";
  const num = mode === "A" ? PC_TO_CAMELOT_A[t] : PC_TO_CAMELOT_B[t];
  return `${num}${mode}` as CamelotCode;
}

/**
 * Converte um CamelotCode de volta para { tonic, scaleId, mode, number }.
 */
export function fromCamelotCode(code: CamelotCode): {
  tonic: PitchClass;
  scaleId: "major" | "minor";
  mode: "A" | "B";
  number: number;
} {
  const match = /^(\d{1,2})([AB])$/.exec(code);
  if (!match) throw new Error(`Código Camelot inválido: ${code}`);
  const number = parseInt(match[1], 10);
  if (number < 1 || number > 12) throw new Error(`Número Camelot fora do intervalo (1..12): ${number}`);
  const mode = match[2] as "A" | "B";
  const tonic = mode === "A" ? CAMELOT_A_TO_PC[number] : CAMELOT_B_TO_PC[number];
  if (tonic === undefined) throw new Error(`Código Camelot inválido: ${code}`);
  return {
    tonic,
    scaleId: mode === "A" ? "minor" : "major",
    mode,
    number,
  };
}

/**
 * Retorna os vizinhos harmônicos na roda Camelot:
 * - relative: mesmo número com modo oposto (A <-> B)
 * - dominant: +1 no relógio (quinta ascendente)
 * - subdominant: -1 no relógio (quarta ascendente / quinta descendente)
 * - parallel: homônimo (mesma tônica, modo oposto)
 */
export function camelotNeighbors(code: CamelotCode): {
  relative: CamelotCode;
  dominant: CamelotCode;
  subdominant: CamelotCode;
  parallel: CamelotCode;
} {
  const { tonic, mode, number } = fromCamelotCode(code);
  const relativeMode = mode === "A" ? "B" : "A";
  const relative = `${number}${relativeMode}` as CamelotCode;
  const domNum = (number % 12) + 1;
  const dominant = `${domNum}${mode}` as CamelotCode;
  const subNum = ((number - 2 + 12) % 12) + 1;
  const subdominant = `${subNum}${mode}` as CamelotCode;
  const parallel = toCamelotCode(tonic, mode === "A" ? "major" : "minor");
  return { relative, dominant, subdominant, parallel };
}

/**
 * Converte tempos musicais em ticks MIDI para um determinado compasso e PPQ.
 * 1 tempo = ppq * (4 / meter[1]) ticks.
 */
export function beatsToTicks(beats: number, meter: Meter = [4, 4], ppq = AI_PPQ): number {
  const beatTicks = ppq * (4 / meter[1]);
  return Math.round(beats * beatTicks);
}

/**
 * Converte ticks MIDI em tempos musicais.
 */
export function ticksToBeats(ticks: number, meter: Meter = [4, 4], ppq = AI_PPQ): number {
  const beatTicks = ppq * (4 / meter[1]);
  return ticks / beatTicks;
}

/**
 * Converte notas de melodia do ChordPlanner em eventos MIDI em ticks (PPQ = 480).
 * Velocity (0.05..1) é convertida para 1..127 (padrão 80 se ausente).
 */
export function melodyToNoteEvents(
  melody: readonly MelodyNote[] | undefined,
  meter: Meter = [4, 4],
  ppq = AI_PPQ,
): AINoteEvent[] {
  if (!melody || melody.length === 0) return [];
  return melody.map((n) => {
    const vel =
      n.velocity !== undefined && Number.isFinite(n.velocity)
        ? Math.max(1, Math.min(127, Math.round(n.velocity * 127)))
        : 80;
    return {
      pitch: n.pitch,
      start_tick: beatsToTicks(n.start, meter, ppq),
      end_tick: beatsToTicks(n.start + n.duration, meter, ppq),
      velocity: vel,
    };
  });
}

/**
 * Converte eventos MIDI em ticks para MelodyNote[] do ChordPlanner.
 * Quantiza start e duration para múltiplos de gridStep (mínimo 0.25).
 * Preserva velocity normalizado em 0.05..1 e aplica normalizeMonophonic.
 */
export function noteEventsToMelody(
  events: readonly AINoteEvent[],
  meter: Meter = [4, 4],
  gridStep = 0.25,
  ppq = AI_PPQ,
): MelodyNote[] {
  if (!events || events.length === 0) return [];
  const step = Math.max(0.25, gridStep);

  const rawNotes: MelodyNote[] = events.map((ev) => {
    const rawStart = ticksToBeats(ev.start_tick, meter, ppq);
    const rawEnd = ticksToBeats(ev.end_tick, meter, ppq);
    const start = Math.max(0, Math.round(rawStart / step) * step);
    const duration = Math.max(step, Math.round(Math.max(step, rawEnd - rawStart) / step) * step);
    const vel =
      ev.velocity !== undefined && Number.isFinite(ev.velocity)
        ? Math.max(0.05, Math.min(1, Math.round((ev.velocity / 127) * 1000) / 1000))
        : undefined;

    return makeMelodyNote(
      ev.pitch,
      Math.round(start * 10000) / 10000,
      Math.round(duration * 10000) / 10000,
      vel,
    );
  });

  return normalizeMonophonic(rawNotes);
}

/**
 * Converte Chord[] do bloco em lista de cifras ASCII (ex.: "Cmaj7", "Am7", "N.C." para pausas).
 */
export function chordsToSymbolList(chords: readonly Chord[], tonic: PitchClass | null = 0): string[] {
  const speller = makeSpeller(tonic ?? 0, [], "auto");
  return chords.map((chord) => toAscii(chordSymbol(chord, speller)));
}

function areChordsEqual(a: Chord, b: Chord): boolean {
  if (isRest(a) && isRest(b)) return true;
  if (isRest(a) || isRest(b)) return false;
  if (a.root !== b.root || a.quality !== b.quality || a.bass !== b.bass) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;
  return a.modifiers.every((ma) => b.modifiers.some((mb) => sameModifier(ma, mb)));
}

/**
 * Agrupa notas da faixa harmônica em janelas de harmonicRhythmBeats tempos,
 * reconhece os acordes via recognizeChord (ponderando notas mais graves/longas como baixo),
 * e mescla janelas adjacentes idênticas dentro do mesmo compasso.
 */
export function noteEventsToChords(
  events: readonly AINoteEvent[],
  meter: Meter = [4, 4],
  harmonicRhythmBeats = 4,
  ctx: ScaleContext | null = null,
  ppq = AI_PPQ,
): Chord[] {
  if (!events || events.length === 0) return [];

  const maxTick = Math.max(0, ...events.map((e) => e.end_tick));
  if (maxTick <= 0) return [];

  const totalBeats = ticksToBeats(maxTick, meter, ppq);
  const windowDurationBeats = Math.max(0.25, harmonicRhythmBeats);
  const numWindows = Math.ceil(totalBeats / windowDurationBeats);

  const windowChords: { chord: Chord; startBeat: number; duration: number }[] = [];

  for (let w = 0; w < numWindows; w++) {
    const windowStartBeat = w * windowDurationBeats;
    const windowEndBeat = (w + 1) * windowDurationBeats;
    const windowStartTick = beatsToTicks(windowStartBeat, meter, ppq);
    const windowEndTick = beatsToTicks(windowEndBeat, meter, ppq);
    const windowTickSpan = windowEndTick - windowStartTick;

    // Notas ativas na janela
    const pitchDuration = new Map<number, number>();
    for (const ev of events) {
      if (ev.start_tick < windowEndTick && ev.end_tick > windowStartTick && ev.end_tick > ev.start_tick) {
        const overlapStart = Math.max(ev.start_tick, windowStartTick);
        const overlapEnd = Math.min(ev.end_tick, windowEndTick);
        const overlap = overlapEnd - overlapStart;
        if (overlap > 0) {
          pitchDuration.set(ev.pitch, (pitchDuration.get(ev.pitch) ?? 0) + overlap);
        }
      }
    }

    if (pitchDuration.size === 0) {
      windowChords.push({
        chord: makeRest(windowDurationBeats),
        startBeat: windowStartBeat,
        duration: windowDurationBeats,
      });
      continue;
    }

    // Filtrar notas com duração relevante na janela
    const maxDur = Math.max(...pitchDuration.values());
    const durThreshold = Math.min(maxDur * 0.25, windowTickSpan * 0.1);
    let significant = [...pitchDuration.entries()].filter(([, dur]) => dur >= durThreshold);
    if (significant.length === 0) {
      significant = [...pitchDuration.entries()];
    }

    // Selecionar o baixo ponderando notas graves e longas:
    // Dentre as notas no registro mais grave (até 12 semitons do menor pitch),
    // seleciona a que tiver duração substancial (pelo menos 40% da duração máxima naquele registro grave).
    const minPitch = Math.min(...significant.map(([p]) => p));
    const lowPitches = significant.filter(([p]) => p <= minPitch + 12);
    const maxLowDur = Math.max(...lowPitches.map(([, dur]) => dur));
    const bassCandidates = lowPitches.filter(([, dur]) => dur >= maxLowDur * 0.4);
    bassCandidates.sort((a, b) => a[0] - b[0]);
    const chosenBass = bassCandidates[0][0];

    // Preparar lista de notas para recognizeChord onde chosenBass é a menor nota
    const otherPitches = significant
      .map(([p]) => p)
      .filter((p) => p !== chosenBass);

    // Ajustar notas para que fiquem acima do chosenBass caso necessário
    const notesToRecognize = [
      chosenBass,
      ...otherPitches.map((p) => (p <= chosenBass ? p + 12 * Math.ceil((chosenBass - p + 1) / 12) : p)),
    ];

    const recognized = recognizeChord(notesToRecognize, ctx);

    let chord: Chord;
    if (recognized) {
      chord = makeChord(recognized.root, recognized.quality, windowDurationBeats);
      chord.modifiers = recognized.modifiers;
      if (recognized.bass !== undefined && recognized.bass !== recognized.root) {
        chord.bass = recognized.bass;
      }
    } else {
      // Fallback para pitch class do baixo se houver alguma nota audível
      chord = makeChord(mod12(chosenBass), "maj", windowDurationBeats);
    }

    windowChords.push({
      chord,
      startBeat: windowStartBeat,
      duration: windowDurationBeats,
    });
  }

  // Mesclar janelas adjacentes idênticas dentro do mesmo compasso
  const beatsPerMeasure = meter[0];
  const merged: Chord[] = [];
  let current: Chord | null = null;
  let currentStartBeat = 0;

  for (const item of windowChords) {
    if (!current) {
      current = { ...item.chord, duration: item.duration };
      currentStartBeat = item.startBeat;
      continue;
    }

    const currentMeasure = Math.floor(currentStartBeat / beatsPerMeasure);
    const itemEndBeat = item.startBeat + item.duration;
    const itemEndMeasure = Math.floor((itemEndBeat - 1e-6) / beatsPerMeasure);
    const sameMeasure = currentMeasure === itemEndMeasure;

    if (sameMeasure && areChordsEqual(current, item.chord)) {
      current.duration += item.duration;
    } else {
      merged.push(current);
      current = { ...item.chord, duration: item.duration };
      currentStartBeat = item.startBeat;
    }
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}
