// Gera as notas de uma execução (padrões, dedilhado, humanização) a partir do
// arranjo expandido. Puro, sem Web Audio: usado pelo áudio do navegador, pela
// saída MIDI e pelo export .mid — assim o arquivo soa como o que se ouve.

import type { Expanded, PlaybackPattern } from "../core/song";
import { isCompound, secondsPerBeat, swingOffset } from "../core/timeline";
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
};

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

  expanded.events.forEach((ev, eventIndex) => {
    const def = getInstrumentDef(ev.instrument);
    const voiced = voiceChord(ev.chord);
    const notes = opts.fitToInstrument ? fitToRange(voiced, def.range).notes : voiced;
    if (!notes.length) return;
    const bass = voiced.length > 1 ? notes[0] : null;
    const spb = 60 / ev.bpm;
    const channel = opts.channelFor?.(ev.blockId) ?? 1;
    const pattern: PlaybackPattern = opts.fitToInstrument && def.polyphony === "mono" && ev.pattern === "block" ? "arp-up" : ev.pattern;
    const strum = opts.humanize ? strumFor(def) : 0;
    const push = (hits: Hit[]) => hits.forEach((h) => out.push({ ...h, channel, isBass: h.midi === bass, eventIndex, instrument: ev.instrument }));
    const at = (beat: number) => ev.startSec + beat * spb;

    if (pattern === "block") {
      push(strike(notes, ev.startSec, ev.durationSec * 0.97, 0.75, strum, opts.humanize, rng));
    } else if (pattern === "arp-up" || pattern === "arp-down") {
      const seq = pattern === "arp-up" ? notes : [...notes].reverse();
      const steps = Math.max(1, Math.floor(ev.beats / 0.5));
      const ring = opts.fitToInstrument && def.envelope === "decay" ? spb : 0.5 * spb * 0.92;
      for (let k = 0; k < steps; k++) {
        const velocity = (k % 2 === 0 ? 0.72 : 0.6) + (opts.humanize ? (rng() - 0.5) * 0.06 : 0);
        push([{ midi: seq[k % seq.length], time: at(k * 0.5 + swingOffset(opts.swing, k)), duration: ring, velocity }]);
      }
    } else {
      // Comping: 1, "e" do 2, 3, "e" do 4 (em janelas de 4 tempos).
      for (let b = 0; b < ev.beats; b += 4) {
        for (const off of [0, 1.5, 2, 3.5]) {
          if (b + off >= ev.beats) continue;
          const eighth = Math.round((b + off) / 0.5);
          push(strike(notes, at(b + off + swingOffset(opts.swing, eighth)), 0.45 * spb, off % 1 ? 0.55 : 0.7, strum, opts.humanize, rng));
        }
      }
    }
  });

  return out;
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
    const spb = secondsPerBeat(ev.bpm);
    const step = isCompound(ev.meter) ? 3 : 1;
    const first = ev.blockBeat;
    // Cliques nos tempos inteiros da grade do bloco que caem dentro do acorde (acordes de ½ tempo
    // podem deslocar o início do acorde para fora da grade).
    for (let k = Math.ceil(first - BEAT_EPS); k < first + ev.beats - BEAT_EPS; k++) {
      if (k % step !== 0) continue;
      clicks.push({ time: ev.startSec + (k - first) * spb, accent: k % ev.meter[0] === 0 });
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
