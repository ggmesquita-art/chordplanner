// Export ABC (partitura em texto; abcjs, EasyABC, abc2midi). Duas vozes (V:1 Acordes em clave de sol,
// V:2 Baixo em clave de fá), arranjo linear (repetições e casa 2 desenroladas), símbolos de acorde entre
// aspas, ligaduras entre compassos e K:/M:/Q: inline quando o bloco muda.

import {
  AccidentalTracker,
  barCapacity,
  barCells,
  buildSegments,
  chordParts,
  spellChordNotes,
  toAscii,
  type Cell,
  type NotationOptions,
  type Segment,
  type SpelledNote,
} from "../core/notation";
import type { Song } from "../core/song";

export type AbcOptions = NotationOptions;

const ACC: Record<number, string> = { [-2]: "__", [-1]: "_", 0: "=", 1: "^", 2: "^^" };
const BARS_PER_LINE = 4;
const MAX_UNIT = 16; // L:1/4

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Texto entre aspas: sem aspas nem quebras de linha. */
const quoted = (s: string) => `"${s.replace(/"/g, "'").replace(/[\r\n]+/g, " ")}"`;

function abcPitch(n: SpelledNote, showAccidental: boolean): string {
  const acc = showAccidental ? ACC[n.alter] : "";
  if (n.octave >= 5) return acc + n.step.toLowerCase() + "'".repeat(n.octave - 5);
  return acc + n.step + ",".repeat(Math.max(0, 4 - n.octave));
}

const tempoField = (seg: Segment) => `Q:1/${seg.meter[1]}=${seg.bpm}`;

export function songToAbc(song: Song, opts: AbcOptions = {}): string {
  const segments = buildSegments(song, opts);
  const title = (opts.title?.trim() || "Chordplanner").replace(/[\r\n]+/g, " ");

  // Unidade de nota (L:) comum: maior potência de 2 (até 1/4) que divide todas as durações e capacidades de compasso.
  let g = 0;
  const cellsOf = segments.map((s) => s.bars.map((b) => barCells(b, s.meter)));
  segments.forEach((s, i) => {
    g = gcd(g, barCapacity(s.meter));
    for (const bar of cellsOf[i]) for (const c of bar) g = gcd(g, c.durDiv);
  });
  let unit = 1;
  while (g > 0 && g % (unit * 2) === 0 && unit * 2 <= MAX_UNIT) unit *= 2;
  const mult = (div: number) => (div / unit === 1 ? "" : String(div / unit));

  const first = segments[0];
  const head = [
    "X:1",
    `T:${title}`,
    `M:${first ? first.meter.join("/") : "4/4"}`,
    `L:1/${64 / unit}`,
    ...(first ? [tempoField(first)] : []),
    "%%score {1 | 2}",
    'V:1 clef=treble name="Acordes"',
    'V:2 clef=bass name="Baixo"',
    `K:${first ? first.sig.abc : "C"}`,
  ];

  const body: string[] = [];
  const trackers = [new AccidentalTracker(0), new AccidentalTracker(0)];
  let prev: Segment | null = null;

  segments.forEach((seg, si) => {
    const inline: string[] = [];
    if (prev) {
      if (prev.sig.abc !== seg.sig.abc || prev.sig.fifths !== seg.sig.fifths) inline.push(`[K:${seg.sig.abc}]`);
      if (prev.meter.join("/") !== seg.meter.join("/")) inline.push(`[M:${seg.meter.join("/")}]`);
      if (prev.bpm !== seg.bpm || prev.meter[1] !== seg.meter[1]) inline.push(`[${tempoField(seg)}]`);
    }
    trackers.forEach((t) => t.setKey(seg.sig.fifths));

    // Barras de cada voz.
    const treble: string[] = [];
    const bass: string[] = [];
    cellsOf[si].forEach((cells, bi) => {
      trackers.forEach((t) => t.startBar());
      const render = (voice: 0 | 1): string =>
        cells
          .map((cell, ci) => cellAbc(cell, voice, seg, trackers[voice], mult, bi === 0 && ci === 0 ? seg.label : undefined))
          .join(" ");
      treble.push(render(0));
      bass.push(render(1));
    });

    for (let i = 0; i < treble.length; i += BARS_PER_LINE) {
      const last = si === segments.length - 1 && i + BARS_PER_LINE >= treble.length;
      const end = last ? "|]" : "|";
      const chunk = (bars: string[], fields: string[]) => (i === 0 && fields.length ? fields.join("") + " " : "") + bars.slice(i, i + BARS_PER_LINE).join(" | ") + " " + end;
      body.push("V:1", chunk(treble, inline), "V:2", chunk(bass, inline.filter((f) => !f.startsWith("[Q:"))));
    }
    prev = seg;
  });
  if (!segments.length) body.push("V:1", "z4 |]", "V:2", "z4 |]");
  return [...head, ...body].join("\n") + "\n";
}

function cellAbc(cell: Cell, voice: 0 | 1, seg: Segment, tracker: AccidentalTracker, mult: (d: number) => string, sectionLabel?: string): string {
  const len = mult(cell.durDiv);
  if (!cell.ref) return `z${len}`;
  const { chord, voiced } = cell.ref;
  const midis = voice === 1 ? voiced.slice(0, 1) : voiced.slice(1);
  let pre = "";
  if (voice === 0 && cell.first) {
    const { root, suffix, bass } = chordParts(chord, seg.spell);
    if (sectionLabel) pre += quoted(`^${sectionLabel}`);
    pre += quoted(toAscii(root + suffix + (bass ? `/${bass}` : "")));
  }
  if (!midis.length) return `${pre}z${len}`;
  const notes = spellChordNotes(chord, midis, seg.spell).map((n) => {
    const state = tracker.use(n);
    // Nota ligada de outro compasso: o acidente é explícito se difere da armadura (o estado do compasso foi zerado).
    const show = cell.tieIn && cell.startDiv === 0 ? n.alter !== tracker.keyAlter(n.letter) : state;
    return abcPitch(n, show);
  });
  const body = notes.length > 1 ? `[${notes.join("")}]` : notes[0];
  return `${pre}${body}${len}${cell.tieOut ? "-" : ""}`;
}
