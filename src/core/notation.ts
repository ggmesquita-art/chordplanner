// Modelo de notação compartilhado pelos exports de partitura/cifra (MusicXML, ABC, ChordPro):
// compassos reais, durações notáveis, grafia de notas, armadura e "kind" MusicXML de cada acorde.
// Puro; reaproveita a teoria existente (expansão do arranjo, voicing, símbolo canônico).

import type { Chord } from "./chords";
import { chordIntervals, chordSymbol, type Modifier } from "./modifiers";
import { makeSpeller, mod12, type PitchClass, type Speller } from "./pitch";
import { getScale, pitchSet } from "./scales";
import { blockBpm, expandArrangement, type Block, type Song } from "./song";
import type { Meter } from "./timeline";
import { voiceChord } from "./voicing";

export type KeyInfo = { tonic: PitchClass; scaleId: string };

export type NotationOptions = {
  /** Título da música (o `Song` não tem nome). */
  title?: string;
  /** Grafia de cada bloco (tonalidade própria). Padrão: derivada de `keyFor`. */
  spellFor?: (block: Block) => Speller;
  /** Tonalidade efetiva do bloco (própria ou global). Padrão: `block.key`; null = sem armadura. */
  keyFor?: (block: Block) => KeyInfo | null;
};

export type ResolvedNotation = { title: string; spellFor: (block: Block) => Speller; keyFor: (block: Block) => KeyInfo | null };

export function resolveNotation(opts: NotationOptions = {}): ResolvedNotation {
  const keyFor = opts.keyFor ?? ((b: Block) => b.key ?? null);
  const spellFor =
    opts.spellFor ??
    ((b: Block) => {
      const k = keyFor(b);
      return k ? makeSpeller(k.tonic, pitchSet(k.tonic, getScale(k.scaleId)), "auto") : makeSpeller(null, [], "auto");
    });
  return { title: opts.title?.trim() || "Chordplanner", spellFor, keyFor };
}

// ——— Texto ——————————————————————————————————————————————————————————————

/** Glifos do app → ASCII técnico (ABC, ChordPro, texto MIDI). */
export const toAscii = (s: string): string =>
  s.replace(/𝄫/g, "bb").replace(/𝄪/g, "##").replace(/♯/g, "#").replace(/♭/g, "b").replace(/°/g, "dim").replace(/♮/g, "");

// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escape de texto/atributo XML (remove caracteres proibidos em XML 1.0). */
export const xmlEscape = (s: string): string =>
  s
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// ——— Grafia de notas ————————————————————————————————————————————————————

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

export type SpelledNote = { letter: number; step: string; alter: number; octave: number; midi: number };

/** Letra (índice 0=C…6=B) e alteração de um nome como "B♭", "F♯", "C𝄪". */
export function parseNoteName(name: string): { letter: number; alter: number } {
  const letter = Math.max(0, LETTERS.indexOf(name[0] as (typeof LETTERS)[number]));
  let alter = 0;
  for (const ch of name.slice(1)) alter += ch === "♯" || ch === "#" ? 1 : ch === "♭" || ch === "b" ? -1 : ch === "𝄪" ? 2 : ch === "𝄫" ? -2 : 0;
  return { letter, alter };
}

/** Deslocamento de letra (grau) de um intervalo dentro do acorde: ♭5 vs ♯11, ♯9 vs ♭3, 𝄫7 do °7… */
function letterOffset(iv: number, set: Set<number>, chord: Chord): number {
  switch (iv) {
    case 0:
      return 0;
    case 1:
    case 2:
      return 1;
    case 3:
      return set.has(4) ? 1 : 2; // ♯9 quando há 3ª maior
    case 4:
      return 2;
    case 5:
      return 3;
    case 6:
      return set.has(7) ? 3 : 4; // ♯11/♯4 vs ♭5
    case 7:
      return 4;
    case 8:
      return set.has(7) ? 5 : 4; // ♭13 vs ♯5
    case 9:
      return chord.quality === "dim" && !set.has(10) && !set.has(11) ? 6 : 5; // 𝄫7 do °7
    default:
      return 6;
  }
}

/** Grafia técnica das notas (MIDI) de um acorde, coerente com a fundamental do símbolo (letras por grau). */
export function spellChordNotes(chord: Chord, midis: number[], spell: Speller): SpelledNote[] {
  const root = parseNoteName(spell(chord.root));
  const set = new Set(chordIntervals(chord).map(mod12));
  if (chord.bass !== undefined) set.add(mod12(chord.bass - chord.root));
  return midis.map((midi) => {
    const pc = mod12(midi);
    const iv = mod12(pc - chord.root);
    let letter = (root.letter + letterOffset(iv, set, chord)) % 7;
    let diff = mod12(pc - LETTER_PC[letter]);
    if (diff > 6) diff -= 12;
    if (Math.abs(diff) > 2) {
      // Fora do alcance de dobrados: cai na grafia por armadura (sustenidos).
      const fallback = parseNoteName(["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pc]);
      letter = fallback.letter;
      diff = fallback.alter;
    }
    return { letter, step: LETTERS[letter], alter: diff, octave: (midi - diff - LETTER_PC[letter]) / 12 - 1, midi };
  });
}

// ——— Armadura ———————————————————————————————————————————————————————————

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/** Alteração de cada letra (C…B) na armadura de `fifths` (−7…7). */
export function keyAlters(fifths: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => (out[l] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => (out[l] = -1));
  return out;
}

/** Modo do `<key><mode>` do MusicXML (com `fifths`, define a tônica: Ré dórico = 0 + dorian, não Lá menor). */
export type KeyMode = "major" | "minor" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "locrian";

const MODE_BY_INTERVALS: Record<string, { abc: string; mode: KeyMode }> = {
  "0,2,4,5,7,9,11": { abc: "", mode: "major" },
  "0,2,3,5,7,9,10": { abc: "dor", mode: "dorian" },
  "0,1,3,5,7,8,10": { abc: "phr", mode: "phrygian" },
  "0,2,4,6,7,9,11": { abc: "lyd", mode: "lydian" },
  "0,2,4,5,7,9,10": { abc: "mix", mode: "mixolydian" },
  "0,2,3,5,7,8,10": { abc: "m", mode: "minor" },
  "0,1,3,5,6,8,10": { abc: "loc", mode: "locrian" },
};

export type KeySignature = {
  fifths: number;
  mode?: KeyMode;
  /** Valor do campo K: do ABC. */
  abc: string;
};

/**
 * Armadura da tonalidade: escolhe o número de acidentes (−7…7) que mais concorda com a grafia das notas
 * da escala (escalas não diatônicas, como menor harmônica, ficam com a armadura mais próxima).
 */
export function keySignature(key: KeyInfo | null, spell: Speller): KeySignature {
  if (!key) return { fifths: 0, abc: "C" };
  const scale = getScale(key.scaleId);
  const names = pitchSet(key.tonic, scale).map((pc) => parseNoteName(spell(pc)));
  let best = 0;
  let bestScore = -1;
  for (let f = -7; f <= 7; f++) {
    const alters = keyAlters(f);
    const score = names.filter((n) => alters[n.letter] === n.alter).length;
    if (score > bestScore || (score === bestScore && Math.abs(f) < Math.abs(best))) {
      best = f;
      bestScore = score;
    }
  }
  const has = (i: number) => scale.intervals.includes(i);
  const diatonic = MODE_BY_INTERVALS[[...scale.intervals].sort((a, b) => a - b).join(",")];
  // Modo só quando a armadura representa a escala de fato (senão a tônica implícita mentiria).
  const mode: KeyMode | undefined = diatonic && bestScore === 7 ? diatonic.mode : !diatonic ? (has(3) && !has(4) ? "minor" : has(4) && !has(3) ? "major" : undefined) : undefined;
  const tonicName = toAscii(spell(key.tonic));
  // K: com tônica+modo só quando a armadura coincide; senão, o nome da maior de mesma armadura.
  const abc = diatonic && bestScore === 7 ? tonicName + diatonic.abc : majorKeyName(best);
  return { fifths: best, ...(mode ? { mode } : {}), abc };
}

/** Nome (ASCII) da tonalidade maior de uma armadura: 0 → C, 2 → D, −3 → Eb. */
export function majorKeyName(fifths: number): string {
  const NAMES = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return NAMES[fifths + 7];
}

/** Controle de acidentes por compasso: diz se uma nota precisa de acidente explícito. */
export class AccidentalTracker {
  private state = new Map<string, number>();
  private readonly key: number[];
  constructor(fifths: number) {
    this.key = keyAlters(fifths);
  }
  setKey(fifths: number) {
    this.key.splice(0, 7, ...keyAlters(fifths));
    this.state.clear();
  }
  keyAlter(letter: number) {
    return this.key[letter];
  }
  startBar() {
    this.state.clear();
  }
  /** Registra a nota; devolve true se o acidente deve ser mostrado (inclusive o bequadro). */
  use(n: Pick<SpelledNote, "letter" | "alter" | "octave">): boolean {
    const k = `${n.letter}:${n.octave}`;
    const current = this.state.get(k) ?? this.key[n.letter];
    this.state.set(k, n.alter);
    return current !== n.alter;
  }
}

// ——— Compassos e células —————————————————————————————————————————————————

/** Divisões por semibreve: um tempo de denominador `u` vale 64/u divisões (semínima = 16). */
export const DIV_PER_WHOLE = 64;
export const DIV_PER_QUARTER = 16;
export const beatDivisions = (meter: Meter) => DIV_PER_WHOLE / meter[1];
export const barCapacity = (meter: Meter) => meter[0] * beatDivisions(meter);

export type ChordRef = { chord: Chord; voiced: number[] };

/** Trecho de acorde dentro de um compasso (em tempos). */
export type Piece = { ref: ChordRef; start: number; beats: number; first: boolean; continues: boolean };
export type Bar = { pieces: Piece[] };

const EPS = 1e-9;

/** Divide acordes consecutivos (duração em tempos) em compassos de `perBar` tempos; acordes que cruzam a barra viram peças ligadas. */
export function splitBars(items: { ref: ChordRef; beats: number }[], perBar: number): Bar[] {
  const bars: Bar[] = [];
  let pos = 0;
  for (const it of items) {
    let remaining = it.beats;
    let first = true;
    while (remaining > EPS) {
      const bi = Math.floor(pos / perBar + EPS);
      const take = Math.min(perBar * (bi + 1) - pos, remaining);
      remaining -= take;
      (bars[bi] ??= { pieces: [] }).pieces.push({ ref: it.ref, start: pos - bi * perBar, beats: take, first, continues: remaining > EPS });
      pos += take;
      first = false;
    }
  }
  return bars;
}

const SIZES = [64, 48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
const TYPES: Record<number, string> = { 64: "whole", 32: "half", 16: "quarter", 8: "eighth", 4: "16th", 2: "32nd", 1: "64th" };

/** Decompõe uma duração (divisões) em valores notáveis (com até 1 ponto), do maior ao menor. */
export function notatable(div: number): number[] {
  const out: number[] = [];
  let left = div;
  while (left > 0) {
    const s = SIZES.find((x) => x <= left) ?? 1;
    out.push(s);
    left -= s;
  }
  return out;
}

/** Figura MusicXML e pontos de uma duração notável. */
export function noteType(div: number): { type: string; dots: number } {
  if (TYPES[div]) return { type: TYPES[div], dots: 0 };
  return { type: TYPES[(div * 2) / 3], dots: 1 };
}

export type Cell = {
  /** Acorde (nota) ou undefined (pausa). */
  ref?: ChordRef;
  startDiv: number;
  durDiv: number;
  /** Ligada à célula anterior / à seguinte. */
  tieIn: boolean;
  tieOut: boolean;
  /** Primeira célula do acorde (cifra, anotações). */
  first: boolean;
};

/** Células notáveis de um compasso (acordes e pausas); a soma das durações é sempre a capacidade do compasso. */
export function barCells(bar: Bar | undefined, meter: Meter): Cell[] {
  const bd = beatDivisions(meter);
  const cap = barCapacity(meter);
  const cells: Cell[] = [];
  let cursor = 0;
  const rest = (from: number, to: number) => {
    for (const d of notatable(to - from)) {
      cells.push({ startDiv: from, durDiv: d, tieIn: false, tieOut: false, first: false });
      from += d;
    }
  };
  for (const p of bar?.pieces ?? []) {
    const s = Math.round(p.start * bd);
    const e = Math.min(cap, Math.round((p.start + p.beats) * bd));
    if (s > cursor) rest(cursor, s);
    if (e <= s) continue;
    const parts = notatable(e - s);
    let at = s;
    parts.forEach((d, i) => {
      cells.push({
        ref: p.ref,
        startDiv: at,
        durDiv: d,
        tieIn: i > 0 || !p.first,
        tieOut: i < parts.length - 1 || p.continues,
        first: p.first && i === 0,
      });
      at += d;
    });
    cursor = e;
  }
  if (cursor < cap) rest(cursor, cap);
  return cells;
}

// ——— Segmentos (arranjo expandido) ————————————————————————————————————————

export type Segment = {
  itemIndex: number;
  repetition: number;
  block: Block;
  /** Nome do bloco; repetições seguintes levam " (2)", " (3)"… */
  label: string;
  meter: Meter;
  bpm: number;
  rampTo?: number;
  key: KeyInfo | null;
  sig: KeySignature;
  spell: Speller;
  bars: Bar[];
};

/**
 * Arranjo linear (repetições e casa 2 desenroladas) em segmentos, um por passada de bloco,
 * com compassos reais e o voicing do áudio/MIDI (condução de vozes incluída, sem humanização).
 */
export function buildSegments(song: Song, opts: NotationOptions = {}): Segment[] {
  const nz = resolveNotation(opts);
  const expanded = expandArrangement(song);
  const segments: Segment[] = [];
  let prevNotes: number[] | null = null;
  let current: { key: string; items: { ref: ChordRef; beats: number }[]; first: (typeof expanded.events)[number] } | null = null;
  const flush = () => {
    if (!current) return;
    const first = current.first;
    const block = song.blocks[first.blockId];
    const spell = nz.spellFor(block);
    const key = nz.keyFor(block);
    segments.push({
      itemIndex: first.itemIndex,
      repetition: first.repetition,
      block,
      label: first.repetition > 0 ? `${block.name} (${first.repetition + 1})` : block.name,
      meter: first.meter,
      bpm: blockBpm(song, block),
      ...(block.rampTo !== undefined && block.rampTo !== blockBpm(song, block) ? { rampTo: block.rampTo } : {}),
      key,
      sig: keySignature(key, spell),
      spell,
      bars: splitBars(current.items, first.meter[0]),
    });
    current = null;
  };
  for (const ev of expanded.events) {
    const pass = `${ev.itemIndex}:${ev.repetition}`;
    if (!current || current.key !== pass) {
      flush();
      prevNotes = null;
      current = { key: pass, items: [], first: ev };
    }
    const voiced = voiceChord(ev.chord, song.voiceLeading ? prevNotes : null);
    if (song.voiceLeading) prevNotes = voiced;
    current.items.push({ ref: { chord: ev.chord, voiced }, beats: ev.beats });
  }
  flush();
  return segments;
}

// ——— Símbolo e kind MusicXML ————————————————————————————————————————————

/** Partes do símbolo do app: fundamental, sufixo (qualidade/extensões) e baixo (slash), com a grafia dada. */
export function chordParts(chord: Chord, spell: Speller): { root: string; suffix: string; bass: string | null } {
  const root = spell(chord.root);
  const bass = chord.bass !== undefined && mod12(chord.bass) !== mod12(chord.root) ? spell(chord.bass) : null;
  let suffix = chordSymbol(chord, spell).slice(root.length);
  if (bass && suffix.endsWith("/" + bass)) suffix = suffix.slice(0, -(bass.length + 1));
  return { root, suffix, bass };
}

export type KindDegree = { value: number; alter: number; type: "add" | "alter" | "subtract" };
export type KindInfo = { kind: string; degrees: KindDegree[] };

type ModValue<K extends Modifier["kind"]> = Extract<Modifier, { kind: K }>["value"];
const vals = <K extends Modifier["kind"]>(mods: Modifier[], kind: K) =>
  mods.filter((m) => m.kind === kind).map((m) => m.value as ModValue<K>);

/** `kind` MusicXML do acorde e os `<degree>` para o que o kind não cobre. */
export function chordKind(chord: Chord): KindInfo {
  const mods = chord.modifiers;
  const ext = vals(mods, "ext");
  const adds = vals(mods, "add");
  const alts = new Set<string>(vals(mods, "alt"));
  const omits: number[] = [...vals(mods, "omit")];
  const top = ([9, 11, 13] as const).filter((t) => ext.includes(t)).pop();
  const hasMaj7 = ext.includes("maj7");
  const six = ext.includes(6) && !hasMaj7 && !ext.includes(7);
  const has7 = ext.includes(7) || (!!top && !hasMaj7 && !six);
  let quality = chord.quality;
  if (quality === "5" && (ext.length || adds.length)) {
    quality = "maj";
    omits.push(3);
  }
  const sus = vals(mods, "sus")[0] ?? (quality === "sus4" ? 4 : quality === "sus2" ? 2 : undefined);
  if (vals(mods, "sus")[0]) {
    if (quality === "dim") alts.add("b5");
    if (quality === "aug") alts.add("#5");
  }

  const degrees: KindDegree[] = [];
  const add = (value: number, alter = 0) => degrees.push({ value, alter, type: "add" });
  let kind: string;
  let cover = 0; // maior extensão já coberta pelo kind (7, 9, 11, 13)
  const stack = (base: "major" | "minor" | "dominant"): string => {
    if (!top) return base === "dominant" ? "dominant" : base === "major" ? "major-seventh" : "minor-seventh";
    return `${base === "dominant" ? "dominant" : base}-${top === 9 ? "ninth" : top === 11 ? "11th" : "13th"}`;
  };

  if (sus) {
    kind = sus === 4 ? "suspended-fourth" : "suspended-second";
    if (hasMaj7) add(7);
    else if (has7) add(7, -1);
    if (top) add(top);
    if (six) add(6);
    cover = top ?? (hasMaj7 || has7 ? 7 : 0);
  } else if (quality === "5") {
    kind = "power";
  } else if (quality === "maj") {
    if (hasMaj7) {
      kind = stack("major");
      cover = top ?? 7;
    } else if (has7) {
      kind = stack("dominant");
      cover = top ?? 7;
    } else if (six) {
      kind = "major-sixth";
      if (top === 9 || adds.includes(9)) add(9);
    } else kind = "major";
  } else if (quality === "m") {
    if (hasMaj7) {
      kind = "major-minor";
      if (top) add(top);
      cover = top ?? 7;
    } else if (has7) {
      kind = stack("minor");
      cover = top ?? 7;
    } else if (six) {
      kind = "minor-sixth";
      if (top === 9 || adds.includes(9)) add(9);
    } else kind = "minor";
  } else if (quality === "dim") {
    if (hasMaj7) {
      kind = "diminished";
      add(7);
      if (top) add(top);
      cover = top ?? 7;
    } else if (has7) {
      kind = "half-diminished";
      if (top) add(top);
      cover = top ?? 7;
    } else kind = six ? "diminished-seventh" : "diminished";
  } else {
    // aug
    if (hasMaj7) {
      kind = "augmented";
      add(7);
      if (top) add(top);
      cover = top ?? 7;
    } else if (has7) {
      kind = "augmented-seventh";
      if (top) add(top);
      cover = top ?? 7;
    } else {
      kind = "augmented";
      if (six) add(6);
    }
  }

  const fixedFifth = quality === "dim" || quality === "aug";
  if (alts.has("b5") && !fixedFifth) degrees.push({ value: 5, alter: -1, type: "alter" });
  if (alts.has("#5") && !fixedFifth) degrees.push({ value: 5, alter: 1, type: "alter" });
  const altered = (value: number, alter: number) => degrees.push({ value, alter, type: cover >= value ? "alter" : "add" });
  if (alts.has("b9")) altered(9, -1);
  if (alts.has("#9")) altered(9, 1);
  if (alts.has("#11")) altered(11, 1);
  if (alts.has("b13")) altered(13, -1);
  for (const a of adds) if (!degrees.some((d) => d.value === a && d.type === "add" && d.alter === 0)) add(a);
  for (const o of omits) if (!degrees.some((d) => d.value === o && d.type === "subtract")) degrees.push({ value: o, alter: 0, type: "subtract" });
  return { kind, degrees };
}
