// Algoritmo central (DESIGN §2.5): descobre os acordes que cabem na escala por
// casamento de conjuntos, e o acorde primário + algarismo romano de cada grau.

import { QUALITIES, getQuality, type QualityId } from "./chords";
import type { Modifier } from "./modifiers";
import { mod12, type PitchClass } from "./pitch";
import { getScale, pitchSet, type ScaleDef } from "./scales";

/** Acorde de sétima de um grau: tríade + modificadores existentes (sem novo QualityId). */
export type SeventhInfo = { label: string; quality: QualityId; modifiers: Modifier[] };

export type DegreeInfo = {
  /** Índice do grau (0 = tônica). */
  index: number;
  root: PitchClass;
  /** Qualidades que cabem na escala, em ordem de prioridade. */
  qualities: QualityId[];
  /** Acorde primário do grau (terças empilhadas em heptatônicas), se houver. */
  primary: QualityId | null;
  roman: string | null;
  /** Sétimas que cabem inteiras na escala (7, maj7, m7, m(maj7), m7♭5, °7). */
  sevenths: SeventhInfo[];
};

export type ScaleContext = {
  tonic: PitchClass;
  scale: ScaleDef;
  pcs: PitchClass[];
  pcSet: Set<PitchClass>;
  degrees: DegreeInfo[];
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** Grau romano por intervalo, para escalas não heptatônicas e acordes de fora. */
const ROMAN_BY_INTERVAL = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];

const MINORISH = new Set<QualityId>(["m", "dim"]);

export function chordFits(root: PitchClass, quality: QualityId, pcSet: Set<PitchClass>): boolean {
  return getQuality(quality).intervals.every((i) => pcSet.has(mod12(root + i)));
}

function qualityFromIntervals(intervals: number[]): QualityId | null {
  const key = intervals.join(",");
  return QUALITIES.find((q) => q.intervals.join(",") === key)?.id ?? null;
}

function decorate(numeral: string, quality: QualityId): string {
  const accidental = numeral.match(/^[♭♯𝄫𝄪]*/u)![0];
  let body = numeral.slice(accidental.length);
  if (MINORISH.has(quality)) body = body.toLowerCase();
  const suffix = quality === "dim" ? "°" : quality === "aug" ? "+" : quality === "sus4" || quality === "sus2" ? quality : quality === "5" ? "5" : "";
  return accidental + body + suffix;
}

function accidentalFor(diff: number): string {
  return diff === -2 ? "𝄫" : diff === -1 ? "♭" : diff === 1 ? "♯" : diff === 2 ? "𝄪" : "";
}

/** Algarismo romano de qualquer acorde no contexto da escala. */
export function romanFor(ctx: ScaleContext, root: PitchClass, quality: QualityId): string {
  const idx = ctx.pcs.indexOf(mod12(root));
  if (ctx.pcs.length === 7 && idx >= 0) {
    let d = ctx.scale.intervals[idx] - MAJOR[idx];
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    return decorate(accidentalFor(d) + ROMAN[idx], quality);
  }
  return decorate(ROMAN_BY_INTERVAL[mod12(root - ctx.tonic)], quality);
}

const SEVENTH_SPECS: { triad: QualityId; extra: number; info: SeventhInfo }[] = [
  { triad: "maj", extra: 10, info: { label: "7", quality: "maj", modifiers: [{ kind: "ext", value: 7 }] } },
  { triad: "maj", extra: 11, info: { label: "maj7", quality: "maj", modifiers: [{ kind: "ext", value: "maj7" }] } },
  { triad: "m", extra: 10, info: { label: "m7", quality: "m", modifiers: [{ kind: "ext", value: 7 }] } },
  { triad: "m", extra: 11, info: { label: "m(maj7)", quality: "m", modifiers: [{ kind: "ext", value: "maj7" }] } },
  { triad: "dim", extra: 10, info: { label: "m7♭5", quality: "dim", modifiers: [{ kind: "ext", value: 7 }] } },
  { triad: "dim", extra: 9, info: { label: "°7", quality: "dim", modifiers: [{ kind: "ext", value: 6 }] } },
];

function seventhsOf(root: PitchClass, pcSet: Set<PitchClass>): SeventhInfo[] {
  return SEVENTH_SPECS.filter((sp) => chordFits(root, sp.triad, pcSet) && pcSet.has(mod12(root + sp.extra))).map((sp) => sp.info);
}

const cache = new Map<string, ScaleContext>();

export function scaleContext(tonic: PitchClass, scaleOrId: ScaleDef | string): ScaleContext {
  const scale = typeof scaleOrId === "string" ? getScale(scaleOrId) : scaleOrId;
  const key = `${tonic}|${scale.id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pcs = pitchSet(tonic, scale);
  const pcSet = new Set(pcs);
  const ctx: ScaleContext = { tonic, scale, pcs, pcSet, degrees: [] };

  ctx.degrees = pcs.map((root, index) => {
    const qualities = QUALITIES.filter((q) => chordFits(root, q.id, pcSet)).map((q) => q.id);
    let primary: QualityId | null = null;
    if (pcs.length === 7) {
      const third = mod12(pcs[(index + 2) % 7] - root);
      const fifth = mod12(pcs[(index + 4) % 7] - root);
      const stacked = qualityFromIntervals([0, third, fifth]);
      if (stacked && qualities.includes(stacked)) primary = stacked;
    }
    primary ??= qualities[0] ?? null;
    return { index, root, qualities, primary, roman: primary ? romanFor(ctx, root, primary) : null, sevenths: seventhsOf(root, pcSet) };
  });

  cache.set(key, ctx);
  return ctx;
}

/** Acorde da tônica (grau I / i) com a qualidade primária do grau. */
export function tonicChord(ctx: ScaleContext): QualityId | null {
  return ctx.degrees[0]?.primary ?? null;
}

export function isDiatonic(ctx: ScaleContext, root: PitchClass, quality: QualityId): boolean {
  return chordFits(root, quality, ctx.pcSet);
}

// ——— Cromatismos idiomáticos (DESIGN §3.7) ————————————————————————————

export type ChromaticFunction =
  | { kind: "secondary"; label: string; target: string }
  | { kind: "supertonic"; label: string; target: string }
  | { kind: "subV"; label: string; target: string }
  | { kind: "borrowed"; label: string; from: string };

/** Modos com a mesma tônica de onde se pode pedir emprestado, além do paralelo (do mais ao menos comum). */
const BORROW_MODES = ["mixolydian", "dorian", "phrygian", "lydian", "minor"];

/**
 * Função de um acorde fora da escala que ainda é idiomático. Quando há mais de uma
 * leitura, vale a primeira desta PRIORIDADE (a mais específica e mais comum):
 *  1. dominante secundária (V/x): acorde maior uma 5ª acima de um grau com tríade
 *     maior/menor, exceto a tônica (cujo V já é diatônico ou não é "secundário");
 *  2. empréstimo do modo paralelo (maior ↔ menor natural);
 *  3. substituto de trítono da dominante (subV): ♭II maior, que resolve meio tom abaixo
 *     na tônica. Só para a tônica: os subV de outros graus caem em empréstimos (♭VI) ou
 *     soam remotos demais para serem liberados no modo Colorido (ex.: ♯IV maior em Dó);
 *  4. ii secundário (ii/x, ii°/x): acorde menor (alvo maior) ou diminuto (alvo menor)
 *     um tom acima de um grau com tríade maior/menor, exceto a tônica;
 *  5. empréstimo de outros modos com a mesma tônica (mixolídio, dórico, frígio, lídio, eólio).
 *     O ♭II maior do frígio já é lido como subV no item 3.
 */
export function chromaticFunction(ctx: ScaleContext, root: PitchClass, quality: QualityId): ChromaticFunction | null {
  if (chordFits(root, quality, ctx.pcSet)) return null;

  if (quality === "maj") {
    const target = ctx.degrees.find((d) => d.root === mod12(root - 7));
    if (target && target.index !== 0 && (target.primary === "maj" || target.primary === "m") && target.roman) {
      return { kind: "secondary", label: `V/${target.roman}`, target: target.roman };
    }
  }

  const iv = new Set(ctx.scale.intervals);
  const parallelId = iv.has(4) && !iv.has(3) ? "minor" : iv.has(3) && !iv.has(4) ? "major" : null;
  if (parallelId && parallelId !== ctx.scale.id) {
    const parallel = scaleContext(ctx.tonic, parallelId);
    if (chordFits(root, quality, parallel.pcSet)) {
      return { kind: "borrowed", label: romanFor(ctx, root, quality), from: parallel.scale.name };
    }
  }

  const tonicPrimary = ctx.degrees[0]?.primary;
  if (quality === "maj" && mod12(root - ctx.tonic) === 1 && (tonicPrimary === "maj" || tonicPrimary === "m")) {
    return { kind: "subV", label: "subV", target: ctx.degrees[0].roman ?? "I" };
  }

  if (quality === "m" || quality === "dim") {
    const target = ctx.degrees.find((d) => d.root === mod12(root - 2));
    const wanted = target?.primary === "maj" ? "m" : target?.primary === "m" ? "dim" : null;
    if (target && target.index !== 0 && wanted === quality && target.roman) {
      return { kind: "supertonic", label: `${quality === "m" ? "ii" : "ii°"}/${target.roman}`, target: target.roman };
    }
  }

  if (parallelId && !(quality === "maj" && mod12(root - ctx.tonic) === 1)) {
    for (const id of BORROW_MODES) {
      if (id === ctx.scale.id || id === parallelId) continue;
      const mode = scaleContext(ctx.tonic, id);
      if (chordFits(root, quality, mode.pcSet)) return { kind: "borrowed", label: romanFor(ctx, root, quality), from: mode.scale.name };
    }
  }
  return null;
}
