// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
  liveNoteOn: vi.fn(),
  liveNoteOff: vi.fn(),
  liveAllOff: vi.fn(),
}));

import { liveNoteOff, liveNoteOn } from "../audio/engine";
import { DEFAULT_MIDI } from "../audio/midi";
import { handleMidiMessage, pressedNotes, releaseAllInput, subscribeMidiInput, type MidiInputEvent } from "../audio/midiInput";
import { chordSymbol } from "../core/modifiers";
import { makeSpeller } from "../core/pitch";
import { selectBlock, useStore } from "../state/store";
import { LiveChordBadge } from "./LiveChord";
import { createChordRecorder, useMidiInput } from "./useMidiInput";

const on = (note: number, vel = 100) => handleMidiMessage([0x90, note, vel]);
const off = (note: number) => handleMidiMessage([0x80, note, 0]);
const pedal = (down: boolean) => handleMidiMessage([0xb0, 64, down ? 127 : 0]);

beforeEach(() => {
  releaseAllInput();
  useStore.getState().newSong();
  useStore.getState().setTonic(0);
  useStore.getState().setMidi({ ...DEFAULT_MIDI, inputEnabled: true });
  vi.mocked(liveNoteOn).mockClear();
  vi.mocked(liveNoteOff).mockClear();
});
afterEach(cleanup);

describe("mensagens MIDI", () => {
  it("note-on, note-off e note-on com velocity 0; pedal segura o som até subir", () => {
    const events: MidiInputEvent[] = [];
    const unsub = subscribeMidiInput((e) => events.push(e));
    on(60);
    on(64, 64);
    expect(pressedNotes()).toEqual([60, 64]);
    handleMidiMessage([0x91, 64, 0]); // canal 2, velocity 0 = soltar
    expect(pressedNotes()).toEqual([60]);
    pedal(true);
    off(60);
    expect(events.filter((e) => e.type === "sound-off").map((e) => e.note)).toEqual([64]); // 60 sustentada
    pedal(false);
    expect(events.filter((e) => e.type === "sound-off").map((e) => e.note)).toEqual([64, 60]);
    expect(events[1]).toEqual({ type: "press", note: 64, velocity: 64 / 127 });
    unsub();
  });

  it("All Notes Off solta tudo", () => {
    on(60);
    on(67);
    handleMidiMessage([0xb0, 123, 0]);
    expect(pressedNotes()).toEqual([]);
  });
});

describe("createChordRecorder", () => {
  it("grava o maior acorde do gesto quando todas as teclas sobem", () => {
    const got: string[] = [];
    const rec = createChordRecorder((r) => got.push(`${r.root}:${r.quality}`));
    rec.pressed([60, 64], null);
    rec.pressed([60, 64, 67], { root: 0, quality: "maj", modifiers: [] });
    rec.released([60, 64]); // soltar uma tecla antes não grava nem troca o acorde
    rec.pressed([60, 64, 69], { root: 9, quality: "m", modifiers: [], bass: 0 });
    rec.released([]);
    expect(got).toEqual(["9:m"]); // mesmo tamanho: vale o mais recente
    rec.released([]);
    expect(got).toHaveLength(1);
  });
});

function Host() {
  useMidiInput();
  return <LiveChordBadge />;
}

describe("useMidiInput + LiveChordBadge", () => {
  it("toca as notas (ouvir), mostra o acorde e, com gravação ligada, insere com o baixo", () => {
    useStore.getState().setMidi({ inputRecord: true });
    render(<Host />);
    const before = selectBlock(useStore.getState())!.chords.length;
    act(() => {
      on(41); // F2 no baixo: G7 na 3ª inversão
      on(55);
      on(59);
      on(62);
    });
    expect(vi.mocked(liveNoteOn)).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("group", { name: "Acorde no teclado MIDI" }).textContent).toContain("G7/F");
    act(() => {
      for (const n of [41, 55, 59, 62]) off(n);
    });
    expect(vi.mocked(liveNoteOff)).toHaveBeenCalledTimes(4);
    const chords = selectBlock(useStore.getState())!.chords;
    expect(chords).toHaveLength(before + 1);
    const added = chords.at(-1)!;
    expect(chordSymbol(added, makeSpeller(0, [0, 2, 4, 5, 7, 9, 11], "auto"))).toBe("G7/F");
    expect(useStore.getState().selectedChord).toBe(added.id);
  });

  it("sem gravação não mexe na progressão; sem ouvir não toca", () => {
    useStore.getState().setMidi({ inputRecord: false, inputThru: false });
    render(<Host />);
    const before = selectBlock(useStore.getState())!.chords.length;
    act(() => {
      on(62);
      on(65);
      on(69);
    });
    expect(screen.getByRole("group", { name: "Acorde no teclado MIDI" }).textContent).toContain("Dm");
    act(() => {
      for (const n of [62, 65, 69]) off(n);
    });
    expect(selectBlock(useStore.getState())!.chords).toHaveLength(before);
    expect(vi.mocked(liveNoteOn)).not.toHaveBeenCalled();
  });

  it("entrada desligada: selo some", () => {
    useStore.getState().setMidi({ inputEnabled: false });
    render(<Host />);
    expect(screen.queryByRole("group", { name: "Acorde no teclado MIDI" })).toBeNull();
  });
});

describe("revisão: portas, soltura forçada e realimentação", () => {
  it("a mesma nota por duas portas não re-ataca; só solta quando as duas soltam", () => {
    const events: MidiInputEvent[] = [];
    const unsub = subscribeMidiInput((e) => events.push(e));
    handleMidiMessage([0x90, 60, 100], "a");
    handleMidiMessage([0x90, 60, 100], "b");
    expect(events.filter((e) => e.type === "press")).toHaveLength(1);
    handleMidiMessage([0x80, 60, 0], "a");
    expect(pressedNotes()).toEqual([60]);
    handleMidiMessage([0x80, 60, 0], "b");
    expect(pressedNotes()).toEqual([]);
    expect(events.filter((e) => e.type === "release")).toHaveLength(1);
    unsub();
  });

  it("All Notes Off com acorde segurado não grava na progressão", () => {
    useStore.getState().setMidi({ inputRecord: true });
    render(<Host />);
    const before = selectBlock(useStore.getState())!.chords.length;
    act(() => {
      for (const n of [60, 64, 67]) on(n);
      handleMidiMessage([0xb0, 123, 0]);
    });
    expect(pressedNotes()).toEqual([]);
    expect(selectBlock(useStore.getState())!.chords).toHaveLength(before);
  });

  it("ligar a gravação com o acorde já segurado não grava esse acorde", () => {
    render(<Host />);
    const before = selectBlock(useStore.getState())!.chords.length;
    act(() => {
      for (const n of [60, 64, 67]) on(n);
      useStore.getState().setMidi({ inputRecord: true });
    });
    act(() => {
      for (const n of [60, 64, 67]) off(n);
    });
    expect(selectBlock(useStore.getState())!.chords).toHaveLength(before);
  });
});
