import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeChord, type Chord } from "../core/chords";
import { expandArrangement, makeSong, type Song } from "../core/song";

vi.mock("../core/voicing", async (orig) => {
  const real = await orig<typeof import("../core/voicing")>();
  return { ...real, voiceChord: vi.fn((chord: Chord, prev?: number[] | null) => real.voiceChord(chord, prev)) };
});

import { voiceChord } from "../core/voicing";
import { metronomeClicks, renderNotes, type RenderOptions } from "./render";

const base: RenderOptions = { swing: 0, fitToInstrument: false, humanize: false };

function build(chords: number[], patch: Partial<Song> = {}, block: Partial<Song["blocks"][string]> = {}) {
  const song = makeSong();
  song.bpm = 120;
  Object.assign(song, patch);
  const b = song.blocks[song.arrangement[0].blockId];
  b.chords = chords.map((d, i) => makeChord(i === 0 ? 0 : 7, "maj", d));
  Object.assign(b, block);
  return song;
}

beforeEach(() => {
  vi.mocked(voiceChord).mockClear();
});

describe("camada de baixo", () => {
  it("a nota de baixo sai no bassInstrument; as demais no instrumento do acorde", () => {
    const ex = expandArrangement(build([4], {}, { bassInstrument: "contrabass-pizz" }));
    const notes = renderNotes(ex, base);
    const bass = notes.filter((n) => n.instrument === "contrabass-pizz");
    expect(bass.length).toBe(1);
    expect(bass[0].midi).toBe(36);
    expect(bass[0].isBass).toBe(true);
    const rest = notes.filter((n) => n.instrument === "piano");
    expect(rest.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(rest.some((n) => n.isBass)).toBe(false);
  });

  it("arpejo: baixo uma vez, no início, sustentado", () => {
    const ex = expandArrangement(build([4], { pattern: "arp-up" }, { bassInstrument: "cello" }));
    const bass = renderNotes(ex, base).filter((n) => n.instrument === "cello");
    expect(bass.length).toBe(1);
    expect(bass[0].time).toBe(0);
    expect(bass[0].duration).toBeGreaterThan(1.8);
  });

  it("ajusta o baixo à tessitura do instrumento da camada", () => {
    const ex = expandArrangement(build([4], {}, { bassInstrument: "cello" }));
    const bass = renderNotes(ex, { ...base, fitToInstrument: true }).find((n) => n.instrument === "cello")!;
    expect(bass.midi).toBeGreaterThanOrEqual(36);
  });
});

describe("bordão", () => {
  it("só com instrumento drone; dura a passada inteira", () => {
    const song = build([4, 4], {}, { drone: true, instrument: "bagpipe" });
    const ex = expandArrangement(song);
    const drones = renderNotes(ex, { ...base, tonicFor: () => 2 }).filter((n) => n.velocity === 0.4);
    expect(drones.length).toBe(1);
    expect(drones[0].midi).toBe(38);
    expect(drones[0].time).toBe(0);
    expect(drones[0].duration).toBeCloseTo(ex.totalSec);
    const piano = expandArrangement(build([4, 4], {}, { drone: true }));
    expect(renderNotes(piano, { ...base, tonicFor: () => 2 }).some((n) => n.velocity === 0.4)).toBe(false);
    expect(renderNotes(ex, base).some((n) => n.velocity === 0.4)).toBe(false);
  });

  it("sitar (decay): re-ataca o bordão a cada compasso, ajustado à tessitura", () => {
    const ex = expandArrangement(build([8], {}, { drone: true, instrument: "sitar" }));
    const drones = renderNotes(ex, { ...base, fitToInstrument: true, tonicFor: () => 0 }).filter((n) => n.velocity === 0.4);
    expect(drones.map((d) => d.time)).toEqual([0, 2]);
    expect(drones.every((d) => d.midi === 48)).toBe(true);
  });
});

describe("re-ataque", () => {
  const attacks = (song: Song, reattack: boolean) => {
    const notes = renderNotes(expandArrangement(song), { ...base, reattack });
    return new Set(notes.filter((n) => n.instrument !== undefined).map((n) => n.time)).size;
  };

  it("piano em acorde de 8 tempos: 2 ataques; synth de sustain: 1", () => {
    expect(attacks(build([8]), true)).toBe(2);
    expect(attacks(build([8]), false)).toBe(1);
    expect(attacks(build([8], { instrument: "synth-pad" }), true)).toBe(1);
  });

  it("re-ataque mais fraco", () => {
    const notes = renderNotes(expandArrangement(build([8])), { ...base, reattack: true });
    expect(Math.max(...notes.filter((n) => n.time > 0).map((n) => n.velocity))).toBeLessThan(0.75);
  });
});

describe("condução de vozes", () => {
  it("passa as notas do acorde anterior dentro da passada e reinicia na repetição", () => {
    const song = build([4, 4]);
    song.arrangement[0].repeat = 2;
    renderNotes(expandArrangement(song), { ...base, voiceLeading: true });
    const calls = vi.mocked(voiceChord).mock.calls;
    expect(calls.length).toBe(4);
    expect(calls[0][1]).toBeNull();
    expect(calls[1][1]).toEqual(vi.mocked(voiceChord).mock.results[0].value);
    expect(calls[2][1]).toBeNull();
    expect(calls[3][1]).toEqual(vi.mocked(voiceChord).mock.results[2].value);
  });

  it("desligada: prev é sempre null", () => {
    renderNotes(expandArrangement(build([4, 4])), base);
    expect(vi.mocked(voiceChord).mock.calls.every((c) => !c[1])).toBe(true);
  });
});

describe("rampa de andamento", () => {
  it("arpejo cabe dentro do acorde mesmo em ritardando", () => {
    const song = build([4], { pattern: "arp-up" }, { rampTo: 60 });
    const ex = expandArrangement(song);
    const notes = renderNotes(ex, base);
    expect(Math.max(...notes.map((n) => n.time))).toBeLessThan(ex.totalSec);
  });
});

describe("rampa dentro de um acorde longo", () => {
  const ramp = (from: number, to: number, patch: Partial<Song> = {}) => expandArrangement(build([16], { bpm: from, ...patch }, { rampTo: to }));

  it("ritardando 120→60: o tempo 8 do metrônomo cai em 16·ln(4/3) s", () => {
    const clicks = metronomeClicks(ramp(120, 60));
    expect(clicks[8].time).toBeCloseTo(16 * Math.log(4 / 3), 6);
    expect(clicks[0].time).toBe(0);
  });

  it("accelerando 60→120: o tempo 8 cai em 16·ln(3/2) s e o arpejo acompanha", () => {
    const ex = ramp(60, 120, { pattern: "arp-up" });
    expect(metronomeClicks(ex)[8].time).toBeCloseTo(16 * Math.log(1.5), 6);
    expect(ex.totalSec).toBeCloseTo(16 * Math.log(2), 6);
    // Ataque nº 16 do arpejo = tempo 8.
    const times = [...new Set(renderNotes(ex, base).map((n) => n.time))].sort((a, b) => a - b);
    expect(times[16]).toBeCloseTo(16 * Math.log(1.5), 6);
  });

  it("nenhuma nota nem clique depois de totalSec, em ritardando e accelerando", () => {
    for (const [from, to] of [[120, 60], [60, 120]]) {
      for (const pattern of ["block", "arp-up", "comping"] as const) {
        const ex = ramp(from, to, { pattern });
        const notes = renderNotes(ex, { ...base, reattack: true });
        expect(Math.max(...notes.map((n) => n.time))).toBeLessThan(ex.totalSec);
        expect(Math.max(...notes.map((n) => n.time + n.duration))).toBeLessThanOrEqual(ex.totalSec + 1e-9);
        expect(Math.max(...metronomeClicks(ex).map((c) => c.time))).toBeLessThan(ex.totalSec);
      }
    }
  });

  it("re-ataque por compasso segue a rampa", () => {
    const ex = ramp(60, 120);
    const times = [...new Set(renderNotes(ex, { ...base, reattack: true }).map((n) => n.time))].sort((a, b) => a - b);
    expect(times.length).toBe(4);
    expect(times[1]).toBeCloseTo(16 * Math.log(1.25), 6);
  });
});

describe("bordão e baixo na mesma altura", () => {
  it("fundamental = tônica: o baixo duplicado do acorde é omitido; o bordão fica", () => {
    const ex = expandArrangement(build([4, 4], {}, { drone: true, instrument: "bagpipe" }));
    const notes = renderNotes(ex, { ...base, tonicFor: () => 0 });
    // Acorde 0 (Dó): só o bordão em 36; acorde 1 (Sol): baixo 43 mantido.
    expect(notes.filter((n) => n.eventIndex === 0 && n.midi === 36).map((n) => n.velocity)).toEqual([0.4]);
    expect(notes.some((n) => n.isBass && n.midi === 36)).toBe(false);
    expect(notes.some((n) => n.isBass && n.midi === 43)).toBe(true);
    expect(notes.filter((n) => n.eventIndex === 0 && n.velocity !== 0.4).length).toBeGreaterThan(0);
  });
});
