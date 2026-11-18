// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { selectChord, useStore } from "../state/store";
import { ModifierPanel } from "./ModifierPanel/ModifierPanel";

beforeEach(() => {
  const s = useStore.getState();
  s.newSong();
  s.setTonic(0);
  s.setMode("free");
  s.addChord(0, "maj");
  s.selectChord(selectChord(useStore.getState())!.id);
  s.setInstrumentView("guitar");
});
afterEach(cleanup);

describe("visualização Violão", () => {
  it("mostra o diagrama com a digitação do acorde selecionado", () => {
    render(<ModifierPanel />);
    expect(screen.getByRole("img", { name: "Violão: x32010 — C" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Mini-teclado/ })).toBeNull();
  });

  it("atualiza ao mudar modificadores", () => {
    render(<ModifierPanel />);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.replace(/[✓◐⚠]/g, "").trim() === "maj7")!);
    expect(screen.getByRole("img", { name: /^Violão: x32000 — Cmaj7$/ })).toBeTruthy();
  });

  it("alternar para Teclado mostra o mini-teclado e guarda a preferência", () => {
    render(<ModifierPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Teclado" }));
    expect(screen.getByRole("img", { name: /Mini-teclado/ })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Violão/ })).toBeNull();
    expect(useStore.getState().instrumentView).toBe("keyboard");
    fireEvent.click(screen.getByRole("radio", { name: "Violão" }));
    expect(useStore.getState().instrumentView).toBe("guitar");
  });
});
