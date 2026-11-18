import { describe, expect, it } from "vitest";
import { makeChord, type VoicingId } from "./chords";
import { voiceChord } from "./voicing";

const maj7 = { kind: "ext", value: "maj7" } as const;
const sev = { kind: "ext", value: 7 } as const;
const cmaj7 = (voicing?: VoicingId) => ({ ...makeChord(0, "maj"), modifiers: [maj7], voicing });
const g7 = (voicing?: VoicingId) => ({ ...makeChord(7, "maj"), modifiers: [sev], voicing });
const ALL: VoicingId[] = ["closed", "open", "drop2", "drop3", "quartal", "shell"];

describe("voicings", () => {
  it("Cmaj7: notas de cada voicing", () => {
    expect(voiceChord(cmaj7())).toEqual([36, 60, 64, 67, 71]);
    expect(voiceChord(cmaj7("open"))).toEqual([36, 60, 67, 76, 83]);
    expect(voiceChord(cmaj7("drop2"))).toEqual([36, 55, 60, 64, 71]);
    expect(voiceChord(cmaj7("drop3"))).toEqual([36, 52, 60, 67, 71]);
    expect(voiceChord(cmaj7("shell"))).toEqual([36, 64, 71]);
    expect(voiceChord(cmaj7("quartal"))).toEqual([36, 59, 64, 67, 72]);
  });

  it("G7: notas de cada voicing", () => {
    expect(voiceChord(g7())).toEqual([43, 55, 59, 62, 65]);
    expect(voiceChord(g7("drop2"))).toEqual([43, 50, 55, 59, 65]);
    expect(voiceChord(g7("shell"))).toEqual([43, 59, 65]);
  });

  it("shell sem 7ª usa 3ª + 5ª", () => {
    expect(voiceChord({ ...makeChord(0, "maj"), voicing: "shell" })).toEqual([36, 64, 67]);
  });

  it("quartal usa só notas do acorde", () => {
    const pcs = new Set([0, 4, 7, 11]);
    for (const n of voiceChord(cmaj7("quartal")).slice(1)) expect(pcs.has(n % 12)).toBe(true);
  });

  it("nenhum voicing duplica notas nem sai de 36–96", () => {
    for (const v of ALL)
      for (const c of [cmaj7(v), g7(v), { ...makeChord(5, "maj"), voicing: v }]) {
        const notes = voiceChord(c);
        expect(new Set(notes).size).toBe(notes.length);
        for (const n of notes) expect(n >= 36 && n <= 96).toBe(true);
      }
  });
});

describe("condução de vozes", () => {
  const c = voiceChord(makeChord(0, "maj"));
  const f = makeChord(5, "maj");

  it("sem prev é o fechado", () => {
    expect(voiceChord(f)).toEqual(voiceChord(f, null));
  });

  it("de C para F mexe no máximo 2 semitons por voz", () => {
    const next = voiceChord(f, c);
    expect(next[0]).toBe(41);
    expect(next.slice(1)).toEqual([60, 65, 69]);
    const up = next.slice(1);
    up.forEach((n, i) => expect(Math.abs(n - c.slice(1)[i])).toBeLessThanOrEqual(2));
  });

  it("funciona com outros voicings e respeita F3–A5", () => {
    for (const v of ALL) {
      const next = voiceChord({ ...f, voicing: v }, c);
      for (const n of next.slice(1)) expect(n >= 53 && n <= 81).toBe(true);
    }
  });
});
