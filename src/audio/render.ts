// Gera as notas de uma execução (padrões, dedilhado, humanização) a partir do
// arranjo expandido. Puro, sem Web Audio: usado pelo áudio do navegador, pela
// saída MIDI e pelo export .mid — assim o arquivo soa como o que se ouve.

import type { Expanded, PlaybackPattern, TimedChord } from "../core/song";
import { barLinesWithin, isCompound, rampSeconds, secondsPerBeat, swingOffset } from "../core/timeline";
import { fitToRange, voiceChord } from "../core/voicing";
import { getInstrumentDef, type InstrumentDef } from "./instruments";

export type NoteEvent = {
  midi: number;
  /** Segundos desde o início da execução. */
  time: number;
  duration: number;
  /** 0–1. */
  velocity: number;
  /** Canal MIDI 1–16. */
  channel: number;
  /** Nota do baixo (grave separado do voicing) — vai para a trilha de baixo no export. */
  isBass: boolean;
  /** Índice do acorde em `expanded.events`. */
  eventIndex: number;
  instrument: string;
};

export type RenderOptions = {
  swing: number;
  /** Ajusta à tessitura do instrumento do navegador e força arpejo em monofônicos. */
  fitToInstrument: boolean;
  /** Dedilhado e variação aleatória de intensidade/tempo. */
  humanize: boolean;
  channelFor?: (blockId: string) => number;
  rng?: () => number;
  /** Tônica (pitch class 0–11) do bloco, para o bordão; null/ausente = sem bordão. */
  tonicFor?: (blockId: string) => number | null;
  /** Re-ataca a cada compasso acordes longos de instrumentos de decay (padrão "block"). */
  reattack?: boolean;
  /** Condução de vozes: o voicing de cada acorde considera o anterior da mesma passada. */
  voiceLeading?: boolean;
};

/** Opções de execução que o `play` repassa ao `renderNotes`. */
export type PlaybackExtras = Pick<RenderOptions, "tonicFor" | "reattack" | "voiceLeading">;

/**
 * Posição absoluta (segundos) do tempo `beatOffset` dentro do acorde (offset em tempos desde o início
 * dele; pode passar de `beats`). Numa rampa de andamento integra o BPM linear com `rampSeconds`.
 */
function secAt(ev: TimedChord, beatOffset: number): number {
  if (!ev.ramp) return ev.startSec + beatOffset * (60 / ev.bpm);
  const { beats, from, to } = ev.ramp;
  return ev.startSec + rampSeconds(beats, from, to, ev.blockBeat, ev.blockBeat + beatOffset);
}

/** Duração (segundos) de `len` tempos que começam em `beatOffset` dentro do acorde. */
const spanSec = (ev: TimedChord, beatOffset: number, len: number) => secAt(ev, beatOffset + len) - secAt(ev, beatOffset);

const DRONE_BASE = 36; // C2
const DRONE_VELOCITY = 0.4;
const REATTACK_VELOCITY = 0.6;

/** Dedilhado por família: cordas espalham as notas; pads e sopros atacam juntos. */
export function strumFor(def: InstrumentDef): number {
  if (def.category === "plucked" || def.category === "world") return 0.022;
  if (def.category === "keys" || def.category === "mallet") return 0.012;
  if (def.source.preset === "pad" || def.source.preset === "supersaw") return 0;
  return 0.006;
}

type Hit = Pick<NoteEvent, "midi" | "time" | "duration" | "velocity">;

/**
 * Um ataque de acorde: grave → agudo com dedilhado, baixo e voz superior um pouco
 * mais fortes; com `humanize`, variação aleatória pequena.
 */
export function strike(notes: number[], start: number, duration: number, velocity: number, strum: number, humanize: boolean, rng: () => number): Hit[] {
  const last = notes.length - 1;
  return notes.map((midi, i) => {
    const accent = i === 0 ? 1.05 : i === last ? 1 : 0.86;
    const jitter = humanize ? (rng() - 0.5) * 0.08 : 0;
    const offset = humanize ? i * strum + rng() * 0.004 : 0;
    return {
      midi,
      time: start + offset,
      duration: Math.max(0.05, duration - (humanize ? i * strum : 0)),
      velocity: Math.max(0.1, Math.min(1, velocity * accent + jitter)),
    };
  });
}

export function renderNotes(expanded: Expanded, opts: RenderOptions): NoteEvent[] {
  const rng = opts.rng ?? Math.random;
  const out: NoteEvent[] = [];
  let prevNotes: number[] | null = null;
  let prevPass = "";

  expanded.events.forEach((ev, eventIndex) => {
    const def = getInstrumentDef(ev.instrument);
    // Condução de vozes: o "anterior" vale só dentro da mesma passada (item + repetição).
    const pass = `${ev.itemIndex}:${ev.repetition}`;
    if (pass !== prevPass) prevNotes = null;
    prevPass = pass;
    const voiced = voiceChord(ev.chord, opts.voiceLeading ? prevNotes : null);
    if (opts.voiceLeading) prevNotes = voiced;

    // Camada de baixo: a nota grave do voicing sai no instrumento próprio; o resto, no do acorde.
    const layerDef = ev.bassInstrument && voiced.length > 1 ? getInstrumentDef(ev.bassInstrument) : null;
    const layerNote0 = layerDef ? (opts.fitToInstrument ? fitToRange([voiced[0]], layerDef.range).notes[0] : voiced[0]) : undefined;
    const upper = layerDef ? voiced.slice(1) : voiced;
    const notes0 = opts.fitToInstrument ? fitToRange(upper, def.range).notes : upper;
    if (!notes0.length && layerNote0 === undefined) return;
    // Bordão na mesma altura do baixo: o note-off de um cortaria o outro (MIDI). Mantém o bordão e
    // omite o baixo duplicado deste acorde.
    const droneMidi = droneMidiFor(ev, opts);
    let notes = notes0;
    let layerNote = layerNote0;
    let bassDropped = false;
    if (layerNote !== undefined && layerNote === droneMidi) layerNote = undefined;
    if (!layerDef && voiced.length > 1 && notes.length > 1 && notes[0] === droneMidi) {
      notes = notes.slice(1);
      bassDropped = true;
    }
    if (!notes.length && layerNote === undefined) return;
    const bass = !layerDef && voiced.length > 1 && !bassDropped ? notes[0] : null;
    const channel = opts.channelFor?.(ev.blockId) ?? 1;
    const pattern: PlaybackPattern = opts.fitToInstrument && def.polyphony === "mono" && ev.pattern === "block" ? "arp-up" : ev.pattern;
    const strum = opts.humanize ? strumFor(def) : 0;
    const push = (hits: Hit[]) => hits.forEach((h) => out.push({ ...h, channel, isBass: h.midi === bass, eventIndex, instrument: ev.instrument }));
    const at = (beat: number) => secAt(ev, beat);

    if (layerNote !== undefined && ev.bassInstrument) {
      // Uma vez por acorde, no início, sustentado até o fim.
      const [h] = strike([layerNote], ev.startSec, ev.durationSec * 0.97, pattern === "block" || pattern === "comping" ? 0.75 : 0.7, 0, opts.humanize, rng);
      out.push({ ...h, channel, isBass: true, eventIndex, instrument: ev.bassInstrument });
    }
    if (!notes.length) return;

    if (pattern === "block") {
      // Re-ataque: acordes de decay com mais de um compasso voltam a soar a cada barra de compasso do bloco.
      const cuts = opts.reattack && def.envelope === "decay" ? barLinesWithin(ev.blockBeat, ev.beats, ev.meter) : [];
      if (!cuts.length) {
        push(strike(notes, ev.startSec, ev.durationSec * 0.97, 0.75, strum, opts.humanize, rng));
      } else {
        const edges = [0, ...cuts, ev.beats];
        for (let i = 0; i < edges.length - 1; i++) {
          push(strike(notes, at(edges[i]), spanSec(ev, edges[i], edges[i + 1] - edges[i]) * 0.97, i === 0 ? 0.75 : REATTACK_VELOCITY, strum, opts.humanize, rng));
        }
      }
    } else if (pattern === "arp-up" || pattern === "arp-down") {
      const seq = pattern === "arp-up" ? notes : [...notes].reverse();
      const steps = Math.max(1, Math.floor(ev.beats / 0.5));
      for (let k = 0; k < steps; k++) {
        const t0 = k * 0.5 + swingOffset(opts.swing, k);
        const ring = opts.fitToInstrument && def.envelope === "decay" ? spanSec(ev, k * 0.5, 1) : spanSec(ev, k * 0.5, 0.5) * 0.92;
        const velocity = (k % 2 === 0 ? 0.72 : 0.6) + (opts.humanize ? (rng() - 0.5) * 0.06 : 0);
        push([{ midi: seq[k % seq.length], time: at(t0), duration: ring, velocity }]);
      }
    } else {
      // Comping: 1, "e" do 2, 3, "e" do 4 (em janelas de 4 tempos).
      for (let b = 0; b < ev.beats; b += 4) {
        for (const off of [0, 1.5, 2, 3.5]) {
          if (b + off >= ev.beats) continue;
          const eighth = Math.round((b + off) / 0.5);
          push(strike(notes, at(b + off + swingOffset(opts.swing, eighth)), spanSec(ev, b + off, 0.45), off % 1 ? 0.55 : 0.7, strum, opts.humanize, rng));
        }
      }
    }
  });

  renderDrones(expanded, opts, out);
  return out;
}

/** Altura do bordão do evento (ajustada à tessitura se pedido); undefined = sem bordão. */
function droneMidiFor(ev: TimedChord, opts: RenderOptions): number | undefined {
  const def = getInstrumentDef(ev.instrument);
  if (!ev.drone || !def.drone) return undefined;
  const tonic = opts.tonicFor?.(ev.blockId);
  if (tonic === null || tonic === undefined) return undefined;
  return opts.fitToInstrument ? fitToRange([DRONE_BASE + tonic], def.range).notes[0] : DRONE_BASE + tonic;
}

/**
 * Bordão: uma nota na tônica (2ª oitava) do início ao fim de cada passada de bloco com `drone`, em
 * instrumentos que o suportam. Instrumentos de decay (sitar) re-atacam a cada compasso.
 */
function renderDrones(expanded: Expanded, opts: RenderOptions, out: NoteEvent[]) {
  const { events } = expanded;
  for (let i = 0; i < events.length; ) {
    const first = events[i];
    let j = i;
    while (j + 1 < events.length && events[j + 1].itemIndex === first.itemIndex && events[j + 1].repetition === first.repetition) j++;
    const group = events.slice(i, j + 1);
    const eventIndex = i;
    i = j + 1;

    const def = getInstrumentDef(first.instrument);
    const midi = droneMidiFor(first, opts);
    if (midi === undefined) continue;

    const lastEv = group[group.length - 1];
    const endBeat = lastEv.blockBeat + lastEv.beats;
    const posSec = (beat: number) => {
      const ev = group.find((e) => beat <= e.blockBeat + e.beats + 1e-9) ?? lastEv;
      return secAt(ev, beat - ev.blockBeat);
    };
    const cuts = def.envelope === "decay" ? barLinesWithin(first.blockBeat, endBeat - first.blockBeat, first.meter).map((o) => first.blockBeat + o) : [];
    const edges = [first.blockBeat, ...cuts, endBeat];
    const channel = opts.channelFor?.(first.blockId) ?? 1;
    for (let k = 0; k < edges.length - 1; k++) {
      const time = posSec(edges[k]);
      out.push({ midi, time, duration: posSec(edges[k + 1]) - time, velocity: DRONE_VELOCITY, channel, isBass: false, eventIndex, instrument: first.instrument });
    }
  }
}

export type CountInClick = { time: number; accent: boolean };

/**
 * Cliques do metrônomo para todos os eventos, com tempos relativos ao início.
 * Acento no tempo 1 de cada compasso (contado por bloco/repetição). Em fórmulas
 * compostas (6/8, 12/8) só há clique no início de cada pulso (a cada 3 tempos).
 */
export function metronomeClicks(expanded: Expanded): CountInClick[] {
  const clicks: CountInClick[] = [];
  for (const ev of expanded.events) {
    const step = isCompound(ev.meter) ? 3 : 1;
    const first = ev.blockBeat;
    // Cliques nos tempos inteiros da grade do bloco que caem dentro do acorde (acordes de ½ tempo
    // podem deslocar o início do acorde para fora da grade).
    for (let k = Math.ceil(first - BEAT_EPS); k < first + ev.beats - BEAT_EPS; k++) {
      if (k % step !== 0) continue;
      clicks.push({ time: secAt(ev, k - first), accent: k % ev.meter[0] === 0 });
    }
  }
  return clicks;
}

const BEAT_EPS = 1e-6;

/**
 * Contagem no andamento e na fórmula do primeiro acorde (compostos: um clique por pulso): um compasso
 * inteiro e, se a reprodução começa no meio do compasso (região), os tempos até lá — assim o primeiro
 * acorde cai no tempo certo da contagem.
 */
export function countIn(expanded: Expanded): { seconds: number; clicks: CountInClick[] } {
  const first = expanded.events[0];
  if (!first) return { seconds: 0, clicks: [] };
  const spb = secondsPerBeat(first.bpm);
  const [perBar] = first.meter;
  const step = isCompound(first.meter) ? 3 : 1;
  const lead = perBar + (((first.blockBeat % perBar) + perBar) % perBar);
  const clicks: CountInClick[] = [];
  for (let k = 0; k < lead - BEAT_EPS; k += step) clicks.push({ time: k * spb, accent: k % perBar === 0 });
  return { seconds: lead * spb, clicks };
}

/** Programa General MIDI (0–127) do instrumento, pelo nome do banco GM. */
export function gmProgram(instrumentId: string, patchNames: string[]): number {
  const gm = getInstrumentDef(instrumentId).source.gm;
  const i = gm ? patchNames.indexOf(gm.replace(/_/g, " ")) : -1;
  return i >= 0 ? i : 0;
}
