// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/** Porta de entrada falsa: guarda os ouvintes para simular mensagens. */
function fakeInput(id: string, name: string) {
  const handlers = new Set<(e: MIDIMessageEvent) => void>();
  return {
    id,
    name,
    state: "connected",
    addEventListener: vi.fn((_t: string, h: (e: MIDIMessageEvent) => void) => void handlers.add(h)),
    removeEventListener: vi.fn((_t: string, h: (e: MIDIMessageEvent) => void) => void handlers.delete(h)),
    send: (bytes: number[]) => handlers.forEach((h) => h({ data: new Uint8Array(bytes) } as unknown as MIDIMessageEvent)),
    handlers,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup() {
  vi.resetModules();
  const iacIn = fakeInput("iac-in", "IAC Driver Barramento 1");
  const kbd = fakeInput("kbd", "Teclado USB");
  const iacOut = { id: "iac-out", name: "IAC Driver Barramento 1", send: vi.fn() };
  const access = { inputs: new Map([[iacIn.id, iacIn], [kbd.id, kbd]]), outputs: new Map([[iacOut.id, iacOut]]), onstatechange: null };
  vi.stubGlobal("navigator", { ...navigator, requestMIDIAccess: vi.fn(async () => access) });
  const midi = await import("./midi");
  const input = await import("./midiInput");
  await midi.initMidi();
  return { midi, input, iacIn, kbd };
}

describe("entrada MIDI: portas", () => {
  it("com a saída no IAC Driver, a entrada do mesmo barramento é ignorada (sem realimentação)", async () => {
    const { midi, input, iacIn, kbd } = await setup();
    midi.configureMidi({ ...midi.DEFAULT_MIDI, enabled: true, outputId: "iac-out", inputEnabled: true });
    input.configureMidiInput({ enabled: true, inputId: null });
    expect(kbd.handlers.size).toBe(1);
    expect(iacIn.handlers.size).toBe(0);

    // Saída desligada: o IAC volta a ser uma entrada válida.
    midi.configureMidi({ ...midi.DEFAULT_MIDI, enabled: false, inputEnabled: true });
    input.configureMidiInput({ enabled: true, inputId: null });
    expect(iacIn.handlers.size).toBe(1);
  });

  it("trocar para uma porta específica solta as teclas da que saiu", async () => {
    const { midi, input, kbd } = await setup();
    midi.configureMidi({ ...midi.DEFAULT_MIDI, inputEnabled: true });
    input.configureMidiInput({ enabled: true, inputId: null });
    const events: string[] = [];
    input.subscribeMidiInput((e) => events.push(e.type));
    kbd.send([0x90, 60, 100]);
    expect(input.pressedNotes()).toEqual([60]);
    input.configureMidiInput({ enabled: true, inputId: "iac-in" });
    expect(kbd.handlers.size).toBe(0);
    expect(input.pressedNotes()).toEqual([]);
    expect(events).toEqual(["press", "reset", "release", "sound-off"]);
  });
});
