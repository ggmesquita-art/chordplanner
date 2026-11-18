// Motor de áudio (DESIGN §5.1): transporte, preview, metrônomo e reprodução do arranjo
// já expandido (`expandArrangement`). O carregamento de instrumentos fica em loaders.ts.

import * as Tone from "tone";
import type { Expanded } from "../core/song";
import { fitToRange } from "../core/voicing";
import { getInstrumentDef } from "./instruments";
import { ensureInstrument, limiterInput, pinPlaying, pinPreview, releaseAllVoices } from "./loaders";
import { midiActive, midiChannel, midiMutesBrowser, noteOff, noteOn, panic, toMidiTime } from "./midi";
import { countIn, metronomeClicks, renderNotes, strike, strumFor } from "./render";

// API de carregamento/status usada pela UI.
export { disposeInstrument, instrumentProgress, instrumentStatus, pickEviction, preload, subscribeStatus, type LoadStatus } from "./loaders";

const toNote = (midi: number) => Tone.Frequency(midi, "midi").toNote();

const rawCtx = () => Tone.getContext().rawContext as unknown as AudioContext;

// onEnd da reprodução em andamento (null = parado): chamado se o contexto for suspenso no meio.
let currentOnEnd: (() => void) | null = null;
let watchedCtx: AudioContext | null = null;

/** Contexto suspenso/interrompido durante a reprodução (aba em segundo plano no iOS, troca de saída): para e avisa a UI. */
function watchContext() {
  const ctx = rawCtx();
  if (watchedCtx === ctx) return;
  watchedCtx = ctx;
  ctx.addEventListener("statechange", () => {
    if (!currentOnEnd || ctx.state === "running") return;
    const onEnd = currentOnEnd;
    stop();
    onEnd();
  });
}

export async function unlock() {
  if (Tone.getContext().state !== "running") await Tone.start();
}

// ——— Preview ——————————————————————————————————————————————————————————

// Ataques do preview ficam em timers cancelháveis (não pré-agendados no áudio/MIDI), para o stop() poder cortá-los.
const previewTimers = new Set<ReturnType<typeof setTimeout>>();

/** Executa `fn` perto do tempo de áudio `time` (adiantado em `lead` s); já passou do prazo: executa na hora. */
function later(time: number, lead: number, fn: () => void) {
  const delay = (time - Tone.now() - lead) * 1000;
  if (delay <= 0) {
    fn();
    return;
  }
  const t = setTimeout(() => {
    previewTimers.delete(t);
    fn();
  }, delay);
  previewTimers.add(t);
}

/** Antecedência dos ataques do navegador: o `time` exato vai ao instrumento, sem depender do jitter do timer. */
const BROWSER_LEAD_S = 0.03;

/** Toca um acorde imediatamente (preview ao clicar, ▶ do seletor), no navegador e/ou no MIDI. */
export async function previewNotes(midi: number[], instrumentId: string, opts: { arpeggio?: boolean; seconds?: number } = {}) {
  await unlock();
  const def = getInstrumentDef(instrumentId);
  const seconds = opts.seconds ?? 1.4;
  const now = Tone.now() + 0.02;
  const arpeggiate = opts.arpeggio || def.polyphony === "mono";
  const step = opts.arpeggio ? 0.22 : 0.16;

  if (midiActive()) {
    const hits = arpeggiate
      ? midi.map((m, i) => ({ midi: m, time: now + i * step, duration: step * 1.6, velocity: 0.8 }))
      : strike(midi, now, seconds, 0.8, strumFor(def), true, Math.random);
    const channel = midiChannel();
    // Note-on e note-off saem na hora por timer (sem timestamp futuro), então o stop() ainda os recolhe.
    for (const h of hits) {
      later(h.time, 0, () => noteOn(channel, h.midi, h.velocity, toMidiTime(h.time, rawCtx())));
      later(h.time + h.duration, 0, () => noteOff(channel, h.midi, toMidiTime(h.time + h.duration, rawCtx())));
    }
    if (midiMutesBrowser()) return;
  }

  const { voice } = ensureInstrument(instrumentId);
  pinPreview(instrumentId);
  // Escalas tocam em sequência: não passam pelo ajuste de tessitura, que deduplicaria oitavas.
  const notes = opts.arpeggio ? midi : fitToRange(midi, def.range).notes;
  const hits = arpeggiate
    ? notes.map((m, i) => ({ midi: m, time: now + i * step, duration: step * 1.6, velocity: 0.8 }))
    : strike(notes, now, seconds, 0.8, strumFor(def), true, Math.random);
  for (const h of hits) {
    later(h.time, BROWSER_LEAD_S, () => void voice.triggerAttackRelease([toNote(h.midi)], h.duration, Math.max(h.time, Tone.now()), h.velocity));
  }
}

// ——— Metrônomo ————————————————————————————————————————————————————————

let click: Tone.Synth | null = null;
/** Clique pelo bus master, depois do reverb e antes do limiter: segue o limite de nível sem ficar "molhado". */
const metronomeVoice = () =>
  (click ??= new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    volume: -14,
  }).connect(limiterInput()));

// ——— Reprodução ———————————————————————————————————————————————————————

export type PlayOptions = {
  loop: boolean;
  metronome: boolean;
  /** Um compasso de cliques antes de começar (toca uma vez, mesmo com loop). */
  countIn?: boolean;
  swing: number;
  /** Canal MIDI de cada bloco (override do bloco ou global). */
  channelFor: (blockId: string) => number;
  onEvent: (index: number) => void;
  onEnd: () => void;
};

export async function play(expanded: Expanded, opts: PlayOptions) {
  await unlock();
  stop();
  const transport = Tone.getTransport();
  const draw = Tone.getDraw();
  const { events, totalSec } = expanded;
  if (!events.length || totalSec <= 0) return;
  watchContext();
  currentOnEnd = opts.onEnd;

  // Contagem: cliques em [0, offset); todo o resto é deslocado por `offset`.
  let offset = 0;
  if (opts.countIn) {
    const ci = countIn(expanded);
    offset = ci.seconds;
    for (const c of ci.clicks) {
      transport.schedule((time) => void metronomeVoice().triggerAttackRelease(c.accent ? 1760 : 1100, 0.03, time), c.time);
    }
  }

  // Playhead por acorde (o swing não desloca o ataque do acorde, só subdivisões internas).
  events.forEach((ev, index) => {
    transport.schedule((time) => draw.schedule(() => opts.onEvent(index), time), offset + ev.startSec);
  });

  if (opts.metronome) {
    for (const c of metronomeClicks(expanded)) {
      transport.schedule((time) => void metronomeVoice().triggerAttackRelease(c.accent ? 1760 : 1100, 0.03, time), offset + c.time);
    }
  }

  // Saída MIDI: notas sem ajuste de tessitura (o plugin decide o timbre). Cada evento
  // passa pelo Transport, então parar cancela o que ainda não saiu.
  if (midiActive()) {
    for (const n of renderNotes(expanded, { swing: opts.swing, fitToInstrument: false, humanize: true, channelFor: opts.channelFor })) {
      transport.schedule((time) => noteOn(n.channel, n.midi, n.velocity, toMidiTime(time, rawCtx())), offset + n.time);
      transport.schedule((time) => noteOff(n.channel, n.midi, toMidiTime(time, rawCtx())), offset + n.time + n.duration);
    }
  }

  // Áudio do navegador. Os instrumentos da execução ficam protegidos do descarte LRU.
  if (!midiMutesBrowser()) {
    const notes = renderNotes(expanded, { swing: opts.swing, fitToInstrument: true, humanize: true });
    pinPlaying(notes.map((n) => n.instrument));
    for (const n of notes) {
      const entry = ensureInstrument(n.instrument);
      const note = toNote(n.midi);
      transport.schedule((time) => void entry.voice.triggerAttackRelease([note], n.duration, time, n.velocity), offset + n.time);
    }
  }

  if (opts.loop) {
    transport.loop = true;
    transport.loopStart = offset;
    transport.loopEnd = offset + totalSec;
  } else {
    transport.loop = false;
    const finish = () => {
      currentOnEnd = null;
      opts.onEnd();
    };
    transport.schedule((time) => draw.schedule(finish, time), offset + totalSec);
  }
  transport.start("+0.05");
}

export function stop() {
  currentOnEnd = null;
  pinPlaying([]);
  // Cancela ataques de preview ainda pendentes (navegador e MIDI).
  previewTimers.forEach(clearTimeout);
  previewTimers.clear();
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.position = 0;
  releaseAllVoices();
  panic();
}
