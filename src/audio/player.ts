// Player (DESIGN §5.1): transporte, preview, metrônomo e reprodução do arranjo
// já expandido (`expandArrangement`). Carregado sob demanda por engine.ts (traz Tone/smplr).
// O carregamento de instrumentos fica em loaders.ts.

import "./toneContext";
import * as Tone from "tone";
import type { Expanded } from "../core/song";
import { fitToRange } from "../core/voicing";
import { getInstrumentDef } from "./instruments";
import { ensureInstrument, instrumentCacheKey, limiterInput, pinPlaying, pinPreview, releaseAllVoices, setTrackMix, trackEffectiveGain } from "./loaders";
import { midiActive, midiChannel, midiMelodyChannel, midiMutesBrowser, noteOff, noteOn, panic, toMidiTime } from "./midi";
import type { PlayOptions } from "./engine";
import { countIn, metronomeClicks, renderNotes, strike, strumFor, type PlaybackExtras } from "./render";
import { registerPlaybackClock, type TrackBus } from "./status";

export { disposeInstrument, preload, setTrackMix } from "./loaders";

const toNote = (midi: number) => Tone.Frequency(midi, "midi").toNote();

const rawCtx = () => Tone.getContext().rawContext as unknown as AudioContext;

// onEnd da reprodução em andamento (null = parado): chamado se o contexto for suspenso no meio.
let currentOnEnd: (() => void) | null = null;
let currentRun: { offset: number; totalSec: number } | null = null;
let watchedCtx: AudioContext | null = null;

export function getPlaybackTime(): { running: boolean; seconds: number; offset: number; totalSec: number } | null {
  if (!currentRun) return null;
  const t = Tone.getTransport();
  return { running: t.state === "started", seconds: t.seconds, offset: currentRun.offset, totalSec: currentRun.totalSec };
}
registerPlaybackClock(getPlaybackTime);

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

/** Toca um acorde ou nota imediatamente (preview ao clicar, ▶ do seletor), no navegador e/ou no MIDI. */
export async function previewNotes(midi: number[], instrumentId: string, opts: { arpeggio?: boolean; seconds?: number; track?: TrackBus } = {}) {
  await unlock();
  const def = getInstrumentDef(instrumentId);
  const track: TrackBus = opts.track ?? "chords";
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

  const { voice } = ensureInstrument(instrumentId, track);
  pinPreview(instrumentCacheKey(instrumentId, track));
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

export async function play(expanded: Expanded, opts: PlayOptions) {
  await unlock();
  stop();
  const transport = Tone.getTransport();
  const draw = Tone.getDraw();
  const { events, melodyEvents, totalSec } = expanded;
  if ((!events.length && !melodyEvents?.length) || totalSec <= 0) return;
  watchContext();
  currentOnEnd = opts.onEnd;
  if (opts.mixer) setTrackMix(opts.mixer);

  // Contagem: cliques em [0, offset); todo o resto é deslocado por `offset`.
  let offset = 0;
  if (opts.countIn) {
    const ci = countIn(expanded);
    offset = ci.seconds;
    for (const c of ci.clicks) {
      transport.schedule((time) => void metronomeVoice().triggerAttackRelease(c.accent ? 1760 : 1100, 0.03, time), c.time);
    }
  }
  currentRun = { offset, totalSec };

  // Playhead por acorde (o swing não desloca o ataque do acorde, só subdivisões internas).
  events.forEach((ev, index) => {
    transport.schedule((time) => draw.schedule(() => opts.onEvent(index), time), offset + ev.startSec);
  });

  if (opts.metronome) {
    for (const c of metronomeClicks(expanded)) {
      transport.schedule((time) => void metronomeVoice().triggerAttackRelease(c.accent ? 1760 : 1100, 0.03, time), offset + c.time);
    }
  }

  const extra: PlaybackExtras = { tonicFor: opts.tonicFor, reattack: opts.reattack, voiceLeading: opts.voiceLeading };

  // Saída MIDI: notas sem ajuste de tessitura (o plugin decide o timbre). Cada evento
  // passa pelo Transport, então parar cancela o que ainda não saiu.
  if (midiActive()) {
    for (const n of renderNotes(expanded, {
      swing: opts.swing,
      fitToInstrument: false,
      humanize: true,
      channelFor: opts.channelFor,
      melodyChannelFor: opts.melodyChannelFor,
      ...extra,
    })) {
      const bus: TrackBus = n.isMelody ? "melody" : "chords";
      transport.schedule((time) => {
        const g = trackEffectiveGain(bus);
        if (g <= 0) return;
        noteOn(n.channel, n.midi, Math.max(0.05, Math.min(1, n.velocity * g)), toMidiTime(time, rawCtx()));
      }, offset + n.time);
      transport.schedule((time) => noteOff(n.channel, n.midi, toMidiTime(time, rawCtx())), offset + n.time + n.duration);
    }
  }

  // Áudio do navegador. Os instrumentos da execução (por pista) ficam protegidos do descarte LRU.
  if (!midiMutesBrowser()) {
    const notes = renderNotes(expanded, { swing: opts.swing, fitToInstrument: true, humanize: true, ...extra });
    pinPlaying(notes.map((n) => instrumentCacheKey(n.instrument, n.isMelody ? "melody" : "chords")));
    for (const n of notes) {
      const entry = ensureInstrument(n.instrument, n.isMelody ? "melody" : "chords");
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
      opts.onEnd();
      currentOnEnd = null;
      currentRun = null;
    };
    transport.schedule((time) => draw.schedule(finish, time), offset + totalSec);
  }
  transport.start("+0.05");
}

// ——— Teclado MIDI ao vivo ————————————————————————————————————————————————

/** Notas soando por causa do teclado: voz que atacou (o instrumento pode mudar no meio), nota efetivamente tocada
 *  (transposta para a tessitura) e canal da saída MIDI, se repassada. */
const live = new Map<number, { voice: ReturnType<typeof ensureInstrument>["voice"] | null; played: string; midiOut: number | null }>();

/** Ataca uma nota tocada no teclado MIDI com o instrumento/pista atual (e/ou repassa à saída MIDI, se ativa). */
export function liveNoteOn(note: number, velocity: number, instrumentId: string, opts: { track?: TrackBus; channel?: number } = {}) {
  liveNoteOff(note);
  const track: TrackBus = opts.track ?? "chords";
  let midiOut: number | null = null;
  if (midiActive()) {
    midiOut = opts.channel ?? (track === "melody" ? midiMelodyChannel() : midiChannel());
    noteOn(midiOut, note, velocity);
  }
  let voice = null;
  // Fora da tessitura do instrumento, transpõe por oitavas (como na reprodução).
  const played = toNote(fitToRange([note], getInstrumentDef(instrumentId).range).notes[0] ?? note);
  if (!midiMutesBrowser()) {
    voice = ensureInstrument(instrumentId, track).voice;
    pinPreview(instrumentCacheKey(instrumentId, track));
    // immediate(): sem a antecipação (lookAhead) do Tone, que atrasaria cada tecla em ~100 ms.
    voice.triggerAttack([played], Tone.immediate(), Math.max(0.05, velocity));
  }
  live.set(note, { voice, played, midiOut });
}

export function liveNoteOff(note: number) {
  const entry = live.get(note);
  if (!entry) return;
  live.delete(note);
  if (entry.midiOut !== null) noteOff(entry.midiOut, note);
  entry.voice?.triggerRelease([entry.played], Tone.immediate());
}

export function liveAllOff() {
  for (const note of [...live.keys()]) liveNoteOff(note);
}

export function stop() {
  currentOnEnd = null;
  currentRun = null;
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
