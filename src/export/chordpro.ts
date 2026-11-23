// Export ChordPro (cifra em texto: OnSong, SongbookPro, ForScore…). Um bloco por seção
// `{start_of_verse: Nome}…{end_of_verse}`; cada compasso tem uma casa por tempo:
// `[C]` = acorde que começa ali, `.` = acorde continua (inclusive através da barra), `.~[G]` = acorde no meio do tempo.
// Repetições NÃO são expandidas: `×N` no nome da seção e `|: … :|`; a casa 2 sai como `1. … :| 2. …` (como o export de texto).

import { isRest, makeRest } from "../core/chords";
import { melodyEndBeat } from "../core/melody";
import { chordParts, keySignature, resolveNotation, splitBars, toAscii, type Bar, type KeyInfo } from "../core/notation";
import type { Speller } from "../core/pitch";
import { blockBpm, blockChordBeats, blockMeter, endingCut, type Block, type Song } from "../core/song";
import { meterLabel } from "../core/timeline";

export type ChordProOptions = {
  title?: string;
  /** Tonalidade efetiva do bloco (própria ou global). Padrão: `block.key`. */
  keyFor?: (block: Block) => KeyInfo | null;
};

const BARS_PER_LINE = 4;
const EPS = 1e-6;

/** Valor de `{key:}`: tônica ASCII, com "m" nas tonalidades menores. */
function keyValue(key: KeyInfo | null, spell: Speller): string | null {
  if (!key) return null;
  const sig = keySignature(key, spell);
  return toAscii(spell(key.tonic)) + (sig.mode === "minor" ? "m" : "");
}

function barText(bar: Bar, perBar: number, spell: Speller): string {
  const cells: string[] = [];
  for (let k = 0; k < perBar; k++) {
    const starts = bar.pieces.filter((p) => p.first && p.start >= k - EPS && p.start < k + 1 - EPS);
    if (!starts.length) {
      if (k === 0 && bar.pieces.some((p) => !p.first && p.start < EPS && isRest(p.ref.chord))) {
        cells.push("[N.C.]");
      } else {
        cells.push(".");
      }
      continue;
    }
    const tokens = starts.map((p) => {
      if (isRest(p.ref.chord)) return "[N.C.]";
      const { root, suffix, bass } = chordParts(p.ref.chord, spell);
      return `[${toAscii(root + suffix + (bass ? `/${bass}` : ""))}]`;
    });
    cells.push((starts[0].start > k + EPS ? ".~" : "") + tokens.join("~"));
  }
  return cells.join(" ");
}

export function songToChordPro(song: Song, spellFor?: (block: Block) => Speller, opts: ChordProOptions = {}): string {
  const nz = resolveNotation({ spellFor, keyFor: opts.keyFor, title: opts.title });
  // Chaves ou quebra de linha no nome fechariam a diretiva antes da hora.
  const out: string[] = [`{title: ${nz.title.replace(/[{}\r\n]+/g, " ").replace(/\s+/g, " ").trim()}}`];
  const items = song.arrangement.map((it) => ({ it, block: song.blocks[it.blockId] })).filter((x) => x.block);

  let lastKey: string | null = null;
  let lastTempo = "";
  let lastTime = "";
  items.forEach(({ it, block }) => {
    const spell = nz.spellFor(block);
    const meter = blockMeter(song, block);
    const key = keyValue(nz.keyFor(block), spell);
    const tempo = String(blockBpm(song, block));
    const time = meterLabel(meter);
    out.push("");
    if (key && key !== lastKey) out.push(`{key: ${key}}`);
    if (tempo !== lastTempo) out.push(`{tempo: ${tempo}}`);
    if (time !== lastTime) out.push(`{time: ${time}}`);
    lastKey = key ?? lastKey;
    lastTempo = tempo;
    lastTime = time;

    const repeated = it.repeat > 1;
    const name = `${block.name}${repeated ? ` ×${it.repeat}` : ""}`.replace(/[{}\r\n]+/g, " ");
    out.push(`{start_of_verse: ${name}}`);
    const perBar = meter[0];
    const asBars = (chords: Block["chords"]) =>
      splitBars(chords.map((chord) => ({ ref: { chord, voiced: [] }, beats: chord.duration })), perBar).map((b) => barText(b, perBar, spell));
    const chordsEnd = blockChordBeats(block);
    const melEnd = melodyEndBeat(block.melody);
    let chordsForBars = block.chords;
    if (melEnd > chordsEnd + EPS) {
      const targetBeats = Math.ceil((melEnd - EPS) / perBar) * perBar;
      if (targetBeats > chordsEnd + EPS) chordsForBars = [...block.chords, makeRest(targetBeats - chordsEnd)];
    }
    const bars = asBars(chordsForBars);
    if (!bars.length) {
      out.push("| (vazio) |", "{end_of_verse}");
      return;
    }
    type Cell = { text: string; sep: string };
    let cells: Cell[] = bars.map((text) => ({ text, sep: "|" }));
    if (block.ending?.length && repeated) {
      const k = endingCut(block, meter) / perBar;
      const ending = asBars(block.ending);
      cells = [
        ...bars.slice(0, k).map((text) => ({ text, sep: "|" })),
        ...bars.slice(k).map((text, i, rest) => ({ text: `${i === 0 ? "1. " : ""}${text}`, sep: i === rest.length - 1 ? ":|" : "|" })),
        ...ending.map((text, i) => ({ text: `${i === 0 ? "2. " : ""}${text}`, sep: "|" })),
      ];
    } else if (repeated) {
      cells[cells.length - 1].sep = ":|";
    }
    for (let i = 0; i < cells.length; i += BARS_PER_LINE) {
      const chunk = cells.slice(i, i + BARS_PER_LINE);
      out.push(`${i === 0 && repeated ? "|:" : "|"} ${chunk.map((c) => `${c.text} ${c.sep}`).join(" ")}`);
    }
    out.push("{end_of_verse}");
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
