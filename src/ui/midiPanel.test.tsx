// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// previewNotes do mock envia por MIDI de verdade (módulo real de ../audio/midi), como o engine faz.
vi.mock("../audio/engine", () => {
  return {
    play: vi.fn(async () => {}),
    stop: vi.fn(),
    previewNotes: vi.fn(async (notes: number[]) => {
      // Import tardio: o registro de módulos é reiniciado a cada teste (ver `load`).
      const midi = await import("../audio/midi");
      for (const n of notes) {
        midi.noteOn(midi.midiChannel(), n, 0.8);
        midi.noteOff(midi.midiChannel(), n);
      }
    }),
    preload: vi.fn(),
    subscribeStatus: () => () => {},
    instrumentStatus: () => "ready",
    instrumentProgress: () => null,
    liveNoteOn: vi.fn(),
    liveNoteOff: vi.fn(),
    liveAllOff: vi.fn(),
    disposeInstrument: vi.fn(),
  };
});

// O módulo de MIDI guarda `access`/status para sempre: cada teste carrega um grafo de módulos novo
// (React, Testing Library, store e MIDI juntos, para não misturar instâncias do React).
async function load() {
  vi.resetModules();
  const rtl = await import("@testing-library/react");
  const { DEFAULT_MIDI } = await import("../audio/midi");
  const { useStore } = await import("../state/store");
  const { useMidiSync } = await import("./hooks");
  const { MidiPanel } = await import("./Transport/MidiPanel");
  useStore.getState().setMidi({ ...DEFAULT_MIDI });
  const Host = () => {
    useMidiSync();
    return <MidiPanel />;
  };
  const { act, fireEvent, screen } = rtl;
  rtl.render(<Host />);
  await act(async () => fireEvent.click(screen.getByTitle("Teclado MIDI (entrada) e saída MIDI para o seu DAW")));
  const enable = () => act(async () => fireEvent.click(screen.getByLabelText("Enviar notas por MIDI")));
  return { ...rtl, useStore, enable };
}

const setRequest = (fn: unknown) => Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, writable: true, value: fn });

let cleanupFn: (() => void) | undefined;
afterEach(() => {
  cleanupFn?.();
  Reflect.deleteProperty(navigator, "requestMIDIAccess");
});

describe("MidiPanel", () => {
  it("sem Web MIDI informa que o navegador não suporta", async () => {
    expect(typeof navigator.requestMIDIAccess).toBe("undefined");
    const t = await load();
    cleanupFn = t.cleanup;
    await t.enable();
    expect(t.screen.getByText(/não tem Web MIDI/)).toBeTruthy();
    expect(t.screen.queryByLabelText("Enviar notas por MIDI")).toBeNull();
  });

  it("permissão negada mostra a mensagem de erro", async () => {
    setRequest(vi.fn(async () => Promise.reject(new Error("denied"))));
    const t = await load();
    cleanupFn = t.cleanup;
    await t.enable();
    expect(t.screen.getByText(/Permissão de MIDI negada/)).toBeTruthy();
  });

  it("com porta simulada: lista, troca canal/latência no store e o teste envia note-on/off à porta escolhida", async () => {
    const a: number[][] = [];
    const b: number[][] = [];
    const port = (id: string, name: string, sent: number[][]) => ({ id, name, send: vi.fn((d: number[]) => void sent.push(d)) });
    setRequest(async () => ({
      outputs: new Map([
        ["a", port("a", "IAC A", a)],
        ["b", port("b", "IAC B", b)],
      ]),
      onstatechange: null,
    }));
    const t = await load();
    cleanupFn = t.cleanup;
    const { act, fireEvent, screen, useStore } = t;
    await t.enable();
    expect(useStore.getState().midi.enabled).toBe(true);

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("IAC A");
    expect(options).toContain("IAC B");

    await act(async () => fireEvent.change(screen.getByLabelText("Porta"), { target: { value: "b" } }));
    await act(async () => fireEvent.change(screen.getByLabelText(/^Canal/), { target: { value: "3" } }));
    await act(async () => fireEvent.change(screen.getByLabelText(/^Latência/), { target: { value: "25" } }));
    const midi = useStore.getState().midi;
    expect(midi.outputId).toBe("b");
    expect(midi.channel).toBe(3);
    expect(midi.latencyMs).toBe(25);
    expect(screen.getByText("25 ms")).toBeTruthy();

    a.length = 0;
    b.length = 0;
    await act(async () => fireEvent.click(screen.getByText("▶ Testar (acorde de Dó)")));
    expect(a).toEqual([]);
    const ons = b.filter((d) => d[0] === 0x92 && d[2] > 0).map((d) => d[1]);
    const offs = b.filter((d) => d[0] === 0x82).map((d) => d[1]);
    expect(ons).toEqual([48, 60, 64, 67]);
    expect(offs).toEqual([48, 60, 64, 67]);
  });
});
