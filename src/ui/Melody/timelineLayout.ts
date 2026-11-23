import { MELODY_MAX_MIDI, MELODY_MIN_MIDI, melodyEndBeat } from "../../core/melody";
import { mod12, type Speller } from "../../core/pitch";
import { blockChordBeats, type Block } from "../../core/song";
import type { Meter } from "../../core/timeline";

export const DEFAULT_PX_PER_BEAT = 56;
export const ZOOM_STEPS = [32, 44, 56, 76, 100, 128] as const;
export const LANE_GUTTER_PX = 52;
export const MELODY_ROW_H = 20;
export const MELODY_COMPACT_ROW_H = 12;

export const GRID_LABEL: Record<string, string> = {
  "0.25": "¼ tempo",
  "0.5": "½ tempo",
  "1": "1 tempo",
  "2": "2 tempos",
  "4": "4 tempos",
  bar: "compasso",
};

/** Escolhe o próximo degrau de zoom horizontal em `ZOOM_STEPS`. */
export function nextZoom(current: number, dir: -1 | 1): number {
  let idx = ZOOM_STEPS.findIndex((z) => z >= current);
  if (idx < 0) idx = ZOOM_STEPS.length - 1;
  if (ZOOM_STEPS[idx] !== current && dir < 0) idx = Math.max(0, idx - 1);
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir))];
}

/**
 * Quando `autoFit` está ativo e o conteúdo em `basePxPerBeat` excede `viewportWidth`,
 * reduz `pxPerBeat` para caber exatamente na área visível sem rolagem horizontal.
 */
export function fitPxPerBeat(
  basePxPerBeat: number,
  totalBeats: number,
  viewportWidth: number,
  gutterPx: number,
  autoFit: boolean,
): number {
  if (!autoFit || totalBeats <= 0 || viewportWidth <= gutterPx) return basePxPerBeat;
  const available = viewportWidth - gutterPx;
  if (totalBeats * basePxPerBeat <= available) return basePxPerBeat;
  return Math.max(0.5, Math.floor((available * 1000) / totalBeats) / 1000);
}

/** Duração total em tempos da janela compartilhada entre Melodia e Acordes. */
export function laneTotalBeats(block: Block, meter: Meter, editEnding: boolean): number {
  const bpb = meter[0];
  if (editEnding) {
    const endChords = (block.ending ?? []).reduce((s, c) => s + c.duration, 0);
    const content = Math.max(endChords, melodyEndBeat(block.melodyEnding));
    return Math.max(bpb, Math.ceil(Math.max(content, bpb) / bpb) * bpb);
  }
  const content = Math.max(blockChordBeats(block), melodyEndBeat(block.melody));
  return Math.max(4 * bpb, (Math.floor((content + 1e-6) / bpb) + 1) * bpb);
}

/** Rótulo da nota MIDI com oitava (ex.: C4 = MIDI 60). */
export function midiNoteLabel(midi: number, spell: Speller): string {
  return `${spell(mod12(midi))}${Math.floor(midi / 12) - 1}`;
}

/** Arredonda uma batida para baixo até o múltiplo da grade, com precisão de fusa (1/64). */
export function snapStartBeat(rawBeat: number, unit: number): number {
  return Math.max(0, Math.round(Math.floor((rawBeat + 1e-9) / unit) * unit * 64) / 64);
}

/** Recorta a grade vertical para o modo compacto mantendo notas existentes visíveis e faixa enxuta (~1 oitava+). */
export function compactMelodyRows(allRows: number[], notes: readonly { pitch: number }[]): number[] {
  const noteSet = new Set(notes.map((n) => n.pitch));
  let lo = 60;
  let hi = 76;
  if (notes.length > 0) {
    const minP = Math.min(...notes.map((n) => n.pitch));
    const maxP = Math.max(...notes.map((n) => n.pitch));
    lo = minP - 3;
    hi = maxP + 3;
    if (hi - lo < 12) {
      const mid = Math.round((minP + maxP) / 2);
      lo = mid - 6;
      hi = mid + 6;
    }
    lo = Math.max(MELODY_MIN_MIDI, lo);
    hi = Math.min(MELODY_MAX_MIDI, hi);
  }
  const filtered = allRows.filter((p) => (p >= lo && p <= hi) || noteSet.has(p));
  return filtered.length ? filtered : allRows;
}
