// Export .mid (DESIGN §6): mapa de tempo, fórmulas de compasso, marcadores com o
// nome dos blocos, trilhas separadas de acordes e baixo por canal, program change GM.

import { Midi } from "@tonejs/midi";
import { instrumentByPatchID } from "@tonejs/midi/dist/InstrumentMaps";
import { gmProgram, renderNotes } from "../audio/render";
import { chordSymbol } from "../core/modifiers";
import { resolveNotation, toAscii } from "../core/notation";
import type { Speller } from "../core/pitch";
import { expandArrangement, type Block, type Song, type TempoPoint } from "../core/song";

const PPQ = 480;
const ACOUSTIC_BASS = 32;

export type MidiExportOptions = {
  /** Canal global 1–16 (blocos podem sobrescrever com `midiChannel`). */
  channel: number;
  /** Separa o baixo do voicing numa trilha própria. */
  splitBass: boolean;
  /** Tônica (pitch class) do bloco para o bordão (respeita a tonalidade própria do bloco); sem ela, o bloco não exporta bordão. */
  tonicFor?: (blockId: string) => number | null;
  /** Escreve o nome de cada acorde como evento `lyrics` (ASCII: # b dim) no início dele. Padrão: true. */
  chordNames?: boolean;
  /** Grafia dos nomes de acorde por bloco (tonalidade própria). Padrão: derivada de `block.key`. */
  spellFor?: (block: Block) => Speller;
  /** Nome da música (trilha de andamento). */
  title?: string;
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
    // Primeiro acorde que começa em `sec` ou depois; sem ele (bloco vazio no fim), o fim da música.
    const i = expanded.events.findIndex((e) => e.startSec >= sec - 1e-6);
    return i >= 0 ? eventTicks[i] : tick;
  };

  // Tick de um tempo absoluto, inclusive no meio de um acorde (pontos de rampa de andamento).
  const tickAtBeat = (beat: number) => {
    const i = expanded.events.findIndex((e) => beat >= e.startBeat - 1e-6 && beat < e.startBeat + e.beats - 1e-6);
    if (i >= 0) {
      const e = expanded.events[i];
      return eventTicks[i] + Math.round((beat - e.startBeat) * PPQ * (4 / e.meter[1]));
    }
    const next = expanded.events.findIndex((e) => e.startBeat >= beat - 1e-6);
    return next >= 0 ? eventTicks[next] : tick;
  };
  const tickOf = (t: TempoPoint) => (t.startBeat !== undefined ? tickAtBeat(t.startBeat) : tickAtSec(t.startSec));

  // Rampas (`rampTo`) entram como um ponto de tempo por tempo, com o BPM médio dele.
  midi.header.tempos = expanded.tempoMap.map((t) => ({ ticks: tickOf(t), bpm: t.bpm * (4 / t.meter[1]) }));
  // Compasso só quando muda (pontos de rampa não repetem a fórmula).
  midi.header.timeSignatures = expanded.tempoMap
    .filter((t, i, all) => i === 0 || t.meter.join("/") !== all[i - 1].meter.join("/"))
    .map((t) => ({ ticks: tickOf(t), timeSignature: [...t.meter] }));
  if (opts.title?.trim()) midi.header.name = opts.title.trim();
  const meta: typeof midi.header.meta = expanded.markers.map((m) => ({ type: "marker", text: m.name, ticks: tickAtSec(m.startSec) }));
  if (opts.chordNames !== false) {
    // Nome do acorde em cada ataque (DAWs e MuseScore mostram lyrics); sem repetir enquanto o mesmo acorde continua.
    const spellFor = resolveNotation({ spellFor: opts.spellFor }).spellFor;
    expanded.events.forEach((ev, i) => {
      const block = song.blocks[ev.blockId];
      if (block) meta.push({ type: "lyrics", text: toAscii(chordSymbol(ev.chord, spellFor(block))), ticks: eventTicks[i] });
    });
  }
  midi.header.meta = meta.map((m, i) => ({ m, i })).sort((a, b) => a.m.ticks - b.m.ticks || a.i - b.i).map(({ m }) => m);
  midi.header.update();

  const notes = renderNotes(expanded, {
    swing: song.swing,
    fitToInstrument: false,
    humanize: false,
    channelFor: (blockId) => song.blocks[blockId]?.midiChannel ?? opts.channel,
    // A música manda: condução de vozes e re-ataque seguem o que está salvo nela.
    voiceLeading: song.voiceLeading,
    reattack: song.reattack,
    tonicFor: opts.tonicFor,
  });

  const tracks = new Map<string, ReturnType<Midi["addTrack"]>>();
  const trackFor = (bass: boolean, channel: number, bassInstrument?: string) => {
    const program = bass && bassInstrument ? gmProgram(bassInstrument, instrumentByPatchID) : undefined;
    const key = `${bass ? "b" : "c"}${channel}${program !== undefined ? `:${program}` : ""}`;
    let t = tracks.get(key);
    if (!t) {
      t = midi.addTrack();
      t.name = `${bass ? "Baixo" : "Acordes"}${channel !== opts.channel ? ` (ch ${channel})` : ""}`;
      t.channel = channel - 1;
      t.instrument.number = bass ? (program ?? ACOUSTIC_BASS) : gmProgram(song.instrument, instrumentByPatchID);
      tracks.set(key, t);
    }
    return t;
  };

  for (const n of notes) {
    // Camada de baixo (`bassInstrument`): a trilha usa o program do instrumento do bloco.
    const layer = n.isBass ? expanded.events[n.eventIndex].bassInstrument : undefined;
    trackFor(opts.splitBass && n.isBass, n.channel, layer).addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
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
