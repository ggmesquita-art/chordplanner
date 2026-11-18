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

import { play } from "../audio/engine";
import { selectBlock, useStore } from "../state/store";
import { togglePlay } from "./hooks";
import { Transport } from "./Transport/Transport";

function withChords() {
  const s = useStore.getState();
  for (const root of [0, 5, 7, 9]) s.addChord(root, "maj");
}

beforeEach(() => {
  useStore.getState().newSong();
  vi.mocked(play).mockClear();
});
afterEach(cleanup);

const regionButton = () => screen.getByRole("radio", { name: "Região" }) as HTMLButtonElement;

describe("escopo Região", () => {
  it("fica desabilitado sem região", () => {
    render(<Transport />);
    expect(regionButton().disabled).toBe(true);
  });

  it("com região, habilita e clicar define o escopo", () => {
    withChords();
    const chords = selectBlock(useStore.getState())!.chords;
    render(<Transport />);
    act(() => {
      useStore.getState().selectChord(chords[1].id);
      useStore.getState().setRegionEnd(chords[2].id);
    });
    expect(regionButton().disabled).toBe(false);
    fireEvent.click(regionButton());
    expect(useStore.getState().playScope).toBe("region");
  });

  it("togglePlay toca só os acordes da região", async () => {
    withChords();
    const chords = selectBlock(useStore.getState())!.chords;
    act(() => {
      useStore.getState().selectChord(chords[1].id);
      useStore.getState().setRegionEnd(chords[2].id);
      useStore.getState().setPlayScope("region");
    });
    await togglePlay();
    const expanded = vi.mocked(play).mock.calls[0][0];
    expect(expanded.events.map((e) => e.chordIndex)).toEqual([1, 2]);
    act(() => useStore.getState().setPlaying(false));
  });

  const arrowFromBlock = () => {
    const block = screen.getByRole("radio", { name: "Bloco" });
    fireEvent.click(block);
    block.focus();
    fireEvent.keyDown(block, { key: "ArrowRight" });
  };

  it("→ a partir de Bloco seleciona Região quando há região", () => {
    withChords();
    const chords = selectBlock(useStore.getState())!.chords;
    render(<Transport />);
    act(() => {
      useStore.getState().selectChord(chords[1].id);
      useStore.getState().setRegionEnd(chords[2].id);
    });
    arrowFromBlock();
    expect(useStore.getState().playScope).toBe("region");
    expect(document.activeElement).toBe(regionButton());
  });

  it("→ a partir de Bloco pula Região desabilitada e vai para Arranjo", () => {
    render(<Transport />);
    arrowFromBlock();
    expect(useStore.getState().playScope).toBe("song");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Arranjo" }));
  });
});
