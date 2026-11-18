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
}));

import { selectBlock, useStore } from "../state/store";
import { Progression } from "./Progression/Progression";

const chords = () => selectBlock(useStore.getState())!.chords;

function setup(n = 3) {
  const s = useStore.getState();
  act(() => {
    s.setTonic(0);
    useStore.getState().setStartWithSelected(true);
    useStore.getState().clearBlock();
    for (let i = 0; i < n; i++) useStore.getState().addChord(i % 2 ? 7 : 0, "maj");
  });
}

beforeEach(() => {
  useStore.getState().newSong();
  useStore.getState().setGrid(1);
});
afterEach(cleanup);

describe("progressão", () => {
  it("trocar a grade pelo select muda grid", () => {
    render(<Progression />);
    fireEvent.change(screen.getByLabelText("Grade de edição"), { target: { value: "2" } });
    expect(useStore.getState().grid).toBe(2);
    fireEvent.change(screen.getByLabelText("Grade de edição"), { target: { value: "bar" } });
    expect(useStore.getState().grid).toBe("bar");
  });

  it("com grade 2, + leva 4 → 6 em um único passo de desfazer", () => {
    setup(1);
    act(() => useStore.getState().setDuration(chords()[0].id, 4));
    act(() => useStore.getState().setGrid(2));
    render(<Progression />);
    const before = useStore.getState().past.length;
    fireEvent.click(screen.getAllByLabelText("Aumentar duração")[0]);
    expect(chords()[0].duration).toBe(6);
    expect(useStore.getState().past.length).toBe(before + 1);
  });

  it("teclado na alça aumenta a duração pela grade", () => {
    setup(1);
    act(() => useStore.getState().setDuration(chords()[0].id, 4));
    render(<Progression />);
    const handle = screen.getAllByRole("slider")[0];
    expect(handle.getAttribute("aria-valuenow")).toBe("4");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(chords()[0].duration).toBe(5);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(chords()[0].duration).toBe(4);
  });

  it("Shift+clique define a região e ✕ desfaz", () => {
    setup(4);
    const ids = chords().map((c) => c.id);
    act(() => useStore.getState().selectChord(ids[1]));
    render(<Progression />);
    const cards = screen.getAllByRole("listitem");
    fireEvent.click(cards[3], { shiftKey: true });
    expect(useStore.getState().regionEnd).toBe(ids[3]);
    expect(cards.map((c) => c.classList.contains("in-region"))).toEqual([false, true, true, true]);
    expect(screen.getByText(/Região: acordes 2–4/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Desfazer região"));
    expect(useStore.getState().regionEnd).toBeNull();
    expect(screen.queryByText(/Região:/)).toBeNull();
  });

  it("acorde que atravessa a barra mostra a ligadura", () => {
    setup(2);
    const ids = chords().map((c) => c.id);
    act(() => {
      useStore.getState().setDuration(ids[0], 2);
      useStore.getState().setDuration(ids[1], 4);
    });
    render(<Progression />);
    const cards = screen.getAllByRole("listitem");
    expect(cards[0].classList.contains("crosses-bar")).toBe(false);
    expect(cards[1].classList.contains("crosses-bar")).toBe(true);
    expect(cards[1].querySelector(".tie")?.getAttribute("title")).toBe("Atravessa a barra de compasso");
  });

  describe("teclado", () => {
    it("Enter seleciona e Shift+Enter estende a região", () => {
      setup(4);
      const ids = chords().map((c) => c.id);
      render(<Progression />);
      const cards = screen.getAllByRole("listitem");
      fireEvent.keyDown(cards[1], { key: "Enter" });
      expect(useStore.getState().selectedChord).toBe(ids[1]);
      fireEvent.keyDown(cards[3], { key: "Enter", shiftKey: true });
      expect(useStore.getState().regionEnd).toBe(ids[3]);
    });

    it("Alt+→ move o acorde e mantém o foco nele", () => {
      setup(3);
      const ids = chords().map((c) => c.id);
      render(<Progression />);
      const card = screen.getAllByRole("listitem")[0];
      card.focus();
      fireEvent.keyDown(card, { key: "ArrowRight", altKey: true });
      expect(chords().map((c) => c.id)).toEqual([ids[1], ids[0], ids[2]]);
      expect((document.activeElement as HTMLElement).dataset.chordId).toBe(ids[0]);
      expect(screen.getByText(/movido para a posição 2 de 3/)).toBeTruthy();
    });

    it("→ move só o foco", () => {
      setup(3);
      const ids = chords().map((c) => c.id);
      render(<Progression />);
      const cards = screen.getAllByRole("listitem");
      cards[0].focus();
      fireEvent.keyDown(cards[0], { key: "ArrowRight" });
      expect(document.activeElement).toBe(cards[1]);
      expect(chords().map((c) => c.id)).toEqual(ids);
    });

    it("Enter num botão interno não seleciona o card", () => {
      setup(2);
      act(() => useStore.getState().selectChord(chords()[0].id));
      render(<Progression />);
      fireEvent.keyDown(screen.getAllByLabelText("Aumentar duração")[1], { key: "Enter" });
      expect(useStore.getState().selectedChord).toBe(chords()[0].id);
    });
  });
});
