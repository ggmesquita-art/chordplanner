// Dicionário de qualidades de acordes (DESIGN §2.4).

import type { PitchClass } from "./pitch";
import type { Modifier } from "./modifiers";

export type QualityId = "maj" | "m" | "dim" | "aug" | "sus4" | "sus2" | "5";

export type ChordQuality = {
  id: QualityId;
  symbol: string;
  name: string;
  intervals: number[];
};

/** Em ordem de prioridade para o acorde primário de escalas não heptatônicas (§2.5). */
export const QUALITIES: ChordQuality[] = [
  { id: "maj", symbol: "", name: "maior", intervals: [0, 4, 7] },
  { id: "m", symbol: "m", name: "menor", intervals: [0, 3, 7] },
  { id: "dim", symbol: "°", name: "diminuto", intervals: [0, 3, 6] },
  { id: "aug", symbol: "+", name: "aumentado", intervals: [0, 4, 8] },
  { id: "sus4", symbol: "sus4", name: "suspenso 4", intervals: [0, 5, 7] },
  { id: "sus2", symbol: "sus2", name: "suspenso 2", intervals: [0, 2, 7] },
  { id: "5", symbol: "5", name: "power chord", intervals: [0, 7] },
];

const BY_ID = new Map(QUALITIES.map((q) => [q.id, q]));

export const getQuality = (id: QualityId): ChordQuality => BY_ID.get(id)!;

export type VoicingId = "closed" | "open" | "drop2" | "drop3" | "quartal" | "shell";

export type Chord = {
  id: string;
  root: PitchClass;
  quality: QualityId;
  modifiers: Modifier[];
  /** Baixo invertido / slash (pitch class). */
  bass?: PitchClass;
  voicing?: VoicingId;
  /** Deslocamento de oitava, −2…+2. */
  octave?: number;
  /** Duração em tempos. */
  duration: number;
  /** Acorde ausente / respiro (N.C.): silêncio harmônico mantendo a grade e o metrônomo. */
  rest?: true;
};

export const isRest = (chord: Pick<Chord, "rest"> | null | undefined): boolean => !!chord?.rest;

let counter = 0;
export const newChordId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeChord(root: PitchClass, quality: QualityId, duration = 4): Chord {
  return { id: newChordId(), root, quality, modifiers: [], duration };
}

export function makeRest(duration = 4): Chord {
  return { id: newChordId(), root: 0, quality: "maj", modifiers: [], duration, rest: true };
}
