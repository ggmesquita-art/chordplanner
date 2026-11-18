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

import { previewNotes, stop } from "../audio/engine";
import App from "../App";
import { useStore } from "../state/store";
import { Practice } from "./Practice/Practice";

beforeEach(() => {
  useStore.getState().newSong();
  vi.mocked(previewNotes).mockClear();
  vi.mocked(stop).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const setKeyC = () => act(() => useStore.getState().setKey(0, "major"));

describe("Modo prática", () => {
  it("abre pelo botão e fecha com Esc chamando stop", () => {
    render(<App />);
    fireEvent.click(screen.getByText("🎧 Prática"));
    const dlg = screen.getByRole("dialog", { name: "Modo prática" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    vi.mocked(stop).mockClear();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Modo prática" })).toBeNull();
    expect(stop).toHaveBeenCalled();
  });

  it("sem tônica mostra a mensagem", () => {
    render(<Practice onClose={() => {}} />);
    expect(screen.getByText("Defina a tônica para praticar")).toBeTruthy();
    expect(screen.queryByText("▶ Ouvir")).toBeNull();
  });

  it("▶ Ouvir toca cadência + alvo espaçados", () => {
    vi.useFakeTimers();
    setKeyC();
    render(<Practice onClose={() => {}} />);
    fireEvent.click(screen.getByText("▶ Ouvir"));
    act(() => void vi.advanceTimersByTime(0));
    expect(previewNotes).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(5000));
    expect(previewNotes).toHaveBeenCalledTimes(5);
  });

  it("responder certo incrementa o placar; errado zera a sequência", () => {
    setKeyC();
    vi.spyOn(Math, "random").mockReturnValue(0); // alvo = I
    render(<Practice onClose={() => {}} />);
    const answers = screen.getByRole("group", { name: "Resposta" });
    expect(screen.getByLabelText("Placar").textContent).toBe("Acertos 0/0 · sequência 0");
    fireEvent.click(answers.querySelectorAll("button")[0]); // I
    expect(screen.getByLabelText("Placar").textContent).toBe("Acertos 1/1 · sequência 1");
    expect(screen.getByRole("status").textContent).toBe("✓ Isso: I");
    fireEvent.click(screen.getByText("Próxima"));
    // próxima nunca repete I; com rng 0 sai o primeiro restante (IV)
    fireEvent.click(answers.querySelectorAll("button")[0]);
    expect(screen.getByRole("status").textContent).toBe("✗ Era IV — você marcou I");
    expect(screen.getByLabelText("Placar").textContent).toBe("Acertos 1/2 · sequência 0");
  });

  it("teclas 1–7 respondem; Espaço ouve sem disparar o play global", () => {
    vi.useFakeTimers();
    setKeyC();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<App />);
    fireEvent.click(screen.getByText("🎧 Prática"));
    const dlg = screen.getByRole("dialog");
    fireEvent.keyDown(dlg, { key: "1" });
    expect(screen.getByLabelText("Placar").textContent).toBe("Acertos 1/1 · sequência 1");
    vi.mocked(previewNotes).mockClear();
    fireEvent.keyDown(dlg, { key: " ", code: "Space" });
    act(() => void vi.advanceTimersByTime(5000));
    expect(previewNotes).toHaveBeenCalledTimes(5);
    expect(useStore.getState().playing).toBe(false);
  });
});
