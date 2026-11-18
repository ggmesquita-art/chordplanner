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

import { selectChord, useStore } from "../state/store";
import { ModifierPanel } from "./ModifierPanel/ModifierPanel";

beforeEach(() => {
  const s = useStore.getState();
  s.newSong();
  s.setTonic(0);
  s.setMode("free");
  const chord = selectChord(useStore.getState());
  if (!chord) {
    s.addChord(0, "maj");
  }
  const c = selectChord(useStore.getState());
  if (c) useStore.getState().selectChord(c.id);
});
afterEach(cleanup);

const btn = (name: string) => screen.getAllByRole("button").find((b) => b.textContent?.replace(/[✓◐⚠]/g, "").trim() === name)!;
const mods = () => selectChord(useStore.getState())!.modifiers;

describe("conflito de modificadores", () => {
  it("desabilita a opção conflitante com explicação e reabilita ao desligar", () => {
    render(<ModifierPanel />);
    fireEvent.click(btn("maj7"));
    const seven = btn("7");
    expect(seven.getAttribute("aria-disabled")).toBe("true");
    expect(seven.className).toContain("conflict");
    expect(seven.title).toBe("Conflita com maj7 — remova-o primeiro");

    const before = JSON.stringify(mods());
    fireEvent.click(seven);
    expect(JSON.stringify(mods())).toBe(before);

    fireEvent.click(btn("maj7"));
    expect(btn("7").getAttribute("aria-disabled")).toBeNull();
    act(() => {});
    fireEvent.click(btn("7"));
    expect(mods()).toEqual([{ kind: "ext", value: 7 }]);
  });
});

describe("voicing", () => {
  it("escolher Drop 2 chama setVoicing e grava o voicing no acorde", () => {
    render(<ModifierPanel />);
    fireEvent.change(screen.getByLabelText("Voicing"), { target: { value: "drop2" } });
    expect(selectChord(useStore.getState())!.voicing).toBe("drop2");
    fireEvent.change(screen.getByLabelText("Voicing"), { target: { value: "closed" } });
    expect(selectChord(useStore.getState())!.voicing).toBeUndefined();
  });
});
