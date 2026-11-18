import { describe, expect, it } from "vitest";
import { tapTempo } from "./tempo";

describe("tapTempo", () => {
  it("com menos de 3 toques não devolve BPM", () => {
    expect(tapTempo([], 0)).toEqual({ taps: [0], bpm: null });
    expect(tapTempo([0], 500).bpm).toBeNull();
  });

  it("4 toques a 500 ms dão 120 BPM", () => {
    let taps: number[] = [];
    let bpm: number | null = null;
    for (const t of [0, 500, 1000, 1500]) ({ taps, bpm } = tapTempo(taps, t));
    expect(bpm).toBeCloseTo(120);
    expect(taps).toHaveLength(4);
  });

  it("descarta toques fora da janela de 2,5 s", () => {
    const r = tapTempo([0, 100, 200], 5000);
    expect(r.taps).toEqual([5000]);
    expect(r.bpm).toBeNull();
    // 2499 ms ainda conta; 2500 ms não.
    expect(tapTempo([0], 2499).taps).toEqual([0, 2499]);
    expect(tapTempo([0], 2500).taps).toEqual([2500]);
  });

  it("mantém no máximo 6 toques", () => {
    const r = tapTempo([0, 400, 800, 1200, 1600, 2000], 2400);
    expect(r.taps).toEqual([400, 800, 1200, 1600, 2000, 2400]);
    expect(r.bpm).toBeCloseTo(150);
  });
});
