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
}));

import { SCALES } from "../core/scales";
import { useStore } from "../state/store";
import { InstrumentPicker } from "./InstrumentPicker/InstrumentPicker";
import { ScalePicker } from "./ScalePicker/ScalePicker";

beforeEach(() => useStore.getState().newSong());
afterEach(cleanup);

describe("ScalePicker por teclado", () => {
  it("digitar, ↓ e Enter escolhem a opção ativa; Esc fecha", () => {
    render(<ScalePicker />);
    fireEvent.click(screen.getByRole("button", { name: /Escala/ }));
    const input = screen.getByRole("combobox");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "dor" } });
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[0].className).toContain("active");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activeId = input.getAttribute("aria-activedescendant")!;
    expect(activeId).toBe(options[1].id);
    expect(document.getElementById(activeId)).toBeTruthy();
    const chosen = SCALES.find((sc) => sc.name === options[1].firstElementChild!.textContent)!.id;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(useStore.getState().scaleId).toBe(chosen);
  });

  it("Esc fecha o popover", () => {
    render(<ScalePicker />);
    fireEvent.click(screen.getByRole("button", { name: /Escala/ }));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("InstrumentPicker por teclado", () => {
  it("↓↓ + Enter trocam o instrumento global", () => {
    render(<InstrumentPicker />);
    const before = useStore.getState().song.instrument;
    fireEvent.click(screen.getByRole("button", { name: /Instrumento/ }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = document.getElementById(input.getAttribute("aria-activedescendant")!)!;
    expect(active.className).toContain("active");
    expect(active.getAttribute("role")).toBe("option");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().song.instrument).not.toBe(before);
  });
});
