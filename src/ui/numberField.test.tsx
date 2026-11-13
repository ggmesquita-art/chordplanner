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
}));

import { selectBlock, useStore } from "../state/store";
import { Progression } from "./Progression/Progression";
import { Transport } from "./Transport/Transport";

beforeEach(() => useStore.getState().newSong());
afterEach(cleanup);

describe("campo de BPM", () => {
  it("digitar 120 não passa por clamp a cada tecla", () => {
    render(<Transport />);
    const input = screen.getByLabelText("BPM") as HTMLInputElement;
    for (const v of ["1", "12", "120"]) fireEvent.change(input, { target: { value: v } });
    expect(useStore.getState().song.bpm).toBe(120);
    expect(input.value).toBe("120");
  });

  it("sair do campo sem mudar o valor não cria passo no desfazer", () => {
    render(<Transport />);
    const input = screen.getByLabelText("BPM") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(useStore.getState().past.length).toBe(0);
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().past.length).toBe(1);
  });

  it("limita ao sair e restaura o valor se vazio", () => {
    render(<Transport />);
    const input = screen.getByLabelText("BPM") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.change(input, { target: { value: "999" } });
    expect(input.value).toBe("999");
    fireEvent.blur(input);
    expect(useStore.getState().song.bpm).toBe(300);
    expect(input.value).toBe("300");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(useStore.getState().song.bpm).toBe(300);
    expect(input.value).toBe("300");
  });

  it("acompanha mudança externa do valor", () => {
    render(<Transport />);
    act(() => useStore.getState().setBpm(77));
    expect((screen.getByLabelText("BPM") as HTMLInputElement).value).toBe("77");
  });

  it("BPM do bloco: vazio remove o override", () => {
    render(<Progression />);
    const input = screen.getByLabelText("BPM do bloco") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "140" } });
    expect(selectBlock(useStore.getState())!.bpm).toBe(140);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(selectBlock(useStore.getState())!.bpm).toBeUndefined();
  });
});

describe("contagem", () => {
  it("alterna countIn", () => {
    render(<Transport />);
    const before = useStore.getState().countIn;
    fireEvent.click(screen.getByText("⏺ Contagem"));
    expect(useStore.getState().countIn).toBe(!before);
  });
});
