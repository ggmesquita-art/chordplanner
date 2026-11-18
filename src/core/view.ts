// Cálculos musicais de apresentação: a UI só consome estas funções puras (DESIGN §7).

import { makeChord, type Chord, type QualityId } from "./chords";
import { chordFits, chromaticFunction, romanFor, type ChromaticFunction, type DegreeInfo, type ScaleContext } from "./diatonic";
import { chordIntervals, inversionBass, type NoteStatus, type ResolvedChord } from "./modifiers";
import { fifthsPosition, makeSpeller, mod12, type AccidentalPref, type PitchClass } from "./pitch";
import { getScale, pitchSet, scaleFormula, type ScaleDef } from "./scales";
import { blockBeats, blockMeter, type Block, type Song } from "./song";
import { fitToRange, voiceChord } from "./voicing";

// ---------- ScalePicker ----------

/** Tônica do modo `target` com as mesmas notas do modo `from` na tônica `tonic` (via escala-mãe). */
export function relativeTonic(tonic: PitchClass, from: ScaleDef, target: ScaleDef): PitchClass {
  const parent = getScale(from.mode?.parent ?? from.id);
  const parentTonic = mod12(tonic - parent.intervals[(from.mode?.degree ?? 1) - 1]);
  return mod12(parentTonic + parent.intervals[(target.mode?.degree ?? 1) - 1]);
}

/** Notas MIDI do preview: a escala a partir de 60 + tônica, fechando na oitava. */
export function scalePreviewNotes(tonic: PitchClass, scale: ScaleDef): number[] {
  const base = 60 + tonic;
  return [...scale.intervals.map((i) => base + i), base + 12];
}

/** Fórmula e nomes das notas mostrados no preview da escala. */
export function scalePreviewText(tonic: PitchClass, scale: ScaleDef, pref: AccidentalPref): { formula: string; notes: string } {
  const pcs = pitchSet(tonic, scale);
  const spell = makeSpeller(tonic, pcs, pref);
  return { formula: scaleFormula(scale), notes: pcs.map(spell).join(" ") };
}

// ---------- ChordWheel ----------

export type SliceState = "explore" | "diatonic" | "chromatic" | "other" | "out";
export type WheelMode = "strict" | "colorful" | "free";

/** Anéis da roda: qualidade e deslocamento da fundamental em relação à posição maior (o relativo menor está 9 semitons acima). */
export const WHEEL_RINGS: { quality: QualityId; offset: number; label: string }[] = [
  { quality: "maj", offset: 0, label: "maiores" },
  { quality: "m", offset: 9, label: "menores" },
  { quality: "dim", offset: 11, label: "diminutos" },
];

export const EXTRA_QUALITIES: QualityId[] = ["aug", "sus4", "sus2", "5"];

export function sliceState(ctx: ScaleContext | null, root: PitchClass, quality: QualityId): SliceState {
  if (!ctx) return "explore";
  if (chordFits(root, quality, ctx.pcSet)) return "diatonic";
  if (chromaticFunction(ctx, root, quality)) return "chromatic";
  if (ctx.pcSet.has(root)) return "other";
  return "out";
}

export function sliceClickable(state: SliceState, mode: WheelMode): boolean {
  return state === "explore" || state === "diatonic" || (state === "chromatic" && mode !== "strict") || mode === "free";
}

export type WheelSlice = {
  /** Posição no círculo de quintas (0–11). */
  pos: number;
  root: PitchClass;
  quality: QualityId;
  state: SliceState;
  clickable: boolean;
  chromatic: ChromaticFunction | null;
  /** Algarismo romano (diatônico) ou rótulo V/x (cromático). */
  roman: string | null;
  icon: "" | "◐" | "⚠";
};

/** Estado de cada fatia da roda: um array de 12 posições por anel. */
export function wheelSlices(ctx: ScaleContext | null, mode: WheelMode): WheelSlice[][] {
  return WHEEL_RINGS.map((ring) =>
    Array.from({ length: 12 }, (_, pos) => {
      // fifthsPosition é a própria inversa (7·7 ≡ 1 mod 12): posição → pitch class.
      const root = mod12(fifthsPosition(pos) + ring.offset);
      const state = sliceState(ctx, root, ring.quality);
      const chromatic = state === "chromatic" && ctx ? chromaticFunction(ctx, root, ring.quality) : null;
      const roman = state === "diatonic" && ctx ? romanFor(ctx, root, ring.quality) : chromatic?.label ?? null;
      const icon = state === "other" ? "◐" : state === "out" && mode === "free" ? "⚠" : "";
      return { pos, root, quality: ring.quality, state, clickable: sliceClickable(state, mode), chromatic, roman, icon };
    }),
  );
}

/** Quantos dos 36 acordes da roda são diatônicos / cromáticos liberados. */
export function wheelCounts(ctx: ScaleContext): { diatonic: number; chromatic: number } {
  let diatonic = 0;
  let chromatic = 0;
  for (const ring of WHEEL_RINGS)
    for (let pc = 0; pc < 12; pc++) {
      if (chordFits(pc, ring.quality, ctx.pcSet)) diatonic++;
      else if (chromaticFunction(ctx, pc, ring.quality)) chromatic++;
    }
  return { diatonic, chromatic };
}

/** Classes de pitch do acorde (com modificadores). */
export const chordPitchClasses = (chord: Pick<Chord, "root" | "quality" | "modifiers">): PitchClass[] =>
  chordIntervals(chord).map((i) => mod12(chord.root + i));

/** Dados do centro da roda em hover: acorde, notas, função romana e notas comuns ao acorde anterior. */
export function hoverChordInfo(
  ctx: ScaleContext | null,
  hover: { root: PitchClass; quality: QualityId },
  previous: Chord | null,
): { chord: Chord; pcs: PitchClass[]; roman: string; shared: PitchClass[] | null } {
  const chord = makeChord(hover.root, hover.quality);
  const pcs = chordPitchClasses(chord);
  const prevPcs = previous ? new Set(chordPitchClasses(previous)) : null;
  return {
    chord,
    pcs,
    roman: ctx ? chromaticFunction(ctx, hover.root, hover.quality)?.label ?? romanFor(ctx, hover.root, hover.quality) : "",
    shared: prevPcs ? pcs.filter((pc) => prevPcs.has(pc)) : null,
  };
}

/** Qualidades de um grau que não cabem nos 3 anéis (aug, sus, power chord) e vão para o badge. */
export function extraQualities(deg: DegreeInfo): QualityId[] {
  const ringQs = new Set<QualityId>(WHEEL_RINGS.map((r) => r.quality));
  return deg.qualities.filter((q) => EXTRA_QUALITIES.includes(q) && !(q === "5" && deg.qualities.some((x) => ringQs.has(x))));
}

// ---------- ModifierPanel ----------

/** Inversão atual: 0 = fundamental, n = n-ésima inversão, -1 = baixo livre (slash). */
export function currentInversion(chord: Chord, count: number): number {
  if (chord.bass === undefined) return 0;
  for (let n = 1; n < count; n++) if (inversionBass(chord, n) === chord.bass) return n;
  return -1;
}

/** Voicing ajustado à tessitura; `dropped` conta as notas omitidas. */
export const voicedInRange = (chord: Chord, range: [number, number]): { notes: number[]; dropped: number } => fitToRange(voiceChord(chord), range);

/** Notas do acorde com status e se o baixo (slash) é uma nota extra fora do acorde. */
export function chordNoteList(chord: Chord, resolved: ResolvedChord): { notes: { pc: PitchClass; status: NoteStatus }[]; extraBass: PitchClass | null } {
  return {
    notes: resolved.pcs.map((pc, i) => ({ pc, status: resolved.status[i] })),
    extraBass: chord.bass !== undefined && !resolved.pcs.includes(mod12(chord.bass)) ? chord.bass : null,
  };
}

/** Status da nota MIDI (pela classe de pitch) no acorde resolvido; padrão diatônica. */
export function midiStatus(resolved: ResolvedChord, midi: number): NoteStatus {
  const i = resolved.pcs.lastIndexOf(mod12(midi));
  return i >= 0 ? resolved.status[i] : "diatonic";
}

// ---------- InstrumentPicker ----------

/** Notas do preview: o acorde selecionado ou, sem ele, a tríade da tônica (qualidade primária, padrão maior). */
export function previewChordNotes(selected: Chord | null, tonic: PitchClass | null, ctx: ScaleContext | null): number[] {
  const chord = selected ?? makeChord(tonic ?? 0, ctx?.degrees[0]?.primary ?? "maj");
  return voiceChord(chord);
}

// ---------- Progression ----------

/** Posição inicial (em tempos) de cada acorde do bloco. */
export function chordStarts(chords: Pick<Chord, "duration">[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const c of chords) {
    out.push(acc);
    acc += c.duration;
  }
  return out;
}

/** Notas fora da tessitura (omitidas na reprodução) de cada acorde, por id. */
export function droppedByChord(chords: Chord[], range: [number, number]): Map<string, number> {
  return new Map(chords.map((c) => [c.id, fitToRange(voiceChord(c), range).dropped]));
}

/** Papel do acorde na escala: dentro, cromático (dominante secundária/empréstimo) ou fora, e o romano. */
export function chordRole(ctx: ScaleContext | null, chord: Chord): { inScale: boolean; chromatic: ChromaticFunction | null; roman: string } {
  const inScale = !ctx || chordFits(chord.root, chord.quality, ctx.pcSet);
  const chromatic = ctx && !inScale ? chromaticFunction(ctx, chord.root, chord.quality) : null;
  const roman = ctx ? chromatic?.label ?? romanFor(ctx, chord.root, chord.quality) : "";
  return { inScale, chromatic, roman };
}

/** Marcas da régua do card: uma por tempo; `bar` é o número do compasso nas barras. Acima de 16 tempos só as barras. */
export function rulerMarks(start: number, duration: number, beatsPerBar: number): { at: number; bar: number | null }[] {
  const marks: { at: number; bar: number | null }[] = [];
  for (let beat = Math.ceil(start - 1e-9); beat < start + duration - 1e-9; beat++) {
    const isBar = beat % beatsPerBar === 0;
    if (duration > 16 && !isBar) continue;
    marks.push({ at: beat - start, bar: isBar ? beat / beatsPerBar + 1 : null });
  }
  return marks;
}

// ---------- Arrangement ----------

export type ArrangementEntry = { item: Song["arrangement"][number]; i: number; block: Block | undefined; bars: number; start: number };

/** Compassos de cada instância (com repetições) e compasso de início (1-based); `end` é o compasso após a última. */
export function arrangementLayout(song: Song): { entries: ArrangementEntry[]; end: number } {
  const entries: ArrangementEntry[] = [];
  let start = 1;
  song.arrangement.forEach((item, i) => {
    const block = song.blocks[item.blockId];
    const bars = block ? (blockBeats(block) / blockMeter(song, block)[0]) * item.repeat : 0;
    entries.push({ item, i, block, bars, start });
    start += bars;
  });
  return { entries, end: start };
}

/** Quantas instâncias do arranjo usam cada bloco. */
export function blockUsage(song: Song): Map<string, number> {
  const usage = new Map<string, number>();
  for (const it of song.arrangement) usage.set(it.blockId, (usage.get(it.blockId) ?? 0) + 1);
  return usage;
}

// ---------- Análise ----------

/** Texto do tooltip de um acorde cromático; `withLabel` inclui o rótulo (roda) ou o omite (card). */
export function chromaticTitle(c: ChromaticFunction, withLabel: boolean): string {
  const tag = withLabel ? `: ${c.label}` : "";
  if (c.kind === "secondary") return `Dominante secundária${tag} (resolve em ${c.target})`;
  if (c.kind === "supertonic") return `ii secundário${tag} (prepara ${c.target})`;
  if (c.kind === "subV") return `Substituto de trítono da dominante${tag} (resolve meio tom abaixo, em ${c.target})`;
  return `Empréstimo modal de ${c.from}${tag}`;
}

// ---------- Modulação por bloco ----------

/** Nome curto da escala, sem o parêntese ("Jônio (Maior)" → "Jônio"). */
export const shortScaleName = (scaleId: string): string => getScale(scaleId).name.replace(/ \(.*\)/, "");

/** Rótulo de tonalidade: tônica grafada pela escala + nome curto ("E Dórico"); sem tônica, só a escala. */
export function keyLabel(tonic: PitchClass | null, scaleId: string, accidentals: AccidentalPref): string {
  const scale = getScale(scaleId);
  if (tonic === null) return scale.name;
  const spell = makeSpeller(tonic, pitchSet(tonic, scale), accidentals);
  return `${spell(tonic)} ${shortScaleName(scaleId)}`;
}
