// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

import { useStore } from "../state/store";
import { Header } from "./Header";
import { useTheme } from "./useTheme";

function Harness() {
  useTheme();
  return <Header />;
}

beforeEach(() => {
  useStore.getState().newSong();
  act(() => useStore.getState().setTheme("auto"));
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe("tema", () => {
  it("Claro define o atributo", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "☀ Claro" }));
    expect(useStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("Auto remove o atributo", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "☾ Escuro" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    const auto = within(screen.getByRole("radiogroup", { name: "Tema" })).getByRole("radio", { name: "Auto" });
    fireEvent.click(auto);
    expect(useStore.getState().theme).toBe("auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("controle segmentado", () => {
  it("setas mudam o modo e movem o foco", () => {
    render(<Header />);
    const group = within(screen.getByRole("radiogroup", { name: "Modo de restrição" }));
    const start = useStore.getState().mode;
    const radios = group.getAllByRole("radio");
    const i = radios.findIndex((r) => r.getAttribute("aria-checked") === "true");
    radios[i].focus();
    fireEvent.keyDown(radios[i], { key: "ArrowRight" });
    const next = radios[(i + 1) % radios.length];
    expect(useStore.getState().mode).not.toBe(start);
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("tabindex")).toBe("0");
  });
});
