import { afterEach, describe, expect, it, vi } from "vitest";
import { LOAD_TIMEOUT_MS, pickEviction, withTimeout } from "./loaders";

const e = (id: string, lastUsed: number, sampled = true) => ({ id, lastUsed, sampled });

describe("pickEviction", () => {
  const six = [e("a", 1), e("b", 2), e("c", 3), e("d", 4), e("f", 5), e("g", 6)];

  it("no limite ou abaixo: não descarta nada", () => {
    expect(pickEviction(six, new Set(), 6)).toEqual([]);
    expect(pickEviction(six.slice(0, 3), new Set(), 6)).toEqual([]);
  });

  it("acima do limite: descarta os menos recentes, só o excedente", () => {
    expect(pickEviction([...six, e("h", 7), e("i", 8)], new Set(), 6)).toEqual(["a", "b"]);
  });

  it("nunca descarta quem está em uso", () => {
    expect(pickEviction([...six, e("h", 7)], new Set(["a"]), 6)).toEqual(["b"]);
    expect(pickEviction([...six, e("h", 7)], new Set(["a", "b", "c", "d", "f", "g", "h"]), 6)).toEqual([]);
  });

  it("synths não contam para o limite", () => {
    const synths = [e("s1", 0, false), e("s2", 0, false), e("s3", 0, false)];
    expect(pickEviction([...six, ...synths], new Set(), 6)).toEqual([]);
    expect(pickEviction([...six, e("h", 7), ...synths], new Set(), 6)).toEqual(["a"]);
  });
});

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("rejeita se a promessa não resolver em LOAD_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<void>(() => {}), LOAD_TIMEOUT_MS);
    const out = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    await out;
  });

  it("resolve normalmente se responder a tempo", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(7), LOAD_TIMEOUT_MS)).resolves.toBe(7);
  });
});
