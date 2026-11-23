import { describe, expect, it } from "vitest";
import { barLinesWithin, GRIDS, gridBeats, missingBeats, snapDuration, stepDuration, type Meter } from "./timeline";

const m44: Meter = [4, 4];
const m68: Meter = [6, 8];
const m78: Meter = [7, 8];

describe("gridBeats", () => {
  it("inclui 0.25 e devolve a unidade ou o compasso", () => {
    expect(GRIDS).toContain(0.25);
    expect(gridBeats(0.25, m44)).toBe(0.25);
    expect(gridBeats(0.5, m44)).toBe(0.5);
    expect(gridBeats(2, m68)).toBe(2);
    expect(gridBeats("bar", m68)).toBe(6);
    expect(gridBeats("bar", m44)).toBe(4);
    expect(missingBeats(4, m44)).toBe(0);
    expect(missingBeats(3.75, m44)).toBeCloseTo(0.25);
  });
});

describe("stepDuration", () => {
  it("anda pela grade", () => {
    expect(stepDuration(4, 1, 1)).toBe(5);
    expect(stepDuration(4, -1, 4)).toBe(4);
    expect(stepDuration(8, -1, 4)).toBe(4);
    expect(stepDuration(3, 1, 2)).toBe(4);
    expect(stepDuration(4, 1, 2)).toBe(6);
    expect(stepDuration(3, -1, 2)).toBe(2);
  });
  it("nunca zera e respeita o teto", () => {
    expect(stepDuration(0.5, -1, 1)).toBe(0.5);
    expect(stepDuration(1, -1, 1)).toBe(1);
    expect(stepDuration(64, 1, 4)).toBe(64);
    expect(stepDuration(63, 1, 4)).toBe(64);
  });
});

describe("snapDuration", () => {
  it("arredonda ao múltiplo mais próximo", () => {
    expect(snapDuration(4.4, 1)).toBe(4);
    expect(snapDuration(4.6, 1)).toBe(5);
    expect(snapDuration(5, 4)).toBe(4);
    expect(snapDuration(7, 4)).toBe(8);
  });
  it("mínimo uma unidade e teto 64", () => {
    expect(snapDuration(0.1, 2)).toBe(2);
    expect(snapDuration(-3, 1)).toBe(1);
    expect(snapDuration(100, 1)).toBe(64);
  });
});

describe("barLinesWithin", () => {
  it("4/4", () => {
    expect(barLinesWithin(2, 4, m44)).toEqual([2]);
    expect(barLinesWithin(0, 4, m44)).toEqual([]);
    expect(barLinesWithin(0, 8, m44)).toEqual([4]);
    expect(barLinesWithin(2, 8, m44)).toEqual([2, 6]);
    expect(barLinesWithin(3, 1, m44)).toEqual([]);
  });
  it("6/8", () => {
    expect(barLinesWithin(4, 4, m68)).toEqual([2]);
    expect(barLinesWithin(0, 6, m68)).toEqual([]);
    expect(barLinesWithin(0, 13, m68)).toEqual([6, 12]);
  });
  it("7/8", () => {
    expect(barLinesWithin(5, 4, m78)).toEqual([2]);
    expect(barLinesWithin(7, 7, m78)).toEqual([]);
    expect(barLinesWithin(6, 9, m78)).toEqual([1, 8]);
  });
});
