import { Midi } from "@tonejs/midi";
import { describe, expect, it, vi } from "vitest";
import { makeChord } from "../core/chords";
import { expandArrangement, makeBlock, makeSong } from "../core/song";
import { songToMidi } from "../export/midi";
import { configureMidi, DEFAULT_MIDI, initMidi, midiActive, noteOff, noteOn, panic } from "./midi";
import { countIn, metronomeClicks, renderNotes } from "./render";

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

  it("marcadores: primeiro bloco no tick 0, blocos vazios no tick do próximo acorde ou do fim", () => {
    const song = song2();
    const vazio = makeBlock("Vazio", 2);
    const fim = makeBlock("Fim", 3);
    song.blocks[vazio.id] = vazio;
    song.blocks[fim.id] = fim;
    song.arrangement.splice(1, 0, { id: "v", blockId: vazio.id, repeat: 1 });
    song.arrangement.push({ id: "f", blockId: fim.id, repeat: 1 });
    const midi = new Midi(songToMidi(song, { channel: 1, splitBass: true }));
    const ppq = midi.header.ppq;
    const tick = (name: string) => midi.header.meta.find((m) => m.text === name)!.ticks;
    expect(tick("Verso A")).toBe(0);
    expect(tick("Vazio")).toBe(8 * ppq);
    expect(tick("Refrão")).toBe(8 * ppq);
    // Fim da música: 8 semínimas + 6 colcheias (3 semínimas).
    expect(tick("Fim")).toBe(11 * ppq);
    // Mudança de tempo/compasso do bloco vazio final não volta ao tick 0.
    expect(midi.header.tempos.every((t, i) => i === 0 || t.ticks > 0)).toBe(true);
  });
});

describe("countIn", () => {
  it("4/4 a 120 bpm: 4 cliques de meio segundo, só o primeiro acentuado", () => {
    const song = song2();
    song.bpm = 120;
    song.blocks[song.arrangement[0].blockId].bpm = 120;
    const ci = countIn(expandArrangement(song));
    expect(ci.seconds).toBe(2);
    expect(ci.clicks.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(ci.clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it("6/8: 2 cliques (um por pulso), seconds = 6 tempos; sem eventos: vazio", () => {
    const song = song2();
    song.arrangement.shift();
    const ci = countIn(expandArrangement(song));
    expect(ci.clicks.length).toBe(2);
    expect(ci.clicks.map((c) => c.accent)).toEqual([true, false]);
    expect(ci.seconds).toBeCloseTo(6 * (60 / 120));
    expect(ci.clicks[1].time).toBeCloseTo(3 * (60 / 120));
    expect(countIn(expandArrangement(makeSong()))).toEqual({ seconds: 0, clicks: [] });
  });

  it("12/8: 4 cliques", () => {
    const song = makeSong();
    song.meter = [12, 8];
    song.blocks[song.arrangement[0].blockId].chords = [makeChord(0, "maj", 12)];
    expect(countIn(expandArrangement(song)).clicks.length).toBe(4);
  });
});

describe("metronomeClicks", () => {
  const build = (meter: [number, number], durations: number[], repeat = 1) => {
    const song = makeSong();
    song.meter = meter;
    song.bpm = 60;
    const b = song.blocks[song.arrangement[0].blockId];
    b.chords = durations.map((d) => makeChord(0, "maj", d));
    song.arrangement[0].repeat = repeat;
    return metronomeClicks(expandArrangement(song));
  };

  it("4/4: um clique por tempo, acento a cada 4", () => {
    const c = build([4, 4], [4, 4]);
    expect(c.length).toBe(8);
    expect(c.map((x) => x.accent)).toEqual([true, false, false, false, true, false, false, false]);
    expect(c.map((x) => x.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("6/8: 2 cliques por compasso, acento no primeiro", () => {
    const c = build([6, 8], [6, 6]);
    expect(c.map((x) => x.time)).toEqual([0, 3, 6, 9]);
    expect(c.map((x) => x.accent)).toEqual([true, false, true, false]);
  });

  it("12/8: 4 cliques por compasso", () => {
    const c = build([12, 8], [12]);
    expect(c.length).toBe(4);
    expect(c.map((x) => x.accent)).toEqual([true, false, false, false]);
  });

  it("7/8: 7 cliques por compasso", () => {
    const c = build([7, 8], [7]);
    expect(c.length).toBe(7);
    expect(c.filter((x) => x.accent).length).toBe(1);
  });

  it("acorde que atravessa a barra mantém o acento no lugar certo", () => {
    const c = build([4, 4], [3, 3, 2]);
    expect(c.map((x) => x.accent)).toEqual([true, false, false, false, true, false, false, false]);
  });

  it("reinicia a contagem a cada repetição do bloco", () => {
    const c = build([4, 4], [2], 2);
    expect(c.map((x) => x.accent)).toEqual([true, false, true, false]);
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

describe("panic (porta selecionada, só com MIDI em uso)", () => {
  // Módulo novo por teste: `access` e as notas ativas são estado de módulo.
  const setup = async () => {
    vi.resetModules();
    const sent: Record<string, number[][]> = { a: [], b: [] };
    const port = (id: string) => ({ id, name: id, send: (d: number[]) => void sent[id].push(d) });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { requestMIDIAccess: async () => ({ outputs: new Map([["a", port("a")], ["b", port("b")]]), onstatechange: null }) },
    });
    const m = await import("./midi");
    await m.initMidi();
    return { m, sent };
  };

  it("desabilitado e sem notas ativas: não envia nada", async () => {
    const { m, sent } = await setup();
    m.panic();
    expect(sent).toEqual({ a: [], b: [] });
  });

  it("habilitado: envia só para a porta selecionada", async () => {
    const { m, sent } = await setup();
    m.configureMidi({ ...m.DEFAULT_MIDI, enabled: true, outputId: "b" });
    m.noteOn(1, 60, 1);
    sent.b.length = 0;
    m.panic();
    expect(sent.a).toEqual([]);
    expect(sent.b[0]).toEqual([0x80, 60, 0]);
    expect(sent.b).toContainEqual([0xb0, 123, 0]);
  });

  it("desabilitar depois de tocar envia o panic final na porta que estava em uso", async () => {
    const { m, sent } = await setup();
    m.configureMidi({ ...m.DEFAULT_MIDI, enabled: true, outputId: "b" });
    m.noteOn(1, 64, 1);
    sent.b.length = 0;
    m.configureMidi({ ...m.DEFAULT_MIDI, enabled: false, outputId: "b" });
    expect(sent.a).toEqual([]);
    expect(sent.b[0]).toEqual([0x80, 64, 0]);
    expect(sent.b).toContainEqual([0xbf, 123, 0]);
  });

  it("panicAll alcança todas as portas e canais", async () => {
    const { m, sent } = await setup();
    m.panicAll();
    expect(sent.a).toContainEqual([0xbf, 64, 0]);
    expect(sent.b).toContainEqual([0xb0, 123, 0]);
  });
});
