// Modificadores de acorde (DESIGN §3.5, §4): resolução pura de notas, símbolo
// canônico, conflitos e status de cada nota contra a escala.

import { getQuality, type Chord } from "./chords";
import type { ScaleContext } from "./diatonic";
import { mod12, type PitchClass, type Speller } from "./pitch";

export type ExtValue = 6 | 7 | "maj7" | 9 | 11 | 13;
export type AltValue = "b5" | "#5" | "b9" | "#9" | "#11" | "b13";

export type Modifier =
  | { kind: "ext"; value: ExtValue }
  | { kind: "sus"; value: 2 | 4 }
  | { kind: "add"; value: 9 | 11 | 13 }
  | { kind: "alt"; value: AltValue }
  | { kind: "omit"; value: 3 | 5 };

export type NoteStatus = "diatonic" | "tension" | "outside";

export type ResolvedChord = {
  /** Intervalos a partir da fundamental (podem passar de 12: 9ª = 14). */
  intervals: number[];
  pcs: PitchClass[];
  symbol: string;
  status: NoteStatus[];
  bass: PitchClass | null;
};

export const sameModifier = (a: Modifier, b: Modifier) => a.kind === b.kind && a.value === b.value;
export const hasModifier = (mods: Modifier[], m: Modifier) => mods.some((x) => sameModifier(x, m));

const SEVENTHS: ExtValue[] = [6, 7, "maj7"];
const TOPS: ExtValue[] = [9, 11, 13];

/** Modificadores que não podem coexistir com `m` (a UI desabilita ou substitui). */
export function conflictsWith(m: Modifier, other: Modifier): boolean {
  if (sameModifier(m, other)) return false;
  if (m.kind === "sus" && other.kind === "sus") return true;
  if (m.kind === "ext" && other.kind === "ext") {
    const bothSeventh = SEVENTHS.includes(m.value) && SEVENTHS.includes(other.value);
    const bothTop = TOPS.includes(m.value) && TOPS.includes(other.value);
    // 6 só combina com a 9ª (acorde 6/9).
    const sixVsHigh = (a: ExtValue, b: ExtValue) => a === 6 && (b === 11 || b === 13);
    return bothSeventh || bothTop || sixVsHigh(m.value, other.value) || sixVsHigh(other.value, m.value);
  }
  const addVsExt = (a: Modifier, e: Modifier) =>
    a.kind === "add" && e.kind === "ext" && typeof e.value === "number" && e.value >= a.value && TOPS.includes(e.value);
  if (addVsExt(m, other) || addVsExt(other, m)) return true;
  if (m.kind === "alt" && other.kind === "alt") {
    const pair = new Set([m.value, other.value]);
    return pair.has("b5") && pair.has("#5");
  }
  return false;
}

/** Liga/desliga um modificador, removendo os conflitantes. */
export function toggleModifier(mods: Modifier[], m: Modifier): Modifier[] {
  if (hasModifier(mods, m)) return mods.filter((x) => !sameModifier(x, m));
  return [...mods.filter((x) => !conflictsWith(m, x)), m];
}

const find = <K extends Modifier["kind"]>(mods: Modifier[], kind: K) =>
  mods.filter((m): m is Extract<Modifier, { kind: K }> => m.kind === kind).map((m) => m.value);

export function chordIntervals(chord: Pick<Chord, "quality" | "modifiers">): number[] {
  const q = getQuality(chord.quality);
  const set = new Set(q.intervals);
  const mods = chord.modifiers;
  const ext = find(mods, "ext");
  const sus = find(mods, "sus")[0];
  const adds = find(mods, "add");
  const alts = find(mods, "alt");
  const omits = find(mods, "omit");

  if (sus) {
    set.delete(3);
    set.delete(4);
    set.add(sus === 2 ? 2 : 5);
  }

  const top = TOPS.filter((t) => ext.includes(t)).pop() as 9 | 11 | 13 | undefined;
  const six = ext.includes(6) && !ext.includes(7) && !ext.includes("maj7");
  if (six) set.add(9);
  // 9/11/13 implicam a 7ª menor, exceto no acorde 6/9.
  if (ext.includes("maj7")) set.add(11);
  else if (ext.includes(7) || (top && !six)) set.add(10);
  if (top) {
    set.add(14);
    if (top >= 11 && (top === 11 || chord.quality === "m")) set.add(17);
    if (top === 13) set.add(21);
  }
  for (const a of adds) set.add(a === 9 ? 14 : a === 11 ? 17 : 21);

  const replace = (natural: number, altered: number) => {
    set.delete(natural);
    set.add(altered);
  };
  if (alts.includes("b5") && !set.has(6)) replace(7, 6);
  if (alts.includes("#5") && !set.has(8)) replace(7, 8);
  if (alts.includes("b9") || alts.includes("#9")) {
    set.delete(14);
    if (alts.includes("b9")) set.add(13);
    if (alts.includes("#9")) set.add(15);
  }
  if (alts.includes("#11")) replace(17, 18);
  if (alts.includes("b13")) replace(21, 20);

  if (omits.includes(3)) {
    set.delete(3);
    set.delete(4);
  }
  if (omits.includes(5)) set.delete(7);

  return [...set].sort((a, b) => a - b);
}

// ——— Símbolo canônico ————————————————————————————————————————————————

const ALT_LABEL: Record<AltValue, string> = { b5: "♭5", "#5": "♯5", b9: "♭9", "#9": "♯9", "#11": "♯11", b13: "♭13" };
const ALT_ORDER: AltValue[] = ["b5", "#5", "b9", "#9", "#11", "b13"];

export function chordSymbol(chord: Chord, spell: Speller): string {
  const mods = chord.modifiers;
  const ext = find(mods, "ext");
  const sus = find(mods, "sus")[0];
  const adds = find(mods, "add");
  const alts = new Set(find(mods, "alt"));
  const omits = find(mods, "omit");
  const top = TOPS.filter((t) => ext.includes(t)).pop();
  const hasMaj7 = ext.includes("maj7");
  const six = ext.includes(6) && !hasMaj7 && !ext.includes(7);
  const has7 = ext.includes(7) || (!!top && !hasMaj7 && !six);
  const sixNine = six && (top === 9 || adds.includes(9));
  const paren: string[] = [];

  let quality = chord.quality;
  if (quality === "5" && (ext.length || adds.length)) {
    quality = "maj";
    omits.push(3);
  }
  // sus remove a 3ª: menor/maior perdem a letra; dim/aug viram 5ª alterada.
  if (sus) {
    if (quality === "dim") alts.add("b5");
    if (quality === "aug") alts.add("#5");
    if (quality !== "sus2" && quality !== "sus4" && quality !== "5") quality = "maj";
  }

  const topStr = top ? String(top) : "7";
  let body = "";
  switch (quality) {
    case "maj":
      if (hasMaj7) body = "maj" + (top ?? 7);
      else if (has7) body = topStr;
      else if (six) body = sixNine ? "6/9" : "6";
      break;
    case "m":
      if (hasMaj7) body = `m(maj${top ?? 7})`;
      else if (has7) body = "m" + topStr;
      else if (six) body = sixNine ? "m6/9" : "m6";
      else body = "m";
      break;
    case "dim":
      if (hasMaj7) body = `°(maj${top ?? 7})`;
      else if (has7) body = `m${topStr}♭5`;
      else if (six) body = "°7";
      else body = "°";
      break;
    case "aug":
      if (hasMaj7) body = `+maj${top ?? 7}`;
      else if (has7) body = "+" + topStr;
      else body = six ? "+6" : "+";
      break;
    case "sus2":
    case "sus4":
      body = (hasMaj7 ? "maj" + (top ?? 7) : has7 ? topStr : six ? "6" : "") + quality;
      break;
    case "5":
      body = "5";
      break;
  }
  if (sus) body += `sus${sus}`;

  for (const a of adds) if (!(a === 9 && sixNine)) body += `add${a}`;
  for (const a of ALT_ORDER) if (alts.has(a)) paren.push(ALT_LABEL[a]);
  for (const o of omits) paren.push(`no${o}`);

  let sym = spell(chord.root) + body + (paren.length ? `(${paren.join(",")})` : "");
  if (chord.bass !== undefined && mod12(chord.bass) !== mod12(chord.root)) sym += "/" + spell(chord.bass);
  return sym;
}

// ——— Status das notas ——————————————————————————————————————————————————

/** Tensões idiomáticas por tipo de acorde (intervalo mod 12 a partir da fundamental). */
function isIdiomaticTension(intervals: number[], interval: number): boolean {
  const s = new Set(intervals.map(mod12));
  const i = mod12(interval);
  const dominant = s.has(4) && s.has(10);
  if (dominant) return [1, 2, 3, 6, 8, 9].includes(i);
  if (s.has(4) && s.has(11)) return [2, 6, 9].includes(i);
  if (s.has(3)) return [2, 5, 9].includes(i);
  return i === 2;
}

export function noteStatus(chord: Pick<Chord, "root" | "quality">, intervals: number[], interval: number, ctx: ScaleContext | null): NoteStatus {
  if (!ctx) return "diatonic";
  const pc = mod12(chord.root + interval);
  if (ctx.pcSet.has(pc)) return "diatonic";
  const isBaseTone = getQuality(chord.quality).intervals.includes(interval);
  if (!isBaseTone && isIdiomaticTension(intervals, interval)) return "tension";
  return "outside";
}

export function resolveChord(chord: Chord, ctx: ScaleContext | null, spell: Speller): ResolvedChord {
  const intervals = chordIntervals(chord);
  return {
    intervals,
    pcs: intervals.map((i) => mod12(chord.root + i)),
    symbol: chordSymbol(chord, spell),
    status: intervals.map((i) => noteStatus(chord, intervals, i, ctx)),
    bass: chord.bass ?? null,
  };
}

const RANK: Record<NoteStatus, number> = { diatonic: 0, tension: 1, outside: 2 };

/** Status de um botão de modificador: o pior status entre as notas que ele introduz. */
export function modifierStatus(chord: Chord, m: Modifier, ctx: ScaleContext | null): NoteStatus {
  const withMod = { ...chord, modifiers: toggleModifier(chord.modifiers.filter((x) => !sameModifier(x, m)), m) };
  const before = new Set(chordIntervals({ ...chord, modifiers: chord.modifiers.filter((x) => !sameModifier(x, m)) }));
  const after = chordIntervals(withMod);
  let worst: NoteStatus = "diatonic";
  for (const iv of after) {
    if (before.has(iv)) continue;
    const st = noteStatus(chord, after, iv, ctx);
    if (RANK[st] > RANK[worst]) worst = st;
  }
  return worst;
}

/** Baixo da n-ésima inversão (0 = fundamental) a partir das notas do acorde. */
export function inversionBass(chord: Chord, n: number): PitchClass | undefined {
  if (n === 0) return undefined;
  const tones = chordIntervals(chord).map(mod12);
  const ordered = [...new Set(tones)].sort((a, b) => a - b);
  return ordered[n] === undefined ? undefined : mod12(chord.root + ordered[n]);
}

export function inversionCount(chord: Chord): number {
  return new Set(chordIntervals(chord).map(mod12)).size;
}
