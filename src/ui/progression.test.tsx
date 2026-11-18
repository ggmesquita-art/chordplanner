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
import { ModifierPanel } from "./ModifierPanel/ModifierPanel";
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
    expect(cards[1].getAttribute("title")).toContain("Atravessa a barra de compasso");
    expect(cards[0].getAttribute("title")).not.toContain("Atravessa");
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

describe("alça, teclas e camadas de Esc", () => {
  it("a alça deixa Ctrl+Z e Espaço chegarem ao window, mas segura Delete", () => {
    setup(2);
    render(<Progression />);
    const seen: string[] = [];
    const on = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", on);
    const handle = screen.getAllByRole("slider")[0];
    fireEvent.keyDown(handle, { key: "z", ctrlKey: true });
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "Delete" });
    window.removeEventListener("keydown", on);
    expect(seen).toEqual(["z", " "]);
    expect(chords()).toHaveLength(2);
    expect(handle.getAttribute("aria-valuemin")).toBe("0.5");
  });

  it("− fica desabilitado quando a duração já é o mínimo da grade", () => {
    setup(1);
    act(() => useStore.getState().setDuration(chords()[0].id, 1));
    render(<Progression />);
    expect((screen.getByLabelText("Diminuir duração") as HTMLButtonElement).disabled).toBe(true);
    act(() => useStore.getState().setDuration(chords()[0].id, 4));
    expect((screen.getByLabelText("Diminuir duração") as HTMLButtonElement).disabled).toBe(false);
  });

  it("arraste: só o card redimensionado perde o draggable; Esc global cancela; botão direito é ignorado", () => {
    setup(2);
    render(<Progression />);
    const cards = screen.getAllByRole("listitem");
    const handle = screen.getAllByRole("slider")[0];
    handle.parentElement!.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
    fireEvent.pointerDown(handle, { button: 2, pointerType: "mouse" });
    expect(cards[0].getAttribute("draggable")).toBe("true");
    fireEvent.pointerDown(handle, { button: 0, pointerType: "mouse" });
    expect(cards[0].getAttribute("draggable")).toBe("false");
    expect(cards[1].getAttribute("draggable")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(cards[0].getAttribute("draggable")).toBe("true");
  });

  it("desmontar no meio do arraste não deixa o estado preso", () => {
    setup(2);
    render(<Progression />);
    const handle = screen.getAllByRole("slider")[0];
    handle.parentElement!.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
    fireEvent.pointerDown(handle, { button: 0, pointerType: "mouse" });
    act(() => useStore.getState().removeChord(chords()[0].id));
    for (const c of screen.getAllByRole("listitem")) expect(c.getAttribute("draggable")).toBe("true");
  });

  it("com a gaveta e o modal abertos, um Esc fecha só o modal", () => {
    setup(2);
    render(
      <>
        <Progression />
        <ModifierPanel />
      </>,
    );
    act(() => useStore.getState().selectChord(chords()[0].id));
    expect(screen.getByLabelText("Recolher modificadores")).toBeTruthy();
    fireEvent.click(screen.getByText(/Exportar cifra/));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Recolher modificadores")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByLabelText("Expandir modificadores")).toBeTruthy();
  });
});

describe("casa 2", () => {
  const block = () => selectBlock(useStore.getState())!;

  it("+ Casa 2 entra no modo, a roda adiciona à casa 2 e dá para alternar e remover", () => {
    setup(2);
    render(<Progression />);
    fireEvent.click(screen.getByText("+ Casa 2"));
    expect(useStore.getState().editEnding).toBe(true);
    expect(screen.getByText(/Casa 2 — substitui o último compasso/)).toBeTruthy();
    act(() => useStore.getState().addChord(5, "maj"));
    expect(block().ending).toHaveLength(1);
    expect(chords()).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Acordes" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Casa 2" }));
    fireEvent.click(screen.getByText("Remover casa 2"));
    expect(block().ending).toBeUndefined();
    expect(useStore.getState().editEnding).toBe(false);
  });

  it("com ×2 no arranjo o controle segmentado aparece em vez do botão", () => {
    setup(2);
    act(() => useStore.getState().setRepeat(0, 2));
    render(<Progression />);
    expect(screen.queryByText("+ Casa 2")).toBeNull();
    expect(screen.getByRole("button", { name: "Casa 2" })).toBeTruthy();
  });
});
