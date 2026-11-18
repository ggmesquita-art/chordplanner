// Carregamento de instrumentos (DESIGN §5.1/§7): synths, samples do smplr, plano B
// FluidR3, cache, status/progresso e descarte LRU. Também é dono do bus master.

import "./toneContext";
import * as Tone from "tone";
import { CacheStorage, ElectricPiano, Mallet, Smolken, Soundfont, SplendidGrandPiano, Versilian } from "smplr";
import { getInstrumentDef, type InstrumentDef, type SmplrSource, type SynthPreset } from "./instruments";
import { clearProgress, clearStatus, pickEviction, reportProgress, setStatus } from "./status";

export { pickEviction };

type RawVoice = {
  triggerAttackRelease: (notes: string[], duration: number, time?: number, velocity?: number) => unknown;
  releaseAll: (time?: number) => unknown;
};

export type Voice = RawVoice;

/** Limite de instrumentos sampleados em memória; synths têm teto próprio (são leves). */
export const MAX_SAMPLED = 6;
const MAX_SYNTHS = 8;
/** Sem resposta dos samples neste prazo, o carregamento conta como erro (cai no plano B/synth). */
export const LOAD_TIMEOUT_MS = 20_000;

// ——— Saída ————————————————————————————————————————————————————————————

let master: Tone.Gain | null = null;
let limiterNode: Tone.Limiter | null = null;

/** Bus master: EQ → compressor → reverb → limiter. Cola os timbres e evita clipping. */
export function output(): Tone.Gain {
  if (!master) {
    const limiter = new Tone.Limiter(-1).toDestination();
    limiterNode = limiter;
    const reverb = new Tone.Reverb({ decay: 3.2, preDelay: 0.02, wet: 0.2 });
    const comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.25 });
    const eq = new Tone.EQ3({ low: 0, mid: -1.5, high: 1.5, lowFrequency: 200, highFrequency: 4200 });
    master = new Tone.Gain(0.8);
    master.chain(eq, comp, reverb, limiter);
  }
  return master;
}

/** Entrada do limiter (depois do reverb): para o clique do metrônomo, que não deve ficar "molhado". */
export function limiterInput(): Tone.ToneAudioNode {
  output();
  return limiterNode!;
}

// ——— Instrumentos —————————————————————————————————————————————————————

/** Soma várias vozes (camadas), opcionalmente transpostas por semitons. */
function layer(...voices: [RawVoice, number?][]): RawVoice {
  return {
    triggerAttackRelease: (notes, dur, time, vel) =>
      voices.forEach(([v, shift]) =>
        v.triggerAttackRelease(shift ? notes.map((n) => Tone.Frequency(n).transpose(shift).toNote()) : notes, dur, time, vel),
      ),
    releaseAll: (time) => voices.forEach(([v]) => v.releaseAll(time)),
  };
}

type Fx = Tone.ToneAudioNode;
type Wire = <T extends Tone.PolySynth>(synth: T, ...effects: Fx[]) => T;

const chorus = (frequency = 1.2, depth = 0.5, wet = 0.4) => new Tone.Chorus({ frequency, delayTime: 3.5, depth, spread: 180, wet });

/** Cria o synth e devolve a voz com `dispose` (solta notas e descarta synths e efeitos). */
function createSynth(preset: SynthPreset): Voice & { dispose: () => void } {
  const nodes: Fx[] = [];
  // Liga o synth numa cadeia de efeitos até o master. Efeitos com LFO já saem ligados.
  const fx: Wire = (synth, ...effects) => {
    for (const e of effects) if ("start" in e && typeof e.start === "function") (e as unknown as { start: () => void }).start();
    synth.chain(...effects, output());
    nodes.push(synth, ...effects);
    return synth;
  };
  const voice = buildSynth(preset, fx);
  return {
    triggerAttackRelease: (...args) => voice.triggerAttackRelease(...args),
    releaseAll: (time) => voice.releaseAll(time),
    dispose: () => {
      voice.releaseAll();
      nodes.forEach((n) => n.dispose());
    },
  };
}

function buildSynth(preset: SynthPreset, fx: Wire): RawVoice {
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

type SmplrInstrument = ReturnType<typeof Soundfont>;

type Loaded = {
  id: string;
  voice: Voice;
  sampled: boolean;
  lastUsed: number;
  disposed: boolean;
  /** Recursos próprios (synth, instância do smplr ou Sampler). A voz de reserva é compartilhada e não entra. */
  release?: () => void;
};

/** Rejeita se a promessa não resolver em `ms` (carregamento de samples sem resposta). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sem resposta em ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Plano B: banco FluidR3 em mp3, carregado pelo Tone.Sampler. */
function loadGmSampler(def: InstrumentDef, entry: Loaded) {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = () => {
    if (settled || entry.disposed) return;
    settled = true;
    clearTimeout(timer);
    entry.release?.();
    entry.release = undefined;
    setStatus(entry.id, "error");
  };
  const sampler = new Tone.Sampler({
    urls: sampleUrls(def),
    baseUrl: `${GM_BASE}${def.source.gm}-mp3/`,
    release: def.envelope === "decay" ? 1.2 : 0.6,
    volume: -6,
    onload: () => {
      if (settled || entry.disposed) return;
      settled = true;
      clearTimeout(timer);
      entry.voice = sampler;
      setStatus(entry.id, "ready");
    },
    onerror: fail,
  }).connect(output());
  entry.release = () => {
    settled = true;
    clearTimeout(timer);
    sampler.dispose();
  };
  timer = setTimeout(fail, LOAD_TIMEOUT_MS);
}

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

function createSmplr(src: SmplrSource, onLoadProgress: (p: { loaded: number; total: number }) => void): SmplrInstrument {
  // Mesmo AudioContext do Tone: os tempos do Transport valem para o smplr.
  const ctx = Tone.getContext().rawContext as unknown as AudioContext;
  const common = { destination: sink(), storage: sampleStorage(), onLoadProgress };
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

const loaded = new Map<string, Loaded>();

let fallbackVoice: Voice | null = null;
/** Synth que toca no lugar de um instrumento ainda carregando (ou que falhou). Compartilhado e permanente. */
export const fallback = (): Voice => (fallbackVoice ??= createSynth("poly"));

/** Solta as notas de todos os instrumentos carregados (e do synth de reserva). */
export function releaseAllVoices() {
  loaded.forEach((l) => l.voice.releaseAll());
  fallbackVoice?.releaseAll();
}

// ——— Descarte (LRU) ———

/** Instrumentos "em uso": os do play() em andamento e o último tocado em preview. */
let playingIds = new Set<string>();
let previewId: string | null = null;
export const pinPlaying = (ids: Iterable<string>) => void (playingIds = new Set(ids));
export const pinPreview = (id: string | null) => void (previewId = id);

/** Descarta um instrumento: solta as notas e libera nós/instância; um novo uso recarrega (samples vêm do cache). */
export function disposeInstrument(id: string) {
  const entry = loaded.get(id);
  if (!entry) return;
  entry.disposed = true;
  loaded.delete(id);
  try {
    entry.release?.();
  } catch (err) {
    console.warn(`falha ao descartar ${id}`, err);
  }
  entry.release = undefined;
  clearStatus(id);
}

function evictExcess(keep: string) {
  const inUse = new Set([...playingIds, keep]);
  if (previewId) inUse.add(previewId);
  const all = [...loaded].map(([id, e]) => ({ id, lastUsed: e.lastUsed, sampled: e.sampled }));
  const sampled = pickEviction(all, inUse, MAX_SAMPLED);
  // Synths têm teto próprio: contam como "sampled" só nesta segunda passada.
  const synths = pickEviction(
    all.filter((e) => !e.sampled).map((e) => ({ ...e, sampled: true })),
    inUse,
    MAX_SYNTHS,
  );
  [...sampled, ...synths].forEach(disposeInstrument);
}

let clock = 0;

export function ensureInstrument(id: string): Loaded {
  const existing = loaded.get(id);
  if (existing) {
    existing.lastUsed = ++clock;
    return existing;
  }
  const def = getInstrumentDef(id);
  if (def.engine === "synth") {
    const voice = createSynth(def.source.preset ?? "poly");
    const entry: Loaded = { id, voice, sampled: false, lastUsed: ++clock, disposed: false, release: voice.dispose };
    loaded.set(id, entry);
    evictExcess(id);
    setStatus(id, "ready");
    return entry;
  }
  // Enquanto os samples carregam, um synth toca no lugar.
  const entry: Loaded = { id, voice: fallback(), sampled: true, lastUsed: ++clock, disposed: false };
  loaded.set(id, entry);
  evictExcess(id);
  setStatus(id, "loading");

  // Progresso do smplr só vale enquanto ele é a tentativa em curso (callbacks tardios são ignorados).
  let smplrActive = true;
  const fallBackToGm = () => {
    if (entry.disposed) return;
    smplrActive = false;
    clearProgress(id);
    entry.release?.(); // descarta a instância do smplr que falhou
    entry.release = undefined;
    if (def.source.gm) loadGmSampler(def, entry);
    else setStatus(id, "error");
  };
  if (!def.source.smplr) {
    fallBackToGm();
    return entry;
  }
  try {
    const inst = createSmplr(def.source.smplr, (p) => void (smplrActive && reportProgress(id, p)));
    entry.release = () => inst.dispose();
    withTimeout(inst.ready, LOAD_TIMEOUT_MS).then(
      () => {
        if (entry.disposed) return;
        entry.voice = smplrVoice(inst);
        clearProgress(id);
        setStatus(id, "ready");
      },
      (err: unknown) => {
        if (entry.disposed) return;
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
