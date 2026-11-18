// Tap tempo: BPM a partir dos intervalos entre toques recentes.

/** Toques mais velhos que isto (ms) são descartados. */
export const TAP_WINDOW_MS = 2500;
export const MAX_TAPS = 6;

/** Registra um toque em `now` (ms); com 3+ toques na janela, devolve a média dos intervalos em BPM. */
export function tapTempo(timestamps: number[], now: number): { taps: number[]; bpm: number | null } {
  const taps = [...timestamps.filter((t) => now - t < TAP_WINDOW_MS), now].slice(-MAX_TAPS);
  if (taps.length < 3) return { taps, bpm: null };
  const gaps = taps.slice(1).map((t, i) => t - taps[i]);
  return { taps, bpm: 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length) };
}
