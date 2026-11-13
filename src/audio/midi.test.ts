import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { makeChord } from "../core/chords";
import { expandArrangement, makeBlock, makeSong } from "../core/song";
import { songToMidi } from "../export/midi";
import { configureMidi, DEFAULT_MIDI, initMidi, midiActive, noteOff, noteOn, panic } from "./midi";
import { renderNotes } from "./render";

function song2() {
  const song = makeSong();
  const a = song.blocks[song.arrangement[0].blockId];
  a.chords = [makeChord(0, "maj", 4), makeChord(7, "maj", 4)];
  const b = makeBlock("Refrão", 1, [makeChord(5, "maj", 6)]);
  b.bpm = 120;
  b.meter = [6, 8];
  song.blocks[b.id] = b;
  song.arrangement.push({ id: "x", blockId: b.id, repeat: 1 });
  return song;
}

describe("renderNotes", () => {
  it("bloco: todas as notas juntas sem humanização, baixo marcado", () => {
    const notes = renderNotes(expandArrangement(song2()), { swing: 0, fitToInstrument: false, humanize: false });
    const first = notes.filter((n) => n.eventIndex === 0);
    expect(first.map((n) => n.midi)).toEqual([36, 60, 64, 67]);
    expect(first.every((n) => n.time === 0)).toBe(true);
    expect(first.filter((n) => n.isBass).map((n) => n.midi)).toEqual([36]);
  });

  it("arpejo: uma nota por colcheia; monofônico força arpejo só no áudio do navegador", () => {
    const song = song2();
    song.pattern = "arp-up";
    const arp = renderNotes(expandArrangement(song), { swing: 0, fitToInstrument: false, humanize: false }).filter((n) => n.eventIndex === 0);
    expect(arp.length).toBe(8);
    song.pattern = "block";
    song.instrument = "flute";
    const ex = expandArrangement(song);
    expect(renderNotes(ex, { swing: 0, fitToInstrument: true, humanize: false }).filter((n) => n.eventIndex === 0).length).toBe(8);
    expect(renderNotes(ex, { swing: 0, fitToInstrument: false, humanize: false }).filter((n) => n.eventIndex === 0).length).toBe(4);
  });

  it("canal por bloco", () => {
    const song = song2();
    const refrao = song.arrangement[1].blockId;
    const notes = renderNotes(expandArrangement(song), { swing: 0, fitToInstrument: false, humanize: false, channelFor: (id) => (id === refrao ? 3 : 1) });
    expect(new Set(notes.filter((n) => n.eventIndex === 2).map((n) => n.channel))).toEqual(new Set([3]));
  });
});

describe("export .mid", () => {
  it("tempo, compassos, marcadores e trilhas de acordes/baixo", () => {
    const bytes = songToMidi(song2(), { channel: 1, splitBass: true });
    const midi = new Midi(bytes);
    expect(midi.header.tempos.map((t) => Math.round(t.bpm))).toEqual([90, 60]);
    expect(midi.header.timeSignatures.map((t) => t.timeSignature)).toEqual([
      [4, 4],
      [6, 8],
    ]);
    expect(midi.header.meta.filter((m) => m.type === "marker").map((m) => m.text)).toEqual(["Verso A", "Refrão"]);
    const ppq = midi.header.ppq;
    expect(midi.header.meta.find((m) => m.text === "Refrão")!.ticks).toBe(8 * ppq);
    const byName = Object.fromEntries(midi.tracks.map((t) => [t.name, t]));
    expect(byName["Baixo"].notes.map((n) => n.midi)).toEqual([36, 43, 41]);
    expect(byName["Acordes"].notes.length).toBe(9);
    // Refrão: 6 colcheias em 6/8 = 3 semínimas.
    const refraoBass = byName["Baixo"].notes[2];
    expect(refraoBass.ticks).toBe(8 * ppq);
    expect(refraoBass.durationTicks).toBeGreaterThan(2.8 * ppq);
    expect(refraoBass.durationTicks).toBeLessThanOrEqual(3 * ppq);
  });
});

describe("saída MIDI (porta simulada)", () => {
  it("envia note on/off no canal certo e solta tudo no panic", async () => {
    const sent: number[][] = [];
    const port = { id: "iac", name: "IAC Driver Bus 1", send: (d: number[]) => void sent.push(d) };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { requestMIDIAccess: async () => ({ outputs: new Map([["iac", port]]), onstatechange: null }) },
    });
    expect(await initMidi()).toBe(true);
    configureMidi({ ...DEFAULT_MIDI, enabled: true, outputId: "iac" });
    expect(midiActive()).toBe(true);

    noteOn(2, 60, 1);
    noteOff(2, 60);
    expect(sent).toEqual([
      [0x91, 60, 127],
      [0x81, 60, 0],
    ]);

    sent.length = 0;
    noteOn(1, 64, 0.5);
    panic();
    expect(sent[1]).toEqual([0x80, 64, 0]);
    expect(sent).toContainEqual([0xb0, 123, 0]);
    expect(sent).toContainEqual([0xbf, 123, 0]);

    configureMidi({ ...DEFAULT_MIDI, enabled: false });
    expect(midiActive()).toBe(false);
  });
});
