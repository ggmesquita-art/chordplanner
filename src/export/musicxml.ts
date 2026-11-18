// Export MusicXML 4.0 (score-partwise) para DAWs e editores de partitura.
// Duas partes (Acordes em clave de sol / Baixo em clave de fá), arranjo linear (repetições e casa 2
// desenroladas), <harmony> em cada acorde, compassos reais com ligaduras, armadura/compasso/andamento por bloco.

import { instrumentByPatchID } from "@tonejs/midi/dist/InstrumentMaps";
import { gmProgram } from "../audio/render";
import {
  AccidentalTracker,
  barCells,
  buildSegments,
  chordKind,
  chordParts,
  DIV_PER_QUARTER,
  noteType,
  parseNoteName,
  spellChordNotes,
  xmlEscape as esc,
  type Cell,
  type NotationOptions,
  type Segment,
  type SpelledNote,
} from "../core/notation";
import type { Song } from "../core/song";

export type MusicXmlOptions = NotationOptions & {
  /** Programa GM (1–128) da parte de acordes. Padrão: o do instrumento da música. */
  chordsProgram?: number;
  /** Programa GM (1–128) da parte de baixo. Padrão: 33 (baixo acústico). */
  bassProgram?: number;
};

const ACCIDENTAL: Record<number, string> = { [-2]: "flat-flat", [-1]: "flat", 0: "natural", 1: "sharp", 2: "double-sharp" };
const UNIT_NAME: Record<number, string> = { 2: "half", 4: "quarter", 8: "eighth", 16: "16th" };
const round2 = (n: number) => Math.round(n * 100) / 100;

type PartKind = "chords" | "bass";

export function songToMusicXml(song: Song, opts: MusicXmlOptions = {}): string {
  const segments = buildSegments(song, opts);
  const title = opts.title?.trim() || "Chordplanner";
  const chordsProgram = opts.chordsProgram ?? gmProgram(song.instrument, instrumentByPatchID) + 1;
  const bassProgram = opts.bassProgram ?? 33;

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`  <work><work-title>${esc(title)}</work-title></work>`);
  out.push("  <identification><encoding><software>Chordplanner</software></encoding></identification>");
  out.push("  <part-list>");
  for (const [id, name, program, channel] of [
    ["P1", "Acordes", chordsProgram, 1],
    ["P2", "Baixo", bassProgram, 2],
  ] as const) {
    out.push(
      `    <score-part id="${id}"><part-name>${name}</part-name>` +
        `<score-instrument id="${id}-I1"><instrument-name>${name}</instrument-name></score-instrument>` +
        `<midi-instrument id="${id}-I1"><midi-channel>${channel}</midi-channel><midi-program>${program}</midi-program></midi-instrument></score-part>`,
    );
  }
  out.push("  </part-list>");
  out.push(part("P1", "chords", segments));
  out.push(part("P2", "bass", segments));
  out.push("</score-partwise>");
  return out.join("\n") + "\n";
}

const keyId = (s: Segment) => `${s.sig.fifths}:${s.sig.mode ?? ""}`;
const meterId = (s: Segment) => s.meter.join("/");

function part(id: string, kind: PartKind, segments: Segment[]): string {
  const out: string[] = [`  <part id="${id}">`];
  const tracker = new AccidentalTracker(0);
  let measureNo = 0;
  let prev: Segment | null = null;
  let lastTempo = "";
  const total = segments.reduce((n, s) => n + s.bars.length, 0);

  for (const seg of segments) {
    const spellFor = seg.spell;
    seg.bars.forEach((bar, bi) => {
      measureNo++;
      const m: string[] = [];
      const newKey = !prev || keyId(prev) !== keyId(seg);
      const newMeter = !prev || meterId(prev) !== meterId(seg);
      if (!prev || newKey || newMeter) {
        const attrs: string[] = [];
        if (!prev) attrs.push(`<divisions>${DIV_PER_QUARTER}</divisions>`);
        if (newKey) attrs.push(`<key><fifths>${seg.sig.fifths}</fifths>${seg.sig.mode ? `<mode>${seg.sig.mode}</mode>` : ""}</key>`);
        if (newMeter) attrs.push(`<time><beats>${seg.meter[0]}</beats><beat-type>${seg.meter[1]}</beat-type></time>`);
        if (!prev) attrs.push(kind === "chords" ? "<clef><sign>G</sign><line>2</line></clef>" : "<clef><sign>F</sign><line>4</line></clef>");
        m.push(`      <attributes>${attrs.join("")}</attributes>`);
      }
      if (newKey) tracker.setKey(seg.sig.fifths);
      tracker.startBar();

      if (kind === "chords" && bi === 0) {
        const unit = UNIT_NAME[seg.meter[1]] ?? "quarter";
        const tempoKey = `${seg.bpm}/${seg.meter[1]}/${seg.rampTo ?? ""}`;
        m.push(`      <direction placement="above"><direction-type><rehearsal>${esc(seg.label)}</rehearsal></direction-type></direction>`);
        if (tempoKey !== lastTempo) {
          const quarterBpm = round2((seg.bpm * 4) / seg.meter[1]);
          m.push(
            `      <direction placement="above"><direction-type><metronome><beat-unit>${unit}</beat-unit><per-minute>${seg.bpm}</per-minute></metronome></direction-type><sound tempo="${quarterBpm}"/></direction>`,
          );
          if (seg.rampTo !== undefined) {
            m.push(`      <direction placement="above"><direction-type><words>${seg.rampTo < seg.bpm ? "rit." : "accel."}</words></direction-type></direction>`);
          }
          lastTempo = tempoKey;
        }
      }

      for (const cell of barCells(bar, seg.meter)) m.push(...cellXml(cell, kind, spellFor, tracker));
      if (measureNo === total) m.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      out.push(`    <measure number="${measureNo}">`, ...m, "    </measure>");
      prev = seg;
    });
    // Bloco sem acordes: não gera compassos; não altera `prev`.
  }
  if (!total) {
    // Partitura vazia ainda precisa de um compasso válido.
    out.push(
      '    <measure number="1">',
      `      <attributes><divisions>${DIV_PER_QUARTER}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${kind === "chords" ? "<clef><sign>G</sign><line>2</line></clef>" : "<clef><sign>F</sign><line>4</line></clef>"}</attributes>`,
      `      <note><rest measure="yes"/><duration>${DIV_PER_QUARTER * 4}</duration><voice>1</voice></note>`,
      "    </measure>",
    );
  }
  out.push("  </part>");
  return out.join("\n");
}

function cellXml(cell: Cell, kind: PartKind, spell: Segment["spell"], tracker: AccidentalTracker): string[] {
  const { type, dots } = noteType(cell.durDiv);
  const common = `<duration>${cell.durDiv}</duration>`;
  const tail = (extra = "") => `${cell.tieIn ? '<tie type="stop"/>' : ""}${cell.tieOut ? '<tie type="start"/>' : ""}<voice>1</voice><type>${type}</type>${"<dot/>".repeat(dots)}${extra}`;
  const rest = () => [`      <note><rest/>${common}<voice>1</voice><type>${type}</type>${"<dot/>".repeat(dots)}</note>`];
  const lines: string[] = [];

  if (!cell.ref) return rest();
  const { chord, voiced } = cell.ref;
  if (kind === "chords" && cell.first) lines.push(harmonyXml(chord, spell));

  const midis = kind === "bass" ? voiced.slice(0, 1) : voiced.slice(1);
  if (!midis.length) return [...lines, ...rest()];
  const spelled = spellChordNotes(chord, midis, spell);
  spelled.forEach((n, i) => {
    const show = tracker.use(n);
    const accidental = show && !(cell.tieIn && cell.startDiv === 0) ? `<accidental>${ACCIDENTAL[n.alter]}</accidental>` : "";
    const notations = cell.tieIn || cell.tieOut ? `<notations>${cell.tieIn ? '<tied type="stop"/>' : ""}${cell.tieOut ? '<tied type="start"/>' : ""}</notations>` : "";
    lines.push(`      <note>${i > 0 ? "<chord/>" : ""}${pitchXml(n)}${common}${tail(accidental + notations)}</note>`);
  });
  return lines;
}

function pitchXml(n: SpelledNote): string {
  return `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ""}<octave>${n.octave}</octave></pitch>`;
}

function harmonyXml(chord: Parameters<typeof chordKind>[0], spell: Segment["spell"]): string {
  const { root, suffix, bass } = chordParts(chord, spell);
  const { kind, degrees } = chordKind(chord);
  const step = (name: string, tag: string) => {
    const p = parseNoteName(name);
    return `<${tag}-step>${"CDEFGAB"[p.letter]}</${tag}-step>${p.alter ? `<${tag}-alter>${p.alter}</${tag}-alter>` : ""}`;
  };
  const parts = [`<root>${step(root, "root")}</root>`, `<kind text="${esc(suffix)}">${kind}</kind>`];
  if (bass) parts.push(`<bass>${step(bass, "bass")}</bass>`);
  for (const d of degrees) parts.push(`<degree><degree-value>${d.value}</degree-value><degree-alter>${d.alter}</degree-alter><degree-type>${d.type}</degree-type></degree>`);
  return `      <harmony>${parts.join("")}</harmony>`;
}
