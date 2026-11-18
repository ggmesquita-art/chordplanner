// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  disposeInstrument: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
}));

import { preload } from "../audio/engine";
import { selectBlock, useStore } from "../state/store";
import { BlockPlayback } from "./Progression/BlockPlayback";

const blockId = () => selectBlock(useStore.getState())!.id;
const block = () => selectBlock(useStore.getState())!;

beforeEach(() => useStore.getState().newSong());
afterEach(cleanup);

describe("BlockPlayback", () => {
  it("escolher o baixo e o ♩ final atualiza o bloco", () => {
    render(<BlockPlayback blockId={blockId()} />);
    fireEvent.change(screen.getByLabelText("Instrumento do baixo do bloco"), { target: { value: "contrabass-pizz" } });
    expect(block().bassInstrument).toBe("contrabass-pizz");
    expect(preload).toHaveBeenCalledWith("contrabass-pizz");
    fireEvent.change(screen.getByLabelText("Instrumento do baixo do bloco"), { target: { value: "" } });
    expect(block().bassInstrument).toBeUndefined();
    const ramp = screen.getByLabelText("BPM ao fim do bloco");
    fireEvent.change(ramp, { target: { value: "60" } });
    expect(block().rampTo).toBe(60);
    fireEvent.change(ramp, { target: { value: "" } });
    fireEvent.blur(ramp);
    expect(block().rampTo).toBeUndefined();
  });

  it("Bordão: desabilitado com piano, habilitado com sitar", () => {
    render(<BlockPlayback blockId={blockId()} />);
    const drone = screen.getByLabelText("Bordão do bloco") as HTMLInputElement;
    expect(drone.disabled).toBe(true);
    cleanup();
    useStore.getState().setBlockProps(blockId(), { instrument: "sitar" });
    render(<BlockPlayback blockId={blockId()} />);
    const on = screen.getByLabelText("Bordão do bloco") as HTMLInputElement;
    expect(on.disabled).toBe(false);
    fireEvent.click(on);
    expect(block().drone).toBe(true);
  });
});
