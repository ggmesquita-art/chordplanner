// Inteligência harmônica pura (Etapa 6 / v4): relação melodia↔acorde, sugestão na roda e auto-harmonizador.
// Módulo 100% puro (sem React nem Tone).

import { isRest, makeChord, makeRest, type Chord, type QualityId } from "./chords";
import { nextChordSuggestions, harmonicFunction } from "./analysis";
import { chordFits, tonicChord, type ScaleContext } from "./diatonic";
import { melodyEndBeat, type MelodyNote } from "./melody";
import { chordIntervals } from "./modifiers";
import { mod12, type PitchClass } from "./pitch";
import { isCompound, type Meter } from "./timeline";
import { WHEEL_RINGS, sliceClickable, sliceState, type WheelMode } from "./view";

export type MelodyRelation = "chord-tone" | "tension" | "passing" | "nc";

export type ChordSpan = { chord: Chord; index: number; start: number; end: number };

const EPS = 1e-6;

/** Encontra o acorde/respiro ativo no tempo `beat` dentro do bloco. */
export function chordAtBeat(chords: readonly Chord[], beat: number): ChordSpan | null {
  if (!Number.isFinite(beat) || beat < -EPS) return null;
  let start = 0;
  for (let index = 0; index < chords.length; index++) {
    const chord = chords[index];
    const end = start + chord.duration;
    if (beat >= start - EPS && beat < end - EPS) {
      return { chord, index, start, end };
    }
    start = end;
  }
  return null;
}

const COMPATIBLE_TENSIONS: Record<QualityId, Set<number>> = {
  // Evita 4ª justa (5) sobre tríade maior (avoid note clássica); aceita 9ª, ♯11, 13ª e maj7.
  maj: new Set([2, 6, 9, 11]),
  // Menor: aceita 9ª, 11ª, 13ª dórica e 7ª menor.
  m: new Set([2, 5, 9, 10]),
  dim: new Set([2, 5, 8, 9, 10]),
  aug: new Set([2, 6, 10, 11]),
  sus4: new Set([2, 5, 7, 9, 10, 11]),
  sus2: new Set([2, 5, 7, 9, 10, 11]),
  "5": new Set([2, 5, 7, 9, 10, 11]),
};

/** Classifica uma altura MIDI da melodia em relação ao acorde que soa sob ela. */
export function melodyNoteRelation(pitch: number, chord: Chord | null, ctx: ScaleContext | null): MelodyRelation {
  if (!chord || isRest(chord)) return "nc";
  const pc = mod12(pitch);
  const chordPcs = new Set(chordIntervals(chord).map((i) => mod12(chord.root + i)));
  if (chord.bass !== undefined) chordPcs.add(mod12(chord.bass));
  if (chordPcs.has(pc)) return "chord-tone";
  if (ctx && !ctx.pcSet.has(pc)) return "passing";
  const iv = mod12(pc - chord.root);
  return COMPATIBLE_TENSIONS[chord.quality].has(iv) ? "tension" : "passing";
}

/** Peso métrico da batida no compasso (tempo 1 mais forte, depois meio do compasso, tempos inteiros e subdivisões). */
export function beatWeight(beat: number, meter: Meter): number {
  const bpb = meter[0];
  const inBar = ((beat % bpb) + bpb) % bpb;
  if (inBar < EPS || bpb - inBar < EPS) return 3.0;
  if ((bpb === 4 && Math.abs(inBar - 2) < EPS) || (isCompound(meter) && (inBar % 3 < EPS || 3 - (inBar % 3) < EPS))) {
    return 2.0;
  }
  if (Math.abs(inBar - Math.round(inBar)) < EPS) return 1.5;
  return 0.75;
}

/** Recorta notas da melodia que sobrepõem a janela [fromBeat, toBeat). */
export function melodyNotesInSpan(melody: readonly MelodyNote[], fromBeat: number, toBeat: number): MelodyNote[] {
  const out: MelodyNote[] = [];
  for (const n of melody) {
    const s = Math.max(fromBeat, n.start);
    const e = Math.min(toBeat, n.start + n.duration);
    if (e - s > EPS) out.push({ ...n, start: s, duration: e - s });
  }
  return out;
}

/** Janela [from, to) alvo para sugerir acordes da melodia na roda/lista por graus. */
export function melodyTargetSpan(
  chords: readonly Chord[],
  selectedChordId: string | null,
  melody: readonly MelodyNote[],
  selectedMelodyNoteId: string | null,
  unit: number,
): [number, number] | null {
  if (!melody.length) return null;
  const step = Math.max(0.25, unit);
  if (selectedChordId) {
    let start = 0;
    for (const c of chords) {
      const end = start + c.duration;
      if (c.id === selectedChordId) return [start, end];
      start = end;
    }
  }
  if (selectedMelodyNoteId) {
    const note = melody.find((n) => n.id === selectedMelodyNoteId);
    if (note) {
      const s = Math.floor((note.start + 1e-9) / step) * step;
      return [s, s + step];
    }
  }
  const end = chords.reduce((sum, c) => sum + c.duration, 0);
  if (melody.some((n) => n.start + n.duration > end + EPS)) return [end, end + step];
  return [0, step];
}

export type MelodyChordMatch = { root: PitchClass; quality: QualityId; score: number; coverage: number; reason: string };

function scoreSingleCandidate(
  notes: readonly MelodyNote[],
  root: PitchClass,
  quality: QualityId,
  ctx: ScaleContext,
  meter: Meter,
): { score: number; coverage: number; reason: string } {
  const chord: Pick<Chord, "root" | "quality" | "modifiers" | "rest"> = { root, quality, modifiers: [] };
  let raw = 0;
  let totalWeight = 0;
  let coveredWeight = 0;
  let hasChordTone = false;

  for (const n of notes) {
    const w = beatWeight(n.start, meter) * Math.min(2, Math.max(0.5, n.duration));
    totalWeight += w;
    const rel = melodyNoteRelation(n.pitch, chord as Chord, ctx);
    if (rel === "chord-tone") {
      hasChordTone = true;
      coveredWeight += w;
      const iv = mod12(mod12(n.pitch) - root);
      raw += (iv === 0 || iv === 3 || iv === 4 ? 1.15 : 1.0) * w;
    } else if (rel === "tension") {
      coveredWeight += w;
      raw += 0.45 * w;
    } else {
      raw -= 0.35 * w;
    }
  }

  if (totalWeight <= 0) return { score: 0, coverage: 0, reason: "" };
  const diatonic = chordFits(root, quality, ctx.pcSet);
  const score = raw / totalWeight + (diatonic ? 0.12 : 0) - (quality === "dim" ? 0.2 : 0);
  const coverage = coveredWeight / totalWeight;
  const reason = hasChordTone ? "notas do acorde na melodia" : "tensões compatíveis com a melodia";
  return { score, coverage, reason };
}

/** Pontua acordes da roda para harmonizar um trecho melódico, ponderando tempos fortes. */
export function scoreChordsForMelody(
  melody: readonly MelodyNote[],
  span: [number, number],
  ctx: ScaleContext,
  meter: Meter,
  mode: WheelMode = "colorful",
): MelodyChordMatch[] {
  const notes = melodyNotesInSpan(melody, span[0], span[1]);
  if (!notes.length) return [];

  const matches: MelodyChordMatch[] = [];
  for (let root = 0; root < 12; root++) {
    for (const ring of WHEEL_RINGS) {
      const quality = ring.quality;
      if (!sliceClickable(sliceState(ctx, root, quality), mode)) continue;
      const { score, coverage, reason } = scoreSingleCandidate(notes, root, quality, ctx, meter);
      if (score > 0 && coverage >= 0.45) {
        matches.push({ root, quality, score, coverage, reason });
      }
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}

export type HarmonizeMode = "fill" | "replace";

function diatonicPool(ctx: ScaleContext): { root: PitchClass; quality: QualityId }[] {
  const pool: { root: PitchClass; quality: QualityId }[] = [];
  const seen = new Set<string>();
  const add = (root: PitchClass, quality: QualityId) => {
    const k = `${root}:${quality}`;
    if (!seen.has(k)) {
      seen.add(k);
      pool.push({ root, quality });
    }
  };
  for (const d of ctx.degrees) {
    if (d.primary && WHEEL_RINGS.some((r) => r.quality === d.primary) && chordFits(d.root, d.primary, ctx.pcSet)) {
      add(d.root, d.primary);
    }
  }
  for (let root = 0; root < 12; root++) {
    for (const ring of WHEEL_RINGS) {
      if (chordFits(root, ring.quality, ctx.pcSet)) add(root, ring.quality);
    }
  }
  if (!pool.length) {
    for (const d of ctx.degrees) {
      const q = d.primary ?? d.qualities[0] ?? "5";
      add(d.root, q);
    }
  }
  if (!pool.length) add(ctx.tonic, "maj");
  return pool;
}

/** Gera acordes diatônicos (ou preenche vãos N.C. / continuação) acompanhando a melodia pelo ritmo harmônico. */
export function autoHarmonize(opts: {
  melody: readonly MelodyNote[];
  ctx: ScaleContext;
  meter: Meter;
  stepBeats: number;
  existingChords?: readonly Chord[];
  mode?: HarmonizeMode;
}): Chord[] {
  const { melody, ctx, meter, existingChords = [], mode = "replace" } = opts;
  const melEnd = melodyEndBeat(melody);
  if (melEnd <= 0) return structuredClone([...existingChords]);

  const step = Math.max(0.25, opts.stepBeats);
  const totalSpan = Math.max(step, Math.ceil((melEnd - 1e-9) / step) * step);
  const pool = diatonicPool(ctx);
  const tonicQ = tonicChord(ctx) ?? ctx.degrees[0]?.primary ?? pool[0].quality;

  const buildSlices = (fromBeat: number, toBeat: number) => {
    const slices: { from: number; to: number; dur: number; notes: MelodyNote[] }[] = [];
    let t = fromBeat;
    while (t < toBeat - EPS) {
      let next = Math.min(toBeat, Math.round((t + step) * 64) / 64);
      if (toBeat - next > EPS && toBeat - next < 0.25 - EPS) next = toBeat;
      const dur = Math.max(0.25, Math.round((next - t) * 64) / 64);
      slices.push({ from: t, to: t + dur, dur, notes: melodyNotesInSpan(melody, t, t + dur) });
      t = next;
      if (next >= toBeat - EPS) break;
    }
    return slices;
  };

  const harmonizeRange = (fromBeat: number, toBeat: number, initialHistory: Chord[], isSongEnd: boolean): Chord[] => {
    const slices = buildSlices(fromBeat, toBeat);
    const out: Chord[] = [];
    const history = [...initialHistory];

    for (let i = 0; i < slices.length; i++) {
      const sl = slices[i];
      if (!sl.notes.length) {
        let silentDur = sl.dur;
        for (let j = i + 1; j < slices.length && !slices[j].notes.length; j++) silentDur += slices[j].dur;
        const nextSilent = i + 1 < slices.length && !slices[i + 1].notes.length;
        const isInitial = out.length === 0 && history.length === 0;
        const lastOut = out[out.length - 1];
        if (!isInitial && lastOut && !isRest(lastOut) && !nextSilent && silentDur < meter[0] - EPS) {
          lastOut.duration = Math.round((lastOut.duration + sl.dur) * 64) / 64;
        } else {
          out.push(makeRest(sl.dur));
        }
        continue;
      }

      const suggestions = new Map(
        nextChordSuggestions(ctx, history, 12).map((s) => [`${s.root}:${s.quality}`, s.weight]),
      );
      const lastPlayed = [...history].reverse().find((c) => !isRest(c));
      let best = pool[0];
      let bestTotal = -Infinity;

      for (const cand of pool) {
        const mel = scoreSingleCandidate(sl.notes, cand.root, cand.quality, ctx, meter);
        const sgWeight = suggestions.get(`${cand.root}:${cand.quality}`) ?? 0;
        const isTonic = cand.root === ctx.tonic && cand.quality === tonicQ;
        const fn = harmonicFunction(ctx, { root: cand.root, quality: cand.quality, modifiers: [] });
        let total = mel.score + 0.8 * sgWeight;
        if (cand.quality === "dim") total -= 0.2; // soma -0.4 com scoreSingleCandidate
        if (i === 0 && history.length === 0 && isTonic) total += mel.score > 0 ? 0.6 : 0.15;
        if (isSongEnd && i === slices.length - 1 && isTonic) total += 0.25;
        if (isSongEnd && slices.length >= 2 && i === slices.length - 2 && fn === "D") total += 0.35;
        if (lastPlayed && lastPlayed.root === cand.root && lastPlayed.quality === cand.quality) total -= 0.25;
        if (total > bestTotal) {
          bestTotal = total;
          best = cand;
        }
      }

      const chord = makeChord(best.root, best.quality, sl.dur);
      out.push(chord);
      history.push(chord);
    }
    return out;
  };

  let result: Chord[];
  if (mode === "fill" && existingChords.length > 0) {
    result = [];
    const history: Chord[] = [];
    let pos = 0;
    const totalExisting = existingChords.reduce((sum, c) => sum + c.duration, 0);
    for (let idx = 0; idx < existingChords.length; idx++) {
      const c = existingChords[idx];
      const nextPos = pos + c.duration;
      const isFinalGap = idx === existingChords.length - 1 && totalExisting >= totalSpan - EPS;
      if (!isRest(c)) {
        const copy = structuredClone(c);
        result.push(copy);
        history.push(copy);
      } else if (melodyNotesInSpan(melody, pos, nextPos).length > 0) {
        const filled = harmonizeRange(pos, nextPos, history, isFinalGap);
        result.push(...filled);
        for (const f of filled) if (!isRest(f)) history.push(f);
      } else {
        result.push(makeRest(c.duration));
      }
      pos = nextPos;
    }
    if (pos < totalSpan - EPS) {
      result.push(...harmonizeRange(pos, totalSpan, history, true));
    }
  } else {
    result = harmonizeRange(0, totalSpan, [], true);
  }

  // Mescla respiros N.C. adjacentes resultantes do corte/preenchimento.
  const merged: Chord[] = [];
  for (const c of result) {
    const prev = merged[merged.length - 1];
    if (prev && isRest(prev) && isRest(c)) {
      prev.duration = Math.round((prev.duration + c.duration) * 64) / 64;
    } else {
      merged.push(c);
    }
  }
  return merged;
}
