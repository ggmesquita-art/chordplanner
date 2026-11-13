// Motor de áudio (DESIGN §5.1): wrapper do Tone.js — instrumentos, preview e
// reprodução do arranjo já expandido (`expandArrangement`).

import * as Tone from "tone";
import type { Expanded } from "../core/song";
import { fitToRange } from "../core/voicing";
import { CacheStorage, ElectricPiano, Mallet, Smolken, Soundfont, SplendidGrandPiano, Versilian } from "smplr";
import { getInstrumentDef, type InstrumentDef, type SmplrSource, type SynthPreset } from "./instruments";
import { midiActive, midiChannel, midiMutesBrowser, noteOff, noteOn, panic, toMidiTime } from "./midi";
import { renderNotes, strike, strumFor } from "./render";

type Voice = {
  triggerAttackRelease: (notes: string[], duration: number, time?: number, velocity?: number) => unknown;
  releaseAll: (time?: number) => unknown;
};

export type LoadStatus = "idle" | "loading" | "ready" | "error";

// ——— Saída ————————————————————————————————————————————————————————————

let master: Tone.Gain | null = null;

/** Bus master: EQ → compressor → reverb → limiter. Cola os timbres e evita clipping. */
function output(): Tone.Gain {
  if (!master) {
    const limiter = new Tone.Limiter(-1).toDestination();
    const reverb = new Tone.Reverb({ decay: 3.2, preDelay: 0.02, wet: 0.2 });
    const comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.25 });
    const eq = new Tone.EQ3({ low: 0, mid: -1.5, high: 1.5, lowFrequency: 200, highFrequency: 4200 });
    master = new Tone.Gain(0.8);
    master.chain(eq, comp, reverb, limiter);
  }
  return master;
}

// ——— Instrumentos —————————————————————————————————————————————————————

/** Soma várias vozes (camadas), opcionalmente transpostas por semitons. */
function layer(...voices: [Voice, number?][]): Voice {
  return {
    triggerAttackRelease: (notes, dur, time, vel) =>
      voices.forEach(([v, shift]) =>
        v.triggerAttackRelease(shift ? notes.map((n) => Tone.Frequency(n).transpose(shift).toNote()) : notes, dur, time, vel),
      ),
    releaseAll: (time) => voices.forEach(([v]) => v.releaseAll(time)),
  };
}

type Fx = Tone.ToneAudioNode;

/** Liga o synth numa cadeia de efeitos até o master. Efeitos com LFO já saem ligados. */
function fx<T extends Tone.PolySynth>(synth: T, ...effects: Fx[]): T {
  for (const e of effects) if ("start" in e && typeof e.start === "function") (e as unknown as { start: () => void }).start();
  synth.chain(...effects, output());
  return synth;
}

const chorus = (frequency = 1.2, depth = 0.5, wet = 0.4) => new Tone.Chorus({ frequency, delayTime: 3.5, depth, spread: 180, wet });

function createSynth(preset: SynthPreset): Voice {
  switch (preset) {
    case "pad": {
      // Supersaw lento com filtro que abre devagar + camada suave uma oitava acima.
      const body = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 5, spread: 38 },
        filter: { type: "lowpass", rolloff: -24, Q: 0.8 },
        filterEnvelope: { attack: 1.4, decay: 2, sustain: 0.6, release: 3, baseFrequency: 220, octaves: 3.2 },
        envelope: { attack: 0.9, decay: 1, sustain: 0.85, release: 3 },
        volume: -22,
      });
      const air = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fattriangle", count: 3, spread: 20 },
        envelope: { attack: 1.2, decay: 1, sustain: 0.7, release: 3 },
        volume: -30,
      });
      const auto = new Tone.AutoFilter({ frequency: 0.08, baseFrequency: 600, octaves: 2.5, wet: 0.5 });
      return layer([fx(body, auto, chorus(0.6, 0.7, 0.5))], [fx(air, chorus(0.9, 0.6, 0.5)), 12]);
    }
    case "pluck": {
      // Envelope de filtro rápido (o "plink") + eco pingue-pongue discreto.
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 2, spread: 14 },
        filter: { type: "lowpass", rolloff: -24, Q: 2 },
        filterEnvelope: { attack: 0.001, decay: 0.28, sustain: 0.05, release: 0.4, baseFrequency: 350, octaves: 4.4 },
        envelope: { attack: 0.002, decay: 0.7, sustain: 0.05, release: 0.6 },
        volume: -18,
      });
      return fx(s, new Tone.PingPongDelay({ delayTime: "8n.", feedback: 0.22, wet: 0.16 }), chorus(1.5, 0.3, 0.25));
    }
    case "lead": {
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
        filter: { type: "lowpass", rolloff: -24, Q: 1.5 },
        filterEnvelope: { attack: 0.02, decay: 0.5, sustain: 0.5, release: 0.6, baseFrequency: 500, octaves: 3 },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.5 },
        volume: -22,
      });
      return fx(s, new Tone.Vibrato({ frequency: 5, depth: 0.06 }), new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.2, wet: 0.12 }));
    }
    case "bell": {
      const a = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 12,
        envelope: { attack: 0.001, decay: 2.2, sustain: 0, release: 2.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.6 },
        volume: -18,
      });
      const b = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 7.02,
        modulationIndex: 4,
        envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.2 },
        volume: -30,
      });
      return layer([fx(a, chorus(0.8, 0.4, 0.3))], [fx(b, chorus(0.8, 0.4, 0.3))]);
    }
    case "stab": {
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 4, spread: 30 },
        filter: { type: "lowpass", rolloff: -24, Q: 2.5 },
        filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.2, baseFrequency: 400, octaves: 3.6 },
        envelope: { attack: 0.003, decay: 0.3, sustain: 0.1, release: 0.25 },
        volume: -22,
      });
      return fx(s, new Tone.Distortion({ distortion: 0.12, wet: 0.3 }), chorus(2, 0.4, 0.3));
    }
    case "fmkeys": {
      // Piano elétrico em FM: ataque com "tine" e corpo que decai.
      const s = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1,
        modulationIndex: 3.2,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.003, decay: 1.8, sustain: 0.25, release: 1.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.8 },
        volume: -14,
      });
      return fx(s, new Tone.Tremolo({ frequency: 4.5, depth: 0.25, spread: 180 }), chorus(0.9, 0.5, 0.35));
    }
    case "supersaw": {
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 7, spread: 45 },
        filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
        filterEnvelope: { attack: 0.01, decay: 0.8, sustain: 0.7, release: 1, baseFrequency: 900, octaves: 2.5 },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.9 },
        volume: -26,
      });
      return fx(s, chorus(0.7, 0.6, 0.45), new Tone.PingPongDelay({ delayTime: "8n", feedback: 0.2, wet: 0.12 }));
    }
    case "gamelan": {
      // Metalofone aproximado: dois parciais FM inarmônicos com decaimento longo.
      const a = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2.76,
        modulationIndex: 6,
        envelope: { attack: 0.001, decay: 3, sustain: 0, release: 3 },
        modulationEnvelope: { attack: 0.001, decay: 0.9, sustain: 0.1, release: 1 },
        volume: -16,
      });
      const b = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 5.4,
        modulationIndex: 2,
        envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.4 },
        volume: -28,
      });
      return layer([fx(a, chorus(0.3, 0.3, 0.3))], [fx(b)]);
    }
    case "poly":
    default: {
      // Poly analógico quente: 3 serras desafinadas, filtro com envelope, chorus estéreo.
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: 18 },
        filter: { type: "lowpass", rolloff: -24, Q: 1 },
        filterEnvelope: { attack: 0.005, decay: 0.7, sustain: 0.35, release: 1.2, baseFrequency: 280, octaves: 3.4 },
        envelope: { attack: 0.006, decay: 0.5, sustain: 0.6, release: 1.3 },
        volume: -20,
      });
      return fx(s, chorus(1.1, 0.55, 0.45));
    }
  }
}

// ——— Samples: smplr (principal) e FluidR3 via Tone.Sampler (plano B) ————————————

const GM_BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Amostras a cada terça menor dentro da tessitura; o Sampler transpõe o resto. */
function sampleUrls(def: InstrumentDef): Record<number, string> {
  const urls: Record<number, string> = {};
  const lo = Math.max(21, def.range[0] - 3);
  const hi = Math.min(108, def.range[1] + 3);
  for (let m = lo; m <= hi; m++) {
    const pc = m % 12;
    if (pc % 3 !== 0) continue;
    urls[m] = `${FLAT_NAMES[pc]}${Math.floor(m / 12) - 1}.mp3`;
  }
  return urls;
}

/** Plano B: banco FluidR3 em mp3, carregado pelo Tone.Sampler. */
function loadGmSampler(def: InstrumentDef, entry: Loaded) {
  const sampler = new Tone.Sampler({
    urls: sampleUrls(def),
    baseUrl: `${GM_BASE}${def.source.gm}-mp3/`,
    release: def.envelope === "decay" ? 1.2 : 0.6,
    volume: -6,
    onload: () => {
      entry.voice = sampler;
      entry.status = "ready";
      notifyStatus();
    },
    onerror: () => {
      entry.status = "error";
      notifyStatus();
    },
  }).connect(output());
}

type SmplrInstrument = ReturnType<typeof Soundfont>;

let smplrSink: AudioNode | null = null;
/** Entrada nativa ligada ao bus master do Tone: os samples do smplr passam pelo mesmo EQ/comp/reverb. */
function sink(): AudioNode {
  if (!smplrSink) {
    const gain = Tone.getContext().createGain();
    Tone.connect(gain, output());
    smplrSink = gain as unknown as AudioNode;
  }
  return smplrSink;
}

let storage: ReturnType<typeof CacheStorage> | undefined;
/** Cache API (só em contexto seguro: https ou localhost) evita baixar os samples de novo. */
function sampleStorage() {
  if (storage === undefined && typeof window !== "undefined" && window.isSecureContext && "caches" in window) {
    storage = CacheStorage("chordplanner-samples");
  }
  return storage;
}

function createSmplr(src: SmplrSource): SmplrInstrument {
  // Mesmo AudioContext do Tone: os tempos do Transport valem para o smplr.
  const ctx = Tone.getContext().rawContext as unknown as AudioContext;
  const common = { destination: sink(), storage: sampleStorage() };
  switch (src.kind) {
    case "grand-piano":
      return SplendidGrandPiano(ctx, { ...common, decayTime: 0.6 });
    case "electric-piano":
      return ElectricPiano(ctx, { ...common, instrument: src.name });
    case "mallet":
      return Mallet(ctx, { ...common, instrument: src.name });
    case "smolken":
      return Smolken(ctx, { ...common, instrument: src.name });
    case "versilian":
      return Versilian(ctx, { ...common, instrument: src.name });
    case "soundfont":
      return Soundfont(ctx, { ...common, instrument: src.name, kit: "MusyngKite" });
  }
}

function smplrVoice(inst: SmplrInstrument): Voice {
  return {
    triggerAttackRelease: (notes, duration, time, velocity = 0.8) => {
      for (const n of notes) {
        inst.start({ note: Tone.Frequency(n).toMidi(), velocity: Math.max(1, Math.round(velocity * 127)), time, duration });
      }
    },
    releaseAll: () => inst.stop(),
  };
}

type Loaded = { voice: Voice; status: LoadStatus };

const loaded = new Map<string, Loaded>();
const statusListeners = new Set<() => void>();
const notifyStatus = () => statusListeners.forEach((l) => l());

export function subscribeStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function instrumentStatus(id: string): LoadStatus {
  return loaded.get(id)?.status ?? "idle";
}

let fallbackVoice: Voice | null = null;
const fallback = () => (fallbackVoice ??= createSynth("poly"));

function ensureInstrument(id: string): Loaded {
  const existing = loaded.get(id);
  if (existing) return existing;
  const def = getInstrumentDef(id);
  if (def.engine === "synth") {
    const entry: Loaded = { voice: createSynth(def.source.preset ?? "poly"), status: "ready" };
    loaded.set(id, entry);
    return entry;
  }
  // Enquanto os samples carregam, um synth toca no lugar.
  const entry: Loaded = { voice: fallback(), status: "loading" };
  loaded.set(id, entry);
  notifyStatus();

  const fallBackToGm = () => (def.source.gm ? loadGmSampler(def, entry) : ((entry.status = "error"), notifyStatus()));
  if (!def.source.smplr) {
    fallBackToGm();
    return entry;
  }
  try {
    const inst = createSmplr(def.source.smplr);
    inst.ready.then(
      () => {
        entry.voice = smplrVoice(inst);
        entry.status = "ready";
        notifyStatus();
      },
      (err: unknown) => {
        console.warn(`smplr falhou para ${def.name}; usando FluidR3`, err);
        fallBackToGm();
      },
    );
  } catch (err) {
    console.warn(`smplr indisponível para ${def.name}; usando FluidR3`, err);
    fallBackToGm();
  }
  return entry;
}

/** Pré-carrega um instrumento (ex.: ao selecioná-lo). */
export function preload(id: string) {
  ensureInstrument(id);
}

// ——— Reprodução ———————————————————————————————————————————————————————

const toNote = (midi: number) => Tone.Frequency(midi, "midi").toNote();

const rawCtx = () => Tone.getContext().rawContext as unknown as AudioContext;

export async function unlock() {
  if (Tone.getContext().state !== "running") await Tone.start();
}

/** Envia uma nota ao MIDI no tempo de áudio indicado, com note-off agendado. */
function sendMidiNote(channel: number, midi: number, velocity: number, time: number, duration: number) {
  const ctx = rawCtx();
  noteOn(channel, midi, velocity, toMidiTime(time, ctx));
  noteOff(channel, midi, toMidiTime(time + duration, ctx));
}

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
    hits.forEach((h) => sendMidiNote(midiChannel(), h.midi, h.velocity, h.time, h.duration));
    if (midiMutesBrowser()) return;
  }

  const { voice } = ensureInstrument(instrumentId);
  // Escalas tocam em sequência: não passam pelo ajuste de tessitura, que deduplicaria oitavas.
  const notes = opts.arpeggio ? midi : fitToRange(midi, def.range).notes;
  const hits = arpeggiate
    ? notes.map((m, i) => ({ midi: m, time: now + i * step, duration: step * 1.6, velocity: 0.8 }))
    : strike(notes, now, seconds, 0.8, strumFor(def), true, Math.random);
  hits.forEach((h) => voice.triggerAttackRelease([toNote(h.midi)], h.duration, h.time, h.velocity));
}

let click: Tone.Synth | null = null;
const metronomeVoice = () =>
  (click ??= new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    volume: -14,
  }).toDestination());

export type PlayOptions = {
  loop: boolean;
  metronome: boolean;
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

  // Playhead e metrônomo, por acorde.
  let blockKey = "";
  let beatInBlock = 0;
  events.forEach((ev, index) => {
    transport.schedule((time) => draw.schedule(() => opts.onEvent(index), time), ev.startSec);
    const key = `${ev.itemIndex}:${ev.repetition}`;
    if (key !== blockKey) {
      blockKey = key;
      beatInBlock = 0;
    }
    const firstBeat = beatInBlock;
    beatInBlock += ev.beats;
    if (opts.metronome) {
      const spb = 60 / ev.bpm;
      for (let b = 0; b < ev.beats; b++) {
        const accent = (firstBeat + b) % ev.meter[0] === 0;
        transport.schedule((time) => void metronomeVoice().triggerAttackRelease(accent ? 1760 : 1100, 0.03, time), ev.startSec + b * spb);
      }
    }
  });

  // Saída MIDI: notas sem ajuste de tessitura (o plugin decide o timbre). Cada evento
  // passa pelo Transport, então parar cancela o que ainda não saiu.
  if (midiActive()) {
    for (const n of renderNotes(expanded, { swing: opts.swing, fitToInstrument: false, humanize: true, channelFor: opts.channelFor })) {
      transport.schedule((time) => noteOn(n.channel, n.midi, n.velocity, toMidiTime(time, rawCtx())), n.time);
      transport.schedule((time) => noteOff(n.channel, n.midi, toMidiTime(time, rawCtx())), n.time + n.duration);
    }
  }

  // Áudio do navegador.
  if (!midiMutesBrowser()) {
    for (const n of renderNotes(expanded, { swing: opts.swing, fitToInstrument: true, humanize: true })) {
      const entry = ensureInstrument(n.instrument);
      const note = toNote(n.midi);
      transport.schedule((time) => void entry.voice.triggerAttackRelease([note], n.duration, time, n.velocity), n.time);
    }
  }

  if (opts.loop) {
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = totalSec;
  } else {
    transport.loop = false;
    transport.schedule((time) => draw.schedule(() => opts.onEnd(), time), totalSec);
  }
  transport.start("+0.05");
}

export function stop() {
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.position = 0;
  loaded.forEach((l) => l.voice.releaseAll());
  fallbackVoice?.releaseAll();
  panic();
}
