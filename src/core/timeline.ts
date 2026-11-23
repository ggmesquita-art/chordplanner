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
  if (rest < EPS || beatsPerBar - rest < EPS) return 0;
  return beatsPerBar - rest;
}

/** Atraso de swing (em fração de tempo) para uma subdivisão de colcheia. */
export function swingOffset(swing: number, eighthIndex: number): number {
  return eighthIndex % 2 === 1 ? (swing / 100) * (1 / 6) : 0;
}

/** Grade de edição (DESIGN §3.8 / Etapa 6): unidade em que as durações são ajustadas. */
export type Grid = 0.25 | 0.5 | 1 | 2 | 4 | "bar";
export const GRIDS: Grid[] = [0.25, 0.5, 1, 2, 4, "bar"];
/** Tamanho da grade em tempos, na fórmula de compasso dada. */
export const gridBeats = (grid: Grid, [beatsPerBar]: Meter) => (grid === "bar" ? beatsPerBar : grid);

const MAX_DURATION = 64;
const EPS = 1e-9;

/** Próxima duração ao ajustar pela grade (±1). Nunca zera; nunca passa de 64 tempos. */
export function stepDuration(duration: number, dir: 1 | -1, unit: number): number {
  if (dir > 0) return Math.min(MAX_DURATION, (Math.floor(duration / unit + EPS) + 1) * unit);
  const below = (Math.ceil(duration / unit - EPS) - 1) * unit;
  return Math.max(below, Math.min(duration, unit));
}

/** Arredonda ao múltiplo mais próximo da grade (mínimo uma unidade, teto 64). */
export function snapDuration(beats: number, unit: number): number {
  return Math.min(MAX_DURATION, Math.max(unit, Math.round(beats / unit) * unit));
}

/** Deslocamentos (em tempos, desde o início do acorde) das barras de compasso estritamente dentro dele. */
export function barLinesWithin(startBeat: number, duration: number, [beatsPerBar]: Meter): number[] {
  const lines: number[] = [];
  for (let b = (Math.floor(startBeat / beatsPerBar + EPS) + 1) * beatsPerBar; b < startBeat + duration - EPS; b += beatsPerBar) lines.push(b - startBeat);
  return lines;
}

/**
 * Segundos entre duas posições (em tempos) de uma rampa linear de andamento: o BPM vai de `fromBpm`
 * a `toBpm` ao longo de `beats` tempos. Fórmula fechada: ∫ 60/bpm(b) db = 60·beats/(to−from) · ln(bpm(end)/bpm(start)).
 * Com andamento constante cai em 60·(end−start)/bpm.
 */
export function rampSeconds(beats: number, fromBpm: number, toBpm: number, startBeat: number, endBeat: number): number {
  const span = endBeat - startBeat;
  if (span <= 0) return 0;
  if (beats <= 0 || Math.abs(toBpm - fromBpm) < 1e-9) return (60 * span) / fromBpm;
  const at = (b: number) => fromBpm + ((toBpm - fromBpm) * b) / beats;
  return ((60 * beats) / (toBpm - fromBpm)) * Math.log(at(endBeat) / at(startBeat));
}

/** BPM instantâneo numa rampa linear, na posição `beat`. */
export const rampBpmAt = (beats: number, fromBpm: number, toBpm: number, beat: number): number =>
  beats <= 0 ? fromBpm : fromBpm + ((toBpm - fromBpm) * beat) / beats;
