// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
  disposeInstrument: vi.fn(),
}));

import { selectBlock, useStore } from "../state/store";
import { ChordWheel } from "./ChordWheel/ChordWheel";

beforeEach(() => {
  const st = useStore.getState();
  st.newSong();
  st.setMode("colorful");
  st.setTonic(0); // Dó maior (escala "major"), com o acorde da tônica já na progressão
});
afterEach(cleanup);

const slices = () => screen.getAllByRole("button").filter((b) => b.classList.contains("slice"));
const slice = (prefix: string) => {
  const el = slices().find((b) => b.getAttribute("aria-label")?.startsWith(prefix));
  if (!el) throw new Error(`fatia não encontrada: ${prefix}`);
  return el;
};
const enabledLabels = () => slices().filter((b) => b.getAttribute("aria-disabled") === "false").map((b) => b.getAttribute("aria-label")!);
/** Só o acorde falado ("Dó maior"), sem grau/estado. */
const chordsOf = (labels: string[]) => labels.map((l) => l.split(",")[0]);

describe("Roda: navegação por teclado (DESIGN §8)", () => {
  it("setas laterais percorrem o anel pelo círculo de quintas; cima/baixo trocam de anel", () => {
    render(<ChordWheel />);
    const c = slice("Dó maior");
    c.focus();
    expect(document.activeElement).toBe(c);

    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(document.activeElement).toBe(slice("Sol maior"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(slice("Fá maior"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(c);

    // Anel interno (menores): na mesma posição do círculo fica o relativo menor (Lá menor sob Dó).
    fireEvent.keyDown(c, { key: "ArrowDown" });
    expect(document.activeElement).toBe(slice("Lá menor"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(slice("Si diminuto"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(c);
  });

  it("Enter na fatia focada adiciona o acorde (fundamental/qualidade) à progressão", async () => {
    render(<ChordWheel />);
    expect(selectBlock(useStore.getState())!.chords.map((x) => [x.root, x.quality])).toEqual([[0, "maj"]]);

    const c = slice("Dó maior");
    c.focus();
    fireEvent.keyDown(c, { key: "ArrowRight" }); // Sol maior
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Enter" }));
    expect(selectBlock(useStore.getState())!.chords.map((x) => [x.root, x.quality])).toEqual([
      [0, "maj"],
      [7, "maj"],
    ]);

    // Anel dos menores: Lá menor (sob Dó).
    fireEvent.keyDown(slice("Dó maior"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(slice("Lá menor"));
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Enter" }));
    const last = selectBlock(useStore.getState())!.chords.at(-1)!;
    expect([last.root, last.quality]).toEqual([9, "m"]);
  });

  it("Enter numa fatia desabilitada (modo Estrito, fora da escala) não adiciona nada", async () => {
    useStore.getState().setMode("strict");
    render(<ChordWheel />);
    const before = selectBlock(useStore.getState())!.chords.length;
    const fs = slice("Fá sustenido maior");
    expect(fs.getAttribute("aria-disabled")).toBe("true");
    await act(async () => fireEvent.keyDown(fs, { key: "Enter" }));
    expect(selectBlock(useStore.getState())!.chords.length).toBe(before);
  });
});

describe("Roda: quais fatias são habilitadas em Dó maior", () => {
  const DIATONIC = ["Dó maior", "Ré menor", "Mi menor", "Fá maior", "Sol maior", "Lá menor", "Si diminuto"];

  it("Estrito: exatamente C, Dm, Em, F, G, Am e B°", () => {
    useStore.getState().setMode("strict");
    render(<ChordWheel />);
    const got = chordsOf(enabledLabels());
    expect(got.length).toBe(7);
    expect([...got].sort()).toEqual([...DIATONIC].sort());
  });

  it("Colorido: os 7 diatônicos + dominantes secundários e empréstimos; Fá♯ maior segue desabilitado", () => {
    render(<ChordWheel />);
    const got = chordsOf(enabledLabels());
    for (const d of DIATONIC) expect(got).toContain(d);
    expect(got.length).toBeGreaterThan(7);

    // Dominante secundária: Ré maior = V/V.
    const d = slice("Ré maior");
    expect(d.getAttribute("aria-disabled")).toBe("false");
    expect(d.getAttribute("aria-label")).toContain("dominante secundária");
    // Dominante secundária: Mi maior = V/vi.
    const e = slice("Mi maior");
    expect(e.getAttribute("aria-disabled")).toBe("false");
    expect(e.getAttribute("aria-label")).toContain("dominante secundária");
    // Empréstimo modal: Si bemol maior = ♭VII.
    const bb = slice("Si bemol maior");
    expect(bb.getAttribute("aria-disabled")).toBe("false");
    expect(bb.getAttribute("aria-label")).toContain("empréstimo modal");

    // Claramente fora: Fá sustenido maior.
    expect(slice("Fá sustenido maior").getAttribute("aria-disabled")).toBe("true");
    expect(got).not.toContain("Fá sustenido maior");
  });
});
