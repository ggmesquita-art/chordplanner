// Export .mid (DESIGN §6): mapa de tempo, fórmulas de compasso, marcadores com o
// nome dos blocos, trilhas separadas de acordes e baixo por canal, program change GM.

import { Midi } from "@tonejs/midi";
import { instrumentByPatchID } from "@tonejs/midi/dist/InstrumentMaps";
import { gmProgram, renderNotes } from "../audio/render";
import { expandArrangement, type Song } from "../core/song";

const PPQ = 480;
const ACOUSTIC_BASS = 32;

export type MidiExportOptions = {
  /** Canal global 1–16 (blocos podem sobrescrever com `midiChannel`). */
  channel: number;
  /** Separa o baixo do voicing numa trilha própria. */
  splitBass: boolean;
};

export function songToMidi(song: Song, opts: MidiExportOptions): Uint8Array {
  const expanded = expandArrangement(song);
  const midi = new Midi();
  midi.header.setTempo(120); // substituído abaixo; garante a estrutura do header

  // Ticks absolutos de cada acorde. O "tempo" do app é a unidade do denominador;
  // em MIDI, a semínima: em x/8, um tempo = PPQ/2 ticks e o BPM de semínima é bpm/2.
  const eventTicks: number[] = [];
  let tick = 0;
  for (const ev of expanded.events) {
    eventTicks.push(tick);
    tick += Math.round(ev.beats * PPQ * (4 / ev.meter[1]));
  }
  const tickAtSec = (sec: number) => {
    const i = expanded.events.findIndex((e) => Math.abs(e.startSec - sec) < 1e-6);
    return i >= 0 ? eventTicks[i] : 0;
  };

  midi.header.tempos = expanded.tempoMap.map((t) => ({ ticks: tickAtSec(t.startSec), bpm: t.bpm * (4 / t.meter[1]) }));
  midi.header.timeSignatures = expanded.tempoMap.map((t) => ({ ticks: tickAtSec(t.startSec), timeSignature: [...t.meter] }));
  midi.header.meta = expanded.markers.map((m) => ({ type: "marker", text: m.name, ticks: tickAtSec(m.startSec) }));
  midi.header.update();

  const notes = renderNotes(expanded, {
    swing: song.swing,
    fitToInstrument: false,
    humanize: false,
    channelFor: (blockId) => song.blocks[blockId]?.midiChannel ?? opts.channel,
  });

  const tracks = new Map<string, ReturnType<Midi["addTrack"]>>();
  const trackFor = (bass: boolean, channel: number) => {
    const key = `${bass ? "b" : "c"}${channel}`;
    let t = tracks.get(key);
    if (!t) {
      t = midi.addTrack();
      t.name = `${bass ? "Baixo" : "Acordes"}${channel !== opts.channel ? ` (ch ${channel})` : ""}`;
      t.channel = channel - 1;
      t.instrument.number = bass ? ACOUSTIC_BASS : gmProgram(song.instrument, instrumentByPatchID);
      tracks.set(key, t);
    }
    return t;
  };

  for (const n of notes) {
    trackFor(opts.splitBass && n.isBass, n.channel).addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
  }
  return midi.toArray();
}

/** Baixa o arquivo no navegador. */
export function downloadMidi(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "chordplanner"}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
