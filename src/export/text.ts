// Export de cifra por seção (DESIGN §6).

import { chordSymbol } from "../core/modifiers";
import type { Speller } from "../core/pitch";
import { blockBpm, blockMeter, type Song } from "../core/song";
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

export function songToText(song: Song, spell: Speller): string {
  const lines: string[] = [];
  let lastTempo = "";
  for (const item of song.arrangement) {
    const block = song.blocks[item.blockId];
    if (!block) continue;
    const meter = blockMeter(song, block);
    const tempo = `${meterLabel(meter)} ♩=${blockBpm(song, block)}`;
    const header = `[${block.name}${item.repeat > 1 ? ` ×${item.repeat}` : ""}]`;
    lines.push(tempo !== lastTempo ? `${header}  ${tempo}` : header);
    lastTempo = tempo;
    const bars = barsOf(block.chords.map((c) => ({ symbol: chordSymbol(c, spell), beats: c.duration })), meter[0]);
    lines.push(bars.length ? `| ${bars.join(" | ")} |` : "| (vazio) |");
  }
  return lines.join("\n");
}
