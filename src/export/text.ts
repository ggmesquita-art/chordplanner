// Export de cifra por seção (DESIGN §6).

import { chordSymbol } from "../core/modifiers";
import type { Speller } from "../core/pitch";
import { getScale } from "../core/scales";
import { blockBpm, blockMeter, endingCut, type Block, type Song } from "../core/song";
import { meterLabel } from "../core/timeline";

/** Uma célula por compasso; acordes que dividem o compasso ficam juntos, repetição vira `%`. */
function barsOf(chords: { symbol: string; beats: number }[], beatsPerBar: number): string[] {
  const bars: string[][] = [];
  let pos = 0;
  for (const c of chords) {
    let remaining = c.beats;
    let first = true;
    while (remaining > 0) {
      const barIndex = Math.floor(pos / beatsPerBar);
      const room = beatsPerBar - (pos % beatsPerBar);
      const take = Math.min(room, remaining);
      (bars[barIndex] ??= []).push(first ? c.symbol : "");
      first = false;
      pos += take;
      remaining -= take;
    }
  }
  return bars.map((cell) => {
    const named = cell.filter(Boolean);
    return named.length ? named.join(" ") : "%";
  });
}

/** Tonalidade própria do bloco para o cabeçalho: "E dórico" (nome da escala sem a parte entre parênteses). */
function keyLabel(block: Block, spell: Speller): string {
  if (!block.key) return "";
  const name = getScale(block.key.scaleId).name.replace(/\s*\(.*\)\s*/g, "").trim();
  return `${spell(block.key.tonic)} ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/**
 * Cifra por seção. Com casa 2 e ×2 ou mais, a instância sai em notação de repetição:
 * `|: C | F | G | 1. C :| 2. Am |` (casa 1 = último compasso original; casa 2 = `ending`).
 * `spellFor` dá a grafia de cada bloco (tonalidade própria).
 */
export function songToText(song: Song, spellFor: (block: Block) => Speller): string {
  const lines: string[] = [];
  let lastTempo = "";
  for (const item of song.arrangement) {
    const block = song.blocks[item.blockId];
    if (!block) continue;
    const spell = spellFor(block);
    const meter = blockMeter(song, block);
    const tempo = `${meterLabel(meter)} ♩=${blockBpm(song, block)}`;
    const key = keyLabel(block, spell);
    const header = `[${block.name}${item.repeat > 1 ? ` ×${item.repeat}` : ""}]`;
    const tail = key ? `${tempo}  (${key})` : tempo;
    lines.push(tempo !== lastTempo || key ? `${header}  ${tail}` : header);
    lastTempo = tempo;
    const cells = (chords: Block["chords"]) => barsOf(chords.map((c) => ({ symbol: chordSymbol(c, spell), beats: c.duration })), meter[0]);
    const bars = cells(block.chords);
    if (block.ending?.length && item.repeat > 1 && bars.length) {
      const k = endingCut(block, meter) / meter[0];
      const head = bars.slice(0, k);
      const house1 = `1. ${bars.slice(k).join(" | ")}`;
      lines.push(`|: ${[...head, house1].join(" | ")} :| 2. ${cells(block.ending).join(" | ")} |`);
      continue;
    }
    lines.push(bars.length ? `| ${bars.join(" | ")} |` : "| (vazio) |");
  }
  return lines.join("\n");
}
