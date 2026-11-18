import { describe, expect, it } from "vitest";
import { scaleContext } from "./diatonic";
import { blockBeats } from "./song";
import { buildTemplate, TEMPLATES } from "./templates";

describe("templates", () => {
  it("cada template em Dó maior gera arranjo não vazio com blockIds existentes", () => {
    const ctx = scaleContext(0, "major");
    for (const t of TEMPLATES) {
      const { blocks, arrangement } = buildTemplate(t.id, ctx, 4);
      const ids = new Set(blocks.map((b) => b.id));
      expect(arrangement.length, t.id).toBeGreaterThan(0);
      for (const it of arrangement) expect(ids.has(it.blockId), t.id).toBe(true);
      for (const b of blocks) expect(b.chords.length, `${t.id}/${b.name}`).toBeGreaterThan(0);
    }
  });

  it("Blues de 12 compassos tem 12 compassos e começa com I7", () => {
    const { blocks } = buildTemplate("blues12", scaleContext(0, "major"), 4);
    expect(blocks).toHaveLength(1);
    expect(blockBeats(blocks[0]) / 4).toBe(12);
    const first = blocks[0].chords[0];
    expect(first.root).toBe(0);
    expect(first.quality).toBe("maj");
    expect(first.modifiers).toEqual([{ kind: "ext", value: 7 }]);
  });

  it("em escala pentatônica nenhum template lança nem usa fundamental fora da escala", () => {
    const ctx = scaleContext(0, "major-pentatonic");
    for (const t of TEMPLATES) {
      const { blocks } = buildTemplate(t.id, ctx, 4);
      // O blues usa I–IV–V fixos (não depende dos graus da escala): só se exige que não lance.
      if (t.id === "blues12") continue;
      for (const b of blocks) for (const c of b.chords) expect(ctx.pcSet.has(c.root), `${t.id}/${b.name}: ${c.root}`).toBe(true);
    }
  });
});
