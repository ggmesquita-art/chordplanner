// Templates de forma (DESIGN §3.8): geram blocos a partir dos graus da escala.

import { makeChord, type Chord } from "./chords";
import type { ScaleContext } from "./diatonic";
import { mod12 } from "./pitch";
import { makeBlock, newId, type ArrangementItem, type Block } from "./song";

export type TemplateId = "pop" | "blues12" | "aaba" | "verse-chorus";

export const TEMPLATES: { id: TemplateId; name: string }[] = [
  { id: "verse-chorus", name: "Verso / Refrão simples" },
  { id: "pop", name: "Pop (V–R–V–R–P–R)" },
  { id: "blues12", name: "Blues de 12 compassos" },
  { id: "aaba", name: "AABA 32" },
];

function byDegrees(ctx: ScaleContext, degrees: number[], beats: number): Chord[] {
  const out: Chord[] = [];
  for (const d of degrees) {
    const deg = ctx.degrees[d % ctx.degrees.length];
    if (deg?.primary) out.push(makeChord(deg.root, deg.primary, beats));
  }
  return out;
}

const dom7 = (root: number, beats: number): Chord => ({ ...makeChord(root, "maj", beats), modifiers: [{ kind: "ext", value: 7 }] });

export function buildTemplate(id: TemplateId, ctx: ScaleContext, beatsPerBar: number): { blocks: Block[]; arrangement: ArrangementItem[] } {
  const bar = beatsPerBar;
  const item = (b: Block, repeat = 1): ArrangementItem => ({ id: newId("i"), blockId: b.id, repeat });

  switch (id) {
    case "blues12": {
      const t = ctx.tonic;
      const I = mod12(t);
      const IV = mod12(t + 5);
      const V = mod12(t + 7);
      const roots = [I, I, I, I, IV, IV, I, I, V, IV, I, V];
      const chords: Chord[] = [];
      for (const r of roots) {
        const last = chords[chords.length - 1];
        if (last && last.root === r) last.duration += bar;
        else chords.push(dom7(r, bar));
      }
      const blues = makeBlock("Blues", 0, chords);
      return { blocks: [blues], arrangement: [item(blues, 2)] };
    }
    case "aaba": {
      const a = makeBlock("A", 0, byDegrees(ctx, [0, 5, 1, 4, 0, 5, 1, 4], bar));
      const b = makeBlock("B (ponte)", 1, byDegrees(ctx, [3, 3, 0, 0, 1, 1, 4, 4], bar));
      return { blocks: [a, b], arrangement: [item(a, 2), item(b), item(a)] };
    }
    case "pop": {
      const v = makeBlock("Verso", 0, byDegrees(ctx, [0, 5, 3, 4], bar));
      const r = makeBlock("Refrão", 1, byDegrees(ctx, [3, 4, 0, 5], bar));
      const p = makeBlock("Ponte", 2, byDegrees(ctx, [5, 3, 1, 4], bar));
      return { blocks: [v, r, p], arrangement: [item(v, 2), item(r, 2), item(v), item(r, 2), item(p), item(r, 2)] };
    }
    case "verse-chorus":
    default: {
      const v = makeBlock("Verso", 0, byDegrees(ctx, [0, 3, 4, 0], bar));
      const r = makeBlock("Refrão", 1, byDegrees(ctx, [5, 3, 0, 4], bar));
      return { blocks: [v, r], arrangement: [item(v, 2), item(r, 2)] };
    }
  }
}
