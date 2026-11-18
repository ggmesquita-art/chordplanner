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

import App from "../App";
import { selectBlock, useStore } from "../state/store";
import { BlockKey } from "./Progression/BlockKey";

beforeEach(() => {
  useStore.getState().newSong();
  useStore.getState().setTonic(0); // Dó jônio
});
afterEach(cleanup);

const blockId = () => selectBlock(useStore.getState())!.id;
const key = () => selectBlock(useStore.getState())!.key;

describe("modulação por bloco", () => {
  it("liga, troca tônica/escala e desliga", () => {
    render(<BlockKey blockId={blockId()} />);
    fireEvent.click(screen.getByLabelText("Modular"));
    expect(key()).toEqual({ tonic: 0, scaleId: "major" });
    fireEvent.change(screen.getByLabelText("Tônica do bloco"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Escala do bloco"), { target: { value: "dorian" } });
    expect(key()).toEqual({ tonic: 4, scaleId: "dorian" });
    fireEvent.click(screen.getByLabelText("Modular"));
    expect(key()).toBeUndefined();
  });

  it("sem tônica global o toggle fica desabilitado", () => {
    useStore.getState().newSong();
    render(<BlockKey blockId={blockId()} />);
    expect((screen.getByLabelText("Modular") as HTMLInputElement).disabled).toBe(true);
  });

  it("a roda, o centro, o cabeçalho e o card seguem o tom do bloco", async () => {
    render(<App />);
    expect(screen.queryByText("modulação")).toBeNull();
    act(() => useStore.getState().setBlockProps(blockId(), { key: { tonic: 4, scaleId: "dorian" } }));
    const fsm = screen.getAllByRole("button").find((el) => el.getAttribute("aria-label")?.startsWith("Fá sustenido menor"))!;
    expect(fsm.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText("modulação")).toBeTruthy();
    expect(screen.getAllByText("Dórico").length).toBeGreaterThan(0);
    expect(screen.getByRole("listitem", { name: /em E Dórico|em Mi Dórico/ })).toBeTruthy();
    expect(screen.getAllByText(/Dórico/).some((el) => el.classList.contains("key-badge"))).toBe(true);
    expect(document.querySelector(".key-notice")!.textContent).toMatch(/Bloco .* em .*Dórico/);
  });
});
