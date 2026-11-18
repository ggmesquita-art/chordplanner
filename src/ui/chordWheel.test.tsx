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
}));

import App from "../App";
import { previewNotes } from "../audio/engine";
import { makeChord } from "../core/chords";
import { useStore } from "../state/store";
import { sharedPitchClasses } from "./ChordWheel/shared";

beforeEach(() => {
  useStore.getState().newSong();
  vi.mocked(previewNotes).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const slice = (name: string) => screen.getAllByRole("button").find((el) => el.getAttribute("aria-label")?.startsWith(name))!;
const enter = (el: Element) => fireEvent.pointerEnter(el, { pointerType: "mouse" });

describe("lista por graus", () => {
  it("o checkbox esconde e mostra a faixa de graus", () => {
    act(() => useStore.getState().setTonic(0));
    const { container } = render(<App />);
    expect(container.querySelector(".degree-strip")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Lista por graus"));
    expect(useStore.getState().showDegrees).toBe(false);
    expect(container.querySelector(".degree-strip")).toBeNull();
    fireEvent.click(screen.getByLabelText("Lista por graus"));
    expect(useStore.getState().showDegrees).toBe(true);
    expect(container.querySelector(".degree-strip")).not.toBeNull();
  });
});

describe("som ao passar o mouse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => useStore.getState().setTonic(0));
  });

  it("desligado: nada toca", () => {
    render(<App />);
    enter(slice("Dó maior"));
    act(() => void vi.advanceTimersByTime(400));
    expect(previewNotes).not.toHaveBeenCalled();
  });

  it("ligado: toca uma vez após 250 ms e não repete na mesma fatia", () => {
    act(() => useStore.getState().setSoundOnHover(true));
    render(<App />);
    const el = slice("Dó maior");
    enter(el);
    act(() => void vi.advanceTimersByTime(249));
    expect(previewNotes).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(previewNotes).toHaveBeenCalledTimes(1);
    enter(el);
    act(() => void vi.advanceTimersByTime(400));
    expect(previewNotes).toHaveBeenCalledTimes(1);
  });

  it("sair antes do tempo cancela", () => {
    act(() => useStore.getState().setSoundOnHover(true));
    render(<App />);
    const el = slice("Dó maior");
    enter(el);
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerLeave(el, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(400));
    expect(previewNotes).not.toHaveBeenCalled();
  });

  it("não toca durante a reprodução nem com ponteiro que não é mouse", () => {
    act(() => useStore.getState().setSoundOnHover(true));
    render(<App />);
    fireEvent.pointerEnter(slice("Sol maior"), { pointerType: "touch" });
    act(() => void vi.advanceTimersByTime(400));
    act(() => useStore.setState({ playing: true }));
    enter(slice("Dó maior"));
    act(() => void vi.advanceTimersByTime(400));
    expect(previewNotes).not.toHaveBeenCalled();
    act(() => useStore.setState({ playing: false }));
  });
});

describe("menu radial de qualidades extras", () => {
  const badge = () => screen.getAllByRole("button").find((b) => /^\+\d+$/.test(b.textContent ?? ""))!;

  it("abre pelo badge, foca o primeiro item, setas circulam e Esc fecha devolvendo o foco", () => {
    act(() => useStore.getState().setTonic(0));
    render(<App />);
    const b = badge();
    expect(b).toBeTruthy();
    fireEvent.click(b);
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(menu.querySelector("button"));
    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(document.activeElement).toBe(menu.querySelectorAll("button")[1]);
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(Array.from(menu.querySelectorAll("button")).at(-1));
    expect(items.length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it("pointerdown fora fecha", () => {
    act(() => useStore.getState().setTonic(0));
    render(<App />);
    fireEvent.click(badge());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("notas em comum", () => {
  it("Dó maior vs Lá menor compartilham Dó e Mi", () => {
    const shared = sharedPitchClasses({ root: 0, quality: "maj" }, makeChord(9, "m"));
    expect([...shared].sort((a, b) => a - b)).toEqual([0, 4]);
  });
  it("sem acorde anterior ou hover: vazio", () => {
    expect(sharedPitchClasses(null, makeChord(9, "m")).size).toBe(0);
    expect(sharedPitchClasses({ root: 0, quality: "maj" }, null).size).toBe(0);
  });
});

describe("ponto de nota em comum", () => {
  it("aparece nas fatias cuja fundamental é comum (Dó, Mi), não em Lá menor", () => {
    act(() => {
      useStore.getState().setTonic(0);
      useStore.getState().addChord(9, "m");
    });
    render(<App />);
    fireEvent.mouseEnter(slice("Dó maior"));
    const dot = (name: string) => slice(name).querySelector(".shared-dot");
    for (const n of ["Dó maior", "Mi maior", "Dó menor", "Mi menor", "Dó diminuto", "Mi diminuto"]) expect(dot(n), n).not.toBeNull();
    for (const n of ["Lá menor", "Sol maior", "Lá maior", "Lá diminuto"]) expect(dot(n), n).toBeNull();
  });
});

describe("bloco com tonalidade própria e sem tônica global", () => {
  it("clicar numa fatia adiciona o acorde (não define a tônica)", () => {
    const st = useStore.getState();
    st.setBlockProps(st.song.blocks[st.song.arrangement[0].blockId].id, { key: { tonic: 0, scaleId: "major" } });
    render(<App />);
    expect(useStore.getState().tonic).toBeNull();
    fireEvent.click(slice("Sol maior"));
    expect(useStore.getState().tonic).toBeNull();
    const b = useStore.getState().song.blocks[useStore.getState().song.arrangement[0].blockId];
    expect(b.chords.map((c) => c.root)).toEqual([7]);
  });
});
