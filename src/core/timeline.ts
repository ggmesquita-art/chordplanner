// Tempo e métrica (DESIGN §3.8). Durações em tempos; o "tempo" é a unidade do
// denominador da fórmula de compasso (em 6/8, uma colcheia).

export type Meter = [beats: number, unit: number];

export const METERS: Meter[] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [12, 8],
];

export const meterLabel = ([b, u]: Meter) => `${b}/${u}`;

/** Compostos (6/8, 9/8, 12/8) agrupam a pulsação de 3 em 3. */
export const isCompound = ([b, u]: Meter) => u === 8 && b % 3 === 0 && b > 3;

/** Segundos por tempo. O BPM conta a unidade do denominador. */
export const secondsPerBeat = (bpm: number) => 60 / bpm;

/** Posição `compasso.tempo` (1-based) de um tempo absoluto dentro de uma métrica. */
export function formatPosition(beat: number, [beatsPerBar]: Meter, barOffset = 0): string {
  const bar = Math.floor(beat / beatsPerBar) + 1 + barOffset;
  const inBar = Math.floor(beat % beatsPerBar) + 1;
  return `${bar}.${inBar}`;
}

export const barsOf = (beats: number, [beatsPerBar]: Meter) => beats / beatsPerBar;

/** Quantos tempos faltam para fechar o último compasso (0 = completo). */
export function missingBeats(beats: number, [beatsPerBar]: Meter): number {
  const rest = beats % beatsPerBar;
  return rest === 0 ? 0 : beatsPerBar - rest;
}

/** Atraso de swing (em fração de tempo) para uma subdivisão de colcheia. */
export function swingOffset(swing: number, eighthIndex: number): number {
  return eighthIndex % 2 === 1 ? (swing / 100) * (1 / 6) : 0;
}

export const DURATION_STEPS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];

/** Grade de edição (DESIGN §3.8): unidade em que as durações são ajustadas. */
export type Grid = 0.5 | 1 | 2 | 4 | "bar";
export const GRIDS: Grid[] = [0.5, 1, 2, 4, "bar"];
/** Tamanho da grade em tempos, na fórmula de compasso dada. */
export const gridBeats = (grid: Grid, [beatsPerBar]: Meter) => (grid === "bar" ? beatsPerBar : grid);
