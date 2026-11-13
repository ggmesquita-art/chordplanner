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

import { BLOCK_COLORS } from "../core/song";
import { useStore } from "../state/store";
import { Arrangement } from "./Arrangement/Arrangement";
import { barTicks } from "./Arrangement/barTicks";

beforeEach(() => {
  const s = useStore.getState();
  s.newSong();
  s.addBlock();
  s.selectItem(0);
});
afterEach(cleanup);

describe("barTicks", () => {
  it("até 8 compassos: todos", () => {
    const t = barTicks(1, 8);
    expect(t.map((x) => x.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(t[4].at).toBeCloseTo(0.5);
  });
  it("12 compassos: de 2 em 2, a partir do primeiro", () => {
    expect(barTicks(5, 12).map((x) => x.bar)).toEqual([5, 7, 9, 11, 13, 15]);
  });
  it("32 compassos: de 4 em 4", () => {
    const t = barTicks(1, 32);
    expect(t.map((x) => x.bar)).toEqual([1, 5, 9, 13, 17, 21, 25, 29]);
    expect(t[1].at).toBeCloseTo(4 / 32);
  });
  it("fracionário não passa do último compasso inteiro", () => {
    expect(barTicks(3, 2.5).map((x) => x.bar)).toEqual([3, 4]);
    expect(barTicks(1, 0)).toEqual([]);
  });
});

describe("controles do bloco", () => {
  it("escolher cor altera block.color", () => {
    render(<Arrangement />);
    fireEvent.click(screen.getByRole("radio", { name: "Cor 3" }));
    const s = useStore.getState();
    expect(s.song.blocks[s.song.arrangement[0].blockId].color).toBe(BLOCK_COLORS[2]);
  });

  it("excluir exige confirmação", () => {
    render(<Arrangement />);
    const count = () => useStore.getState().song.arrangement.length;
    expect(count()).toBe(2);
    fireEvent.click(screen.getByLabelText("Remover do arranjo"));
    expect(count()).toBe(2);
    fireEvent.click(screen.getByLabelText("Cancelar exclusão"));
    expect(count()).toBe(2);
    expect(screen.getByLabelText("Remover do arranjo")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remover do arranjo"));
    fireEvent.click(screen.getByText("Excluir"));
    expect(count()).toBe(1);
  });
});
