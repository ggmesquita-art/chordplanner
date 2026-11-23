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
  liveNoteOn: vi.fn(),
  liveNoteOff: vi.fn(),
  liveAllOff: vi.fn(),
  disposeInstrument: vi.fn(),
}));

import { selectBlock, useStore } from "../state/store";
import { ChordWheel, DegreeStrip } from "./ChordWheel/ChordWheel";
import { Progression } from "./Progression/Progression";

beforeEach(() => {
  const st = useStore.getState();
  st.newSong();
  st.setMode("colorful");
  st.setTonic(0); // Dó maior
  st.addChord(0, "maj"); // com a tônica já na progressão
});
afterEach(cleanup);

describe("função harmônica no card", () => {
  it("mostra T, SD e D conforme o acorde", () => {
    act(() => {
      useStore.getState().addChord(5, "maj");
      useStore.getState().addChord(7, "maj");
    });
    const { container } = render(<Progression />);
    const badges = Array.from(container.querySelectorAll(".chord-card .fn-badge"));
    expect(badges.map((b) => b.textContent)).toEqual(["T", "SD", "D"]);
    expect(badges.map((b) => b.getAttribute("title"))).toEqual(["Tônica", "Subdominante", "Dominante"]);
  });

  it("sem badge quando a função é nula (acorde fora da escala)", () => {
    act(() => void useStore.getState().addChord(6, "maj")); // F♯ maior em Dó maior
    const { container } = render(<Progression />);
    expect(container.querySelectorAll(".chord-card .fn-badge")).toHaveLength(1);
  });
});

describe("sugestões na roda", () => {
  it("o checkbox liga e desliga os pontinhos", () => {
    const { container } = render(<ChordWheel />);
    expect(container.querySelectorAll(".suggest-dot").length).toBeGreaterThan(0);
    expect(container.querySelector(".suggest-dot title")?.textContent).toMatch(/^Sugestão: /);
    fireEvent.click(screen.getByLabelText("Sugestões"));
    expect(container.querySelectorAll(".suggest-dot")).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("Sugestões"));
    expect(container.querySelectorAll(".suggest-dot").length).toBeGreaterThan(0);
  });

  it("depois de Dm a fatia de Sol maior é a mais opaca", () => {
    act(() => void useStore.getState().addChord(2, "m"));
    const { container } = render(<ChordWheel />);
    const dots = Array.from(container.querySelectorAll(".suggest-dot"));
    const best = dots.reduce((a, b) => (Number(b.getAttribute("opacity")) > Number(a.getAttribute("opacity")) ? b : a));
    expect(best.querySelector("title")?.textContent).toBe("Sugestão: ii–V–I");
    expect(best.closest(".slice")?.getAttribute("aria-label")).toMatch(/^Sol maior/);
  });
});

describe("sugestões na roda: modo e casa 2", () => {
  it("no Estrito não há ponto em fatia bloqueada (♭VII depois de ♭VI só no Colorido)", () => {
    act(() => {
      const st = useStore.getState();
      st.removeChord(selectBlock(st)!.chords[0].id);
      useStore.getState().addChord(8, "maj");
    });
    const { container, rerender } = render(<ChordWheel />);
    const colorful = container.querySelectorAll(".suggest-dot").length;
    expect(Array.from(container.querySelectorAll(".suggest-dot")).some((d) => !d.closest(".slice")?.classList.contains("can"))).toBe(false);
    act(() => useStore.getState().setMode("strict"));
    rerender(<ChordWheel />);
    expect(container.querySelectorAll(".suggest-dot").length).toBeLessThan(colorful);
    for (const dot of container.querySelectorAll(".suggest-dot")) expect(dot.closest(".slice")?.classList.contains("can")).toBe(true);
  });

  it("na casa 2 o histórico vem dos acordes da casa 2", () => {
    act(() => useStore.getState().setEditEnding(true));
    const { container } = render(<ChordWheel />);
    // Casa 2 vazia = início de progressão: sugere a tônica (com os acordes do bloco, não sugeriria Dó maior).
    const dots = Array.from(container.querySelectorAll(".suggest-dot title")).map((t) => t.textContent);
    expect(dots).toContain("Sugestão: tônica");
  });
});

describe("sétimas na lista por graus", () => {
  it("um único desfazer remove o acorde com sétima inteiro", () => {
    render(<DegreeStrip />);
    fireEvent.click(screen.getByText("G7"));
    act(() => useStore.getState().undo());
    expect(selectBlock(useStore.getState())!.chords.map((c) => c.root)).toEqual([0]);
  });

  it("clicar no chip G7 adiciona o acorde com o modificador 7", () => {
    render(<DegreeStrip />);
    fireEvent.click(screen.getByText("G7"));
    const chords = selectBlock(useStore.getState())!.chords;
    const last = chords[chords.length - 1];
    expect(last).toMatchObject({ root: 7, quality: "maj", modifiers: [{ kind: "ext", value: 7 }] });
  });
});
