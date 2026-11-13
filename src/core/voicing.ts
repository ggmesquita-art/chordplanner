// Voicing: transforma um acorde resolvido em notas MIDI (DESIGN §3.5, §5.2).

import type { Chord } from "./chords";
import { chordIntervals } from "./modifiers";
import { mod12 } from "./pitch";

const BASS_BASE = 36; // C2
/** Faixa onde começa a estrutura superior (F3–E4): nem embolada no grave, nem estridente. */
const UPPER_LOW = 53;

/**
 * Voicing de piano: baixo separado na 2ª oitava (fundamental, inversão ou slash)
 * e estrutura superior fechada a partir da fundamental, começando entre F3 e E4.
 */
export function voiceChord(chord: Chord): number[] {
  const oct = (chord.octave ?? 0) * 12;
  const bass = BASS_BASE + mod12(chord.bass ?? chord.root) + oct;
  let upperRoot = 48 + chord.root;
  if (upperRoot < UPPER_LOW) upperRoot += 12;
  const upper = chordIntervals(chord).map((i) => upperRoot + i + oct);
  return [bass, ...upper.filter((n) => n > bass)].sort((a, b) => a - b);
}

/** Ajusta as notas à tessitura do instrumento, transpondo por oitava; omite o que não couber. */
export function fitToRange(notes: number[], [lo, hi]: [number, number]): { notes: number[]; dropped: number } {
  const fitted: number[] = [];
  let dropped = 0;
  for (let n of notes) {
    while (n < lo) n += 12;
    while (n > hi) n -= 12;
    if (n < lo || n > hi) dropped++;
    else fitted.push(n);
  }
  return { notes: [...new Set(fitted)].sort((a, b) => a - b), dropped };
}
