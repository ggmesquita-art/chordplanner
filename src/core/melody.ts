// Melodia por bloco (Etapa 6 / v4): tipos, invariante monofônica, transposição e ajuste à escala.
// Módulo puro (sem React nem Tone).

import type { ScaleContext } from "./diatonic";
import { mod12 } from "./pitch";

export const MELODY_MIN_MIDI = 36; // C2
export const MELODY_MAX_MIDI = 96; // C7
export const MELODY_DEFAULT_LOW = 60; // C4
export const MELODY_DEFAULT_HIGH = 84; // C6
export const MELODY_MIN_DURATION = 0.25;
export const MELODY_MAX_DURATION = 64;
export const MELODY_EPS = 1e-6;
export const DEFAULT_MELODY_INSTRUMENT = "epiano";

export type MelodyNote = {
  id: string;
  /** Nota MIDI inteira em [36..96] (C2..C7). */
  pitch: number;
  /** Posição em tempos dentro do bloco (>= 0). */
  start: number;
  /** Duração em tempos (0.25..64). */
  duration: number;
  /** Intensidade opcional (0.05..1). */
  velocity?: number;
};

let counter = 0;
export const newMelodyNoteId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function makeMelodyNote(pitch: number, start: number, duration: number, velocity?: number): MelodyNote {
  const note: MelodyNote = {
    id: newMelodyNoteId(),
    pitch: clampInt(Number.isFinite(pitch) ? pitch : 60, MELODY_MIN_MIDI, MELODY_MAX_MIDI),
    start: Math.max(0, Number.isFinite(start) ? start : 0),
    duration: clampNum(Number.isFinite(duration) ? duration : 0.5, MELODY_MIN_DURATION, MELODY_MAX_DURATION),
  };
  if (velocity !== undefined && Number.isFinite(velocity)) {
    note.velocity = clampNum(velocity, 0.05, 1);
  }
  return note;
}

/** Tempo final (em tempos) da melodia no bloco; 0 se vazia. */
export function melodyEndBeat(notes: readonly MelodyNote[] | undefined): number {
  if (!notes?.length) return 0;
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.duration);
  return end;
}

/**
 * Garante invariante monofônica (sem sobreposições) ordenada por `start`.
 * Quando `priorityId` é informado, a nota prioritária substitui notas cobertas por ela e
 * encurta a nota imediatamente anterior que invadir seu início.
 */
export function normalizeMonophonic(notes: readonly MelodyNote[], priorityId?: string): MelodyNote[] {
  const clean = notes
    .map((n) => ({
      ...n,
      pitch: clampInt(n.pitch, MELODY_MIN_MIDI, MELODY_MAX_MIDI),
      start: Math.max(0, n.start),
      duration: clampNum(n.duration, MELODY_MIN_DURATION, MELODY_MAX_DURATION),
    }));

  if (priorityId) {
    const pri = clean.find((n) => n.id === priorityId);
    if (pri) {
      const pStart = pri.start;
      const pEnd = pri.start + pri.duration;
      const out: MelodyNote[] = [pri];
      for (const e of clean) {
        if (e.id === priorityId) continue;
        if (e.start < pStart - MELODY_EPS) {
          if (e.start + e.duration > pStart + MELODY_EPS) {
            const trimmed = pStart - e.start;
            if (trimmed >= MELODY_MIN_DURATION - MELODY_EPS) out.push({ ...e, duration: trimmed });
          } else {
            out.push(e);
          }
        } else if (e.start < pEnd - MELODY_EPS) {
          // Coberta pelo início da nota prioritária: substituída.
          continue;
        } else {
          out.push(e);
        }
      }
      return out.sort((a, b) => a.start - b.start || (a.id === priorityId ? -1 : 1));
    }
  }

  const sorted = clean.sort((a, b) => a.start - b.start);
  const out: MelodyNote[] = [];
  for (const curr of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.start + prev.duration > curr.start + MELODY_EPS) {
      const trimmed = curr.start - prev.start;
      if (trimmed >= MELODY_MIN_DURATION - MELODY_EPS) {
        out[out.length - 1] = { ...prev, duration: trimmed };
      } else {
        out.pop();
      }
    }
    out.push(curr);
  }
  return out;
}

/** Insere ou atualiza `note` aplicando a regra monofônica com prioridade para `note.id`. */
export function upsertMelodyNote(notes: readonly MelodyNote[], note: MelodyNote): MelodyNote[] {
  const exists = notes.some((n) => n.id === note.id);
  const next = exists ? notes.map((n) => (n.id === note.id ? note : n)) : [...notes, note];
  return normalizeMonophonic(next, note.id);
}

/** Menor deslocamento em semitons entre duas pitch classes, no intervalo [-5, +6]. */
export function shortestTransposeDelta(fromPc: number, toPc: number): number {
  const d = mod12(toPc - fromPc);
  return d > 6 ? d - 12 : d;
}

/** Transpõe todas as notas mantendo a melodia dentro de C2–C7 sempre que possível por deslocamento de oitava. */
export function transposeMelody(notes: readonly MelodyNote[], semitones: number): MelodyNote[] {
  if (!notes.length || semitones === 0) return notes.map((n) => ({ ...n }));
  const shifted = notes.map((n) => n.pitch + semitones);
  let min = Math.min(...shifted);
  let max = Math.max(...shifted);
  let octShift = 0;
  while (min + octShift < MELODY_MIN_MIDI && max + octShift + 12 <= MELODY_MAX_MIDI) octShift += 12;
  while (max + octShift > MELODY_MAX_MIDI && min + octShift - 12 >= MELODY_MIN_MIDI) octShift -= 12;
  return notes.map((n, i) => ({
    ...n,
    pitch: clampInt(shifted[i] + octShift, MELODY_MIN_MIDI, MELODY_MAX_MIDI),
  }));
}

export function isPitchInScale(pitch: number, ctx: ScaleContext | null): boolean {
  return !ctx || ctx.pcSet.has(mod12(pitch));
}

/** Encontra o MIDI mais próximo em [C2..C7] pertencente à escala (empate: desce antes de subir). */
export function snapPitchToScale(pitch: number, ctx: ScaleContext): number {
  const p = clampInt(pitch, MELODY_MIN_MIDI, MELODY_MAX_MIDI);
  if (ctx.pcSet.has(mod12(p))) return p;
  for (let d = 1; d <= 12; d++) {
    if (p - d >= MELODY_MIN_MIDI && ctx.pcSet.has(mod12(p - d))) return p - d;
    if (p + d <= MELODY_MAX_MIDI && ctx.pcSet.has(mod12(p + d))) return p + d;
  }
  return p;
}

export function snapMelodyToScale(notes: readonly MelodyNote[], ctx: ScaleContext): MelodyNote[] {
  return notes.map((n) => ({ ...n, pitch: snapPitchToScale(n.pitch, ctx) }));
}

/**
 * Alturas MIDI em ordem decrescente para renderizar a grade vertical:
 * com escala (`ctx !== null`), lista só as notas da escala em [low, high] + quaisquer
 * `extraPitches` fora da escala dentro de [C2..C7]; sem escala, devolve todo o cromático [high..low].
 */
export function scalePitchesInRange(
  ctx: ScaleContext | null,
  low = MELODY_DEFAULT_LOW,
  high = MELODY_DEFAULT_HIGH,
  extraPitches: readonly number[] = [],
): number[] {
  const lo = clampInt(Math.min(low, high), MELODY_MIN_MIDI, MELODY_MAX_MIDI);
  const hi = clampInt(Math.max(low, high), MELODY_MIN_MIDI, MELODY_MAX_MIDI);
  const set = new Set<number>();
  for (let m = lo; m <= hi; m++) {
    if (!ctx || ctx.pcSet.has(mod12(m))) set.add(m);
  }
  for (const p of extraPitches) {
    if (Number.isFinite(p)) {
      const midi = clampInt(p, MELODY_MIN_MIDI, MELODY_MAX_MIDI);
      if (midi >= lo && midi <= hi) set.add(midi);
      else if (ctx && !ctx.pcSet.has(mod12(midi))) set.add(midi);
    }
  }
  return [...set].sort((a, b) => b - a);
}

/** Recorta notas da melodia para a janela [fromBeat, toBeat), mantendo `start` em coordenadas do bloco. */
export function sliceMelodyForPass(notes: readonly MelodyNote[], fromBeat: number, toBeat: number): MelodyNote[] {
  const out: MelodyNote[] = [];
  for (const n of notes) {
    const s = Math.max(fromBeat, n.start);
    const e = Math.min(toBeat, n.start + n.duration);
    if (e - s > MELODY_EPS) {
      out.push({ ...n, start: s, duration: e - s });
    }
  }
  return out;
}
