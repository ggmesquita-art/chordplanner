// Cliente HTTP tipado e conversores para o módulo Neuro-Simbólico (music_ai_module).

import {
  AI_PPQ,
  beatsToTicks,
  chordsToSymbolList,
  fromCamelotCode,
  noteEventsToChords,
  noteEventsToMelody,
  melodyToNoteEvents,
  ticksToBeats,
  toCamelotCode,
  type AINoteEvent,
  type CamelotCode,
} from "../core/camelot";
import { isRest, makeChord, makeRest, type Chord, type QualityId } from "../core/chords";
import type { ScaleContext } from "../core/diatonic";
import type { MelodyNote } from "../core/melody";
import { chordIntervals, toggleModifier, type AltValue, type Modifier } from "../core/modifiers";
import { mod12, type PitchClass } from "../core/pitch";
import { recognizeChord } from "../core/recognize";
import { blockBeats, type Block, type InstrumentId, type Song } from "../core/song";
import type { Meter } from "../core/timeline";
import { hasInstrument } from "../audio/instruments";

export const DEFAULT_AI_SERVER_URL = "http://127.0.0.1:8765";

export const AI_MODELS = [
  "expressive_medium",
  "prism_medium",
  "yellow_medium",
  "yellow_small",
] as const;

export type AIGenModelName = (typeof AI_MODELS)[number];

export const AI_MODEL_LABELS: Record<AIGenModelName, { name: string; hint: string }> = {
  expressive_medium: {
    name: "Expressive Medium",
    hint: "4–16 compassos · velocity, microtiming e controles completos",
  },
  prism_medium: {
    name: "Prism Medium",
    hint: "4–16 compassos · foco em estilo e atributos por compasso",
  },
  yellow_medium: {
    name: "Yellow Medium",
    hint: "4–8 compassos · equilíbrio rápido entre harmonia e melodia",
  },
  yellow_small: {
    name: "Yellow Small",
    hint: "4–8 compassos · inferência ultraleve (ideal em CPU)",
  },
};

export const AI_GENRES = [
  "pop",
  "jazz",
  "rock",
  "hip-hop",
  "latin",
  "blues",
  "classical",
  "dance-electronic",
  "soundtrack",
  "folk",
] as const;

export type AIGenre = (typeof AI_GENRES)[number];

export type TrackRole = "melody" | "chords" | "bass" | "drums" | "pad";

export type GenerationMode = "harmonize" | "melody" | "full" | "inpaint";

export type ChordSymbolEvent = {
  symbol: string;
  root_pc: number | null;
  quality: string | null;
  start_tick: number;
  end_tick: number;
};

export type TrackInput = {
  role: TrackRole;
  program: number;
  notes: AINoteEvent[];
  chord_symbols: string[];
};

export type InpaintRange = {
  start_bar: number;
  end_bar: number;
  roles: TrackRole[];
};

export type GenerationRequest = {
  bpm: number;
  time_signature: [number, number];
  camelot_key: CamelotCode;
  tonic_pc: number | null;
  scale_id: string;
  style_prompt: string;
  genre: string;
  form_structure: string[];
  section_lengths: number[];
  input_tracks: TrackInput[];
  target_tracks: TrackRole[];
  generate_melody: boolean;
  inpaint_range: InpaintRange | null;
  density: Record<string, number>;
  polyphony: Record<string, number>;
  note_duration: Record<string, number>;
  use_velocity: boolean;
  use_microtiming: boolean;
  temperature: number;
  seed: number | null;
  model_name: AIGenModelName;
};

export type TheoreticalPlan = {
  camelot_key: CamelotCode;
  tonic_pc: number;
  tonic_name: string;
  scale_id: string;
  scale_pitches: number[];
  genre: string;
  total_bars: number;
  chord_progression_per_bar: string[];
  voice_leading_style: string;
  groove_style: string;
  target_roles_order: TrackRole[];
  primer_python_code: string;
  theoretical_explanation: string;
};

export type ValidationReport = {
  is_valid: boolean;
  scale_adherence: number;
  voice_leading_score: number;
  out_of_scale_bars: number[];
  warnings: string[];
};

export type GeneratedTrack = {
  role: TrackRole;
  program: number;
  name: string;
  notes: AINoteEvent[];
  chord_symbols: ChordSymbolEvent[];
};

export type GenerationResult = {
  success: boolean;
  message: string;
  bpm: number;
  time_signature: [number, number];
  camelot_key: CamelotCode;
  tracks: GeneratedTrack[];
  theoretical_plan: TheoreticalPlan | null;
  validation_report: ValidationReport | null;
  primer_midi_b64: string | null;
  generation_time_sec: number;
  vram_used_mb: number;
  model_used: string;
};

export type AIModelInfo = {
  name: string;
  path?: string;
  size_mb?: number;
  loaded?: boolean;
  device?: string;
  num_bars_map?: number[];
};

export type AIHealthStatus = {
  status: string;
  model_loaded: boolean;
  default_model: string;
  available_models: (string | AIModelInfo)[];
  models_installed?: string[];
  hf_repo?: string;
  hf_authenticated?: boolean;
  skill_loaded: boolean;
  device: string;
};

export function installedModelNames(health: AIHealthStatus | null | undefined): string[] {
  if (!health) return [];
  const raw = Array.isArray(health.models_installed)
    ? health.models_installed
    : (health.available_models ?? []).map((item) => (typeof item === "string" ? item : item.name));
  return Array.from(
    new Set(raw.filter((name): name is string => typeof name === "string" && name.length > 0)),
  );
}

export type ModelDownloadRequest = {
  model_name: AIGenModelName;
  hf_token?: string | null;
  save_token?: boolean;
};

export type ModelDownloadResponse = {
  success: boolean;
  model_name: string;
  message: string;
  path: string | null;
  already_present: boolean;
  auth_required: boolean;
  repo_url: string;
};

export type DesktopAIServerStatus = {
  ok: boolean;
  running: boolean;
  starting: boolean;
  managed: boolean;
  pid: number | null;
  message: string;
  missingPython?: boolean;
  missingDeps?: boolean;
  recentLogs?: string[];
};

export type DesktopAIBridge = {
  startServer: () => Promise<DesktopAIServerStatus>;
  stopServer: () => Promise<DesktopAIServerStatus>;
  getServerStatus: () => Promise<DesktopAIServerStatus>;
};

export function getDesktopAIBridge(): DesktopAIBridge | null {
  const candidate = (globalThis as { chordplannerAI?: unknown }).chordplannerAI;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as DesktopAIBridge).startServer === "function" &&
    typeof (candidate as DesktopAIBridge).stopServer === "function" &&
    typeof (candidate as DesktopAIBridge).getServerStatus === "function"
  ) {
    return candidate as DesktopAIBridge;
  }
  return null;
}

export type AIGenerationOptions = {
  mode: GenerationMode;
  modelName: AIGenModelName;
  genre: string;
  stylePrompt: string;
  bars?: number;
  density: number;
  polyphony: number;
  noteDuration: number;
  temperature: number;
  useVelocity: boolean;
  useMicrotiming: boolean;
  seed?: number | null;
  /** Intervalo 0-indexed (`startBar` inclusivo, `endBar` exclusivo). */
  inpaintRange?: {
    startBar: number;
    endBar: number;
    roles: TrackRole[];
  };
};

export type AIBlockPatch = {
  chords?: Chord[];
  melody?: MelodyNote[];
  bassInstrument?: InstrumentId;
  tonic?: PitchClass;
  scaleId?: string;
};

export class AIServerError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "AIServerError";
    this.status = status;
  }
}

const LETTER_TO_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_TOKEN_RE = /^([A-Ga-g])([#♯b♭]?)$/;
const CHORD_SYMBOL_RE = /^([A-Ga-g])([#♯b♭]?)(.*?)(?:\/([A-Ga-g][#♯b♭]?))?$/;

function parsePitchToken(token: string): PitchClass | null {
  const m = NOTE_TOKEN_RE.exec(token.trim());
  if (!m) return null;
  const base = LETTER_TO_PC[m[1].toUpperCase()];
  if (base === undefined) return null;
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return mod12(base + acc);
}

/**
 * Converte uma cifra textual (ex.: `"Am7"`, `"Cmaj7"`, `"F#m7b5"`, `"G/B"`, `"N.C."`)
 * na estrutura de `Chord` do ChordPlanner (sem `id` e `duration`).
 */
export function parseChordSymbol(symbol: string): Omit<Chord, "id" | "duration"> | null {
  const raw = symbol.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "N.C." || upper === "NC" || raw === "-") {
    return { root: 0, quality: "maj", modifiers: [], rest: true };
  }

  const m = CHORD_SYMBOL_RE.exec(raw);
  if (!m) return null;
  const root = parsePitchToken(`${m[1]}${m[2]}`);
  if (root === null) return null;

  let body = m[3].trim();
  const bass = m[4] ? parsePitchToken(m[4]) ?? undefined : undefined;

  // Normaliza acidentes Unicode no corpo da cifra
  body = body.replaceAll("♭", "b").replaceAll("♯", "#");
  const lower = body.toLowerCase();

  let quality: QualityId = "maj";
  let mods: Modifier[] = [];
  const addMod = (mod: Modifier) => {
    mods = toggleModifier(mods, mod);
  };

  if (lower === "" || lower === "maj") {
    quality = "maj";
  } else if (lower === "5") {
    quality = "5";
  } else if (lower === "dim" || body === "°" || lower === "o") {
    quality = "dim";
  } else if (lower === "dim7" || body === "°7" || lower === "o7") {
    quality = "dim";
    addMod({ kind: "ext", value: 6 });
  } else if (
    lower === "m7b5" ||
    lower === "min7b5" ||
    lower === "-7b5" ||
    body === "ø" ||
    body === "ø7"
  ) {
    quality = "dim";
    addMod({ kind: "ext", value: 7 });
  } else if (lower === "aug" || body === "+") {
    quality = "aug";
  } else if (lower === "aug7" || body === "+7") {
    quality = "aug";
    addMod({ kind: "ext", value: 7 });
  } else if (lower === "augmaj7" || body === "+maj7") {
    quality = "aug";
    addMod({ kind: "ext", value: "maj7" });
  } else if (lower === "sus4" || lower === "sus") {
    quality = "sus4";
  } else if (lower === "sus2") {
    quality = "sus2";
  } else if (lower === "7sus4" || lower === "7sus") {
    quality = "sus4";
    addMod({ kind: "ext", value: 7 });
  } else if (lower === "9sus4" || lower === "9sus") {
    quality = "sus4";
    addMod({ kind: "ext", value: 9 });
  } else if (lower === "maj7sus4" || lower === "maj7sus") {
    quality = "sus4";
    addMod({ kind: "ext", value: "maj7" });
  } else {
    let restBody = body;
    // Detecta qualidade menor no início (mas não "maj")
    if (
      (restBody.startsWith("min") || (restBody.startsWith("m") && !restBody.toLowerCase().startsWith("maj")) || restBody.startsWith("-"))
    ) {
      quality = "m";
      if (restBody.startsWith("min")) restBody = restBody.slice(3);
      else restBody = restBody.slice(1);
    }

    const restLower = restBody.toLowerCase();

    // Extensões principais
    if (restLower.includes("(maj7)") || restLower.includes("maj7") || restBody.startsWith("M7") || restBody.includes("Δ7") || restBody.includes("Δ")) {
      addMod({ kind: "ext", value: "maj7" });
      if (restLower.includes("maj9") || restBody.includes("Δ9")) addMod({ kind: "ext", value: 9 });
      if (restLower.includes("maj11")) addMod({ kind: "ext", value: 11 });
      if (restLower.includes("maj13")) addMod({ kind: "ext", value: 13 });
    } else if (restLower.includes("maj9")) {
      addMod({ kind: "ext", value: "maj7" });
      addMod({ kind: "ext", value: 9 });
    } else if (restLower.includes("maj11")) {
      addMod({ kind: "ext", value: "maj7" });
      addMod({ kind: "ext", value: 11 });
    } else if (restLower.includes("maj13")) {
      addMod({ kind: "ext", value: "maj7" });
      addMod({ kind: "ext", value: 13 });
    } else if (restLower.includes("6/9")) {
      addMod({ kind: "ext", value: 6 });
      addMod({ kind: "ext", value: 9 });
    } else if (/(^|[^0-9])6([^0-9]|$)/.test(restLower) && !restLower.includes("b6")) {
      addMod({ kind: "ext", value: 6 });
    }

    if (!mods.some((x) => x.kind === "ext" && (x.value === "maj7" || x.value === 6))) {
      if (/(^|[^#b0-9])13/.test(restLower)) addMod({ kind: "ext", value: 13 });
      else if (/(^|[^#b0-9])11/.test(restLower)) addMod({ kind: "ext", value: 11 });
      else if (/(^|[^#b0-9])9/.test(restLower) && !restLower.includes("add9")) addMod({ kind: "ext", value: 9 });
      else if (/(^|[^0-9])7/.test(restLower)) addMod({ kind: "ext", value: 7 });
    }

    if (restLower.includes("add9") || restLower.includes("add2")) addMod({ kind: "add", value: 9 });
    if (restLower.includes("add11")) addMod({ kind: "add", value: 11 });
    if (restLower.includes("add13")) addMod({ kind: "add", value: 13 });

    if (restLower.includes("sus4")) addMod({ kind: "sus", value: 4 });
    else if (restLower.includes("sus2")) addMod({ kind: "sus", value: 2 });

    const alts: AltValue[] = ["b5", "#5", "b9", "#9", "#11", "b13"];
    for (const alt of alts) {
      if (restLower.includes(alt)) addMod({ kind: "alt", value: alt });
    }
    if (restLower.includes("alt")) {
      addMod({ kind: "alt", value: "b9" });
      addMod({ kind: "alt", value: "b13" });
    }
    if (restLower.includes("no3")) addMod({ kind: "omit", value: 3 });
    if (restLower.includes("no5")) addMod({ kind: "omit", value: 5 });
  }

  return {
    root,
    quality,
    modifiers: mods,
    ...(bass !== undefined && bass !== root ? { bass } : {}),
  };
}

function chordFromSymbol(symbol: string, duration: number): Chord | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;
  if (parsed.rest) return makeRest(duration);
  const c = makeChord(parsed.root, parsed.quality, duration);
  c.modifiers = parsed.modifiers;
  if (parsed.bass !== undefined && parsed.bass !== parsed.root) c.bass = parsed.bass;
  return c;
}

/**
 * Converte a lista de acordes do bloco em eventos MIDI em ticks (`PPQ = 480`).
 */
export function chordsToNoteEvents(
  chords: readonly Chord[],
  meter: Meter = [4, 4],
  ppq = AI_PPQ,
): AINoteEvent[] {
  const events: AINoteEvent[] = [];
  let beatPos = 0;
  for (const c of chords) {
    const startTick = beatsToTicks(beatPos, meter, ppq);
    const endTick = Math.max(startTick + 1, beatsToTicks(beatPos + c.duration, meter, ppq));
    beatPos += c.duration;
    if (isRest(c)) continue;
    const intervals = chordIntervals(c);
    for (const iv of intervals) {
      const pitch = Math.max(0, Math.min(127, 48 + c.root + iv));
      events.push({ pitch, start_tick: startTick, end_tick: endTick, velocity: 84 });
    }
    if (c.bass !== undefined && c.bass !== c.root) {
      events.push({
        pitch: Math.max(0, Math.min(127, 36 + c.bass)),
        start_tick: startTick,
        end_tick: endTick,
        velocity: 88,
      });
    }
  }
  return events;
}

/**
 * Amostra uma cifra ASCII por compasso para enviar no `TrackInput.chord_symbols`.
 */
export function chordsToBarSymbols(
  chords: readonly Chord[],
  tonic: PitchClass | null,
  meter: Meter,
  totalBars: number,
): string[] {
  if (!chords.length || totalBars <= 0) return [];
  const symbols = chordsToSymbolList(chords, tonic);
  const beatsPerBar = meter[0];
  const barSymbols: string[] = [];

  for (let b = 0; b < totalBars; b++) {
    const targetBeat = b * beatsPerBar;
    let cursor = 0;
    let chosenIdx = chords.length - 1;
    for (let i = 0; i < chords.length; i++) {
      const end = cursor + chords[i].duration;
      if (targetBeat < end - 1e-6) {
        chosenIdx = i;
        break;
      }
      cursor = end;
    }
    const sym = symbols[chosenIdx] ?? "N.C.";
    barSymbols.push(sym);
  }
  return barSymbols;
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function clampFloat(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val * 1000) / 1000));
}

/**
 * Monta o `GenerationRequest` compatível com o schema estrito Pydantic v2 de `music_ai_module`.
 */
export function buildGenerationRequest(params: {
  block: Block;
  song: Song;
  tonic: PitchClass | null;
  scaleId: string;
  options: AIGenerationOptions;
}): GenerationRequest {
  const { block, song, tonic, scaleId, options } = params;
  const meter = block.meter ?? song.meter;
  const bpm = clampInt(block.bpm ?? song.bpm, 30, 300);

  const effectiveTonic = block.key ? mod12(block.key.tonic) : tonic !== null ? mod12(tonic) : null;
  const effectiveScale = block.key ? block.key.scaleId : scaleId;
  const camelotKey = toCamelotCode(effectiveTonic, effectiveScale);

  const rawBlockBars = Math.ceil(blockBeats(block) / Math.max(1, meter[0]));
  const totalBars = clampInt(options.bars ?? Math.max(4, rawBlockBars || 4), 1, 64);

  const inputTracks: TrackInput[] = [];
  const hasMelody = (block.melody?.length ?? 0) > 0;
  const hasChords = block.chords.some((c) => !isRest(c));

  const appendMelodyInput = () => {
    if (!hasMelody) return;
    inputTracks.push({
      role: "melody",
      program: 0,
      notes: melodyToNoteEvents(block.melody, meter, AI_PPQ),
      chord_symbols: [],
    });
  };

  const appendChordsInput = () => {
    if (!hasChords) return;
    inputTracks.push({
      role: "chords",
      program: 0,
      notes: chordsToNoteEvents(block.chords, meter, AI_PPQ),
      chord_symbols: chordsToBarSymbols(block.chords, effectiveTonic ?? 0, meter, totalBars),
    });
  };

  let targetTracks: TrackRole[];
  let generateMelody: boolean;
  let inpaintRange: InpaintRange | null = null;

  switch (options.mode) {
    case "harmonize": {
      appendMelodyInput();
      targetTracks = ["chords", "bass"];
      generateMelody = false;
      break;
    }
    case "melody": {
      appendChordsInput();
      targetTracks = ["melody"];
      generateMelody = true;
      break;
    }
    case "inpaint": {
      appendChordsInput();
      appendMelodyInput();
      const rawRoles = options.inpaintRange?.roles.length
        ? options.inpaintRange.roles
        : (["chords", "melody"] as TrackRole[]);
      const startBar = clampInt(options.inpaintRange?.startBar ?? 0, 0, Math.max(0, totalBars - 1));
      const endBar = clampInt(options.inpaintRange?.endBar ?? totalBars, startBar + 1, totalBars);
      targetTracks = [...rawRoles];
      generateMelody = rawRoles.includes("melody");
      inpaintRange = {
        start_bar: startBar,
        end_bar: endBar,
        roles: [...rawRoles],
      };
      break;
    }
    case "full":
    default: {
      targetTracks = ["chords", "bass", "melody"];
      generateMelody = true;
      break;
    }
  }

  const d = clampInt(options.density, 1, 10);
  const p = clampInt(options.polyphony, 1, 10);
  const dur = clampFloat(options.noteDuration, 0.1, 1.0);
  const temp = clampFloat(options.temperature, 0.1, 2.0);

  return {
    bpm,
    time_signature: [clampInt(meter[0], 1, 16), clampInt(meter[1], 1, 16)],
    camelot_key: camelotKey,
    tonic_pc: effectiveTonic,
    scale_id: effectiveScale,
    style_prompt: options.stylePrompt.trim() || "Modern Pop Ballad, emotional, piano driven",
    genre: options.genre || "pop",
    form_structure: ["A"],
    section_lengths: [totalBars],
    input_tracks: inputTracks,
    target_tracks: targetTracks,
    generate_melody: generateMelody,
    inpaint_range: inpaintRange,
    density: {
      chords: d,
      bass: Math.max(1, Math.min(10, Math.round(d * 0.8))),
      drums: d,
      pad: Math.max(1, Math.min(10, Math.round(d * 0.6))),
      melody: d,
    },
    polyphony: {
      chords: p,
      bass: 1,
      drums: 3,
      pad: p,
      melody: 1,
    },
    note_duration: {
      chords: dur,
      bass: dur,
      drums: 0.25,
      pad: Math.min(1.0, Math.max(0.1, Math.round((dur + 0.15) * 100) / 100)),
      melody: dur,
    },
    use_velocity: options.useVelocity,
    use_microtiming: options.useMicrotiming,
    temperature: temp,
    seed: options.seed ?? null,
    model_name: options.modelName,
  };
}

function pickBassInstrument(program: number, genre?: string): InstrumentId {
  if (program === 42 || program === 43 || genre === "classical" || genre === "soundtrack") {
    return hasInstrument("contrabass") ? "contrabass" : "piano";
  }
  return hasInstrument("contrabass-pizz") ? "contrabass-pizz" : "contrabass";
}

function chordsFromSymbolEventsInBar(
  events: readonly ChordSymbolEvent[],
  barStartTick: number,
  barEndTick: number,
  meter: Meter,
): Chord[] {
  const overlapping = events.filter((ev) => ev.start_tick < barEndTick && ev.end_tick > barStartTick);
  if (!overlapping.length) return [];
  const out: Chord[] = [];
  for (const ev of overlapping) {
    const s = Math.max(barStartTick, ev.start_tick);
    const e = Math.min(barEndTick, ev.end_tick);
    const rawBeats = ticksToBeats(Math.max(1, e - s), meter, AI_PPQ);
    const dur = Math.max(0.25, Math.round(rawBeats * 4) / 4);
    const parsed = chordFromSymbol(ev.symbol, dur);
    if (parsed) {
      out.push(parsed);
    } else if (ev.root_pc !== null && ev.root_pc >= 0 && ev.root_pc <= 11) {
      out.push(makeChord(mod12(ev.root_pc), "maj", dur));
    }
  }
  return out;
}

/**
 * Converte um `GenerationResult` em um patch pronto para `useStore.getState().applyAIGeneration(...)`.
 * Usa `noteEventsToChords`, `noteEventsToMelody`, `fromCamelotCode` e `toCamelotCode` de `src/core/camelot.ts`,
 * com fallback para `chord_symbols` da track `chords` ou `theoretical_plan.chord_progression_per_bar`
 * quando algum compasso não tiver tríade reconhecida nas notas.
 */
export function generationResultToBlockPatch(
  result: GenerationResult,
  params: {
    mode: GenerationMode;
    meter: Meter;
    scaleCtx: ScaleContext | null;
    melodyGrid?: number;
    currentBassInstrument?: InstrumentId;
    inpaintRoles?: TrackRole[];
    syncKey?: boolean;
  },
): AIBlockPatch {
  const {
    mode,
    meter,
    scaleCtx,
    melodyGrid = 0.25,
    currentBassInstrument,
    inpaintRoles,
    syncKey = false,
  } = params;

  const patch: AIBlockPatch = {};
  const beatsPerBar = Math.max(1, meter[0]);
  const barTicks = beatsToTicks(beatsPerBar, meter, AI_PPQ);

  const wantsChords =
    mode === "harmonize" ||
    mode === "full" ||
    (mode === "inpaint" && (inpaintRoles ?? ["chords", "melody"]).includes("chords"));

  const wantsMelody =
    mode === "melody" ||
    mode === "full" ||
    (mode === "inpaint" && (inpaintRoles ?? ["chords", "melody"]).includes("melody"));

  const chordsTrack =
    result.tracks.find((t) => t.role === "chords") ?? result.tracks.find((t) => t.role === "pad");
  const melodyTrack = result.tracks.find((t) => t.role === "melody");
  const bassTrack = result.tracks.find((t) => t.role === "bass");

  if (wantsChords) {
    const notes = chordsTrack?.notes ?? [];
    const trackSymbols = chordsTrack?.chord_symbols ?? [];
    const planSymbols = result.theoretical_plan?.chord_progression_per_bar ?? [];

    const maxNoteTick = notes.length ? Math.max(...notes.map((n) => n.end_tick)) : 0;
    const maxSymTick = trackSymbols.length ? Math.max(...trackSymbols.map((s) => s.end_tick)) : 0;
    const totalBars = Math.max(
      result.theoretical_plan?.total_bars ?? 0,
      planSymbols.length,
      Math.ceil(maxNoteTick / barTicks),
      Math.ceil(maxSymTick / barTicks),
    );

    if (notes.length === 0) {
      if (trackSymbols.length > 0) {
        const parsedFromTrack: Chord[] = [];
        for (const ev of trackSymbols) {
          const dur = Math.max(0.25, Math.round(ticksToBeats(ev.end_tick - ev.start_tick, meter, AI_PPQ) * 4) / 4);
          const parsed = chordFromSymbol(ev.symbol, dur);
          if (parsed) parsedFromTrack.push(parsed);
          else if (ev.root_pc !== null && ev.root_pc >= 0 && ev.root_pc <= 11) {
            parsedFromTrack.push(makeChord(mod12(ev.root_pc), "maj", dur));
          }
        }
        if (parsedFromTrack.length > 0) patch.chords = parsedFromTrack;
      } else if (planSymbols.length > 0) {
        const parsedFromPlan = planSymbols
          .map((sym) => chordFromSymbol(sym, beatsPerBar))
          .filter((c): c is Chord => c !== null);
        if (parsedFromPlan.length > 0) patch.chords = parsedFromPlan;
      }
    } else {
      const analyzed = noteEventsToChords(notes, meter, beatsPerBar, scaleCtx, AI_PPQ);
      const finalChords: Chord[] = [];

      for (let b = 0; b < Math.max(totalBars, analyzed.length); b++) {
        const barStart = b * barTicks;
        const barEnd = (b + 1) * barTicks;
        const barNotes = notes.filter((n) => n.start_tick < barEnd && n.end_tick > barStart && n.end_tick > n.start_tick);
        const pcs = new Set(barNotes.map((n) => mod12(n.pitch)));
        const hasTriad =
          pcs.size >= 3 && recognizeChord(barNotes.map((n) => n.pitch), scaleCtx) !== null;
        const analyzedChord = analyzed[b];

        if (hasTriad && analyzedChord && !isRest(analyzedChord)) {
          finalChords.push(analyzedChord);
          continue;
        }

        const fromTrack = chordsFromSymbolEventsInBar(trackSymbols, barStart, barEnd, meter);
        if (fromTrack.length > 0) {
          finalChords.push(...fromTrack);
          continue;
        }

        const planSym = planSymbols[b];
        if (planSym) {
          const parsedPlan = chordFromSymbol(planSym, beatsPerBar);
          if (parsedPlan) {
            finalChords.push(parsedPlan);
            continue;
          }
        }

        if (analyzedChord) {
          finalChords.push(analyzedChord);
        }
      }

      if (finalChords.length > 0) {
        patch.chords = finalChords;
      }
    }
  }

  if (wantsMelody && melodyTrack && melodyTrack.notes.length > 0) {
    patch.melody = noteEventsToMelody(melodyTrack.notes, meter, melodyGrid, AI_PPQ);
  }

  if (bassTrack && bassTrack.notes.length > 0 && !currentBassInstrument) {
    patch.bassInstrument = pickBassInstrument(bassTrack.program, result.theoretical_plan?.genre);
  }

  if (syncKey && result.camelot_key) {
    const decoded = fromCamelotCode(result.camelot_key);
    const planScale = result.theoretical_plan?.scale_id;
    const targetScale = planScale && toCamelotCode(decoded.tonic, planScale) === result.camelot_key
      ? planScale
      : decoded.scaleId;
    patch.tonic = decoded.tonic;
    patch.scaleId = targetScale;
  }

  return patch;
}

/**
 * Converte um `TheoreticalPlan` em `Chord[]` para pré-visualização ou aplicação direta sem inferência neural.
 */
export function planToChords(plan: TheoreticalPlan, meter: Meter = [4, 4]): Chord[] {
  const beatsPerBar = Math.max(1, meter[0]);
  return plan.chord_progression_per_bar
    .map((sym) => chordFromSymbol(sym, beatsPerBar))
    .filter((c): c is Chord => c !== null);
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<T> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new AIServerError(
      `Servidor IA local indisponível (${reason}). Inicie com: python -m music_ai_module.server`,
      0,
    );
  }

  if (!res.ok) {
    let detail = `Erro HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown; message?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
      else if (typeof data.message === "string") detail = data.message;
    } catch {
      // ignora corpo não JSON
    }
    throw new AIServerError(detail, res.status);
  }

  return (await res.json()) as T;
}

export function createMusicAIClient(
  baseUrl: string = DEFAULT_AI_SERVER_URL,
  fetchImpl?: typeof fetch,
) {
  const cleanBase = baseUrl.replace(/\/+$/, "");

  return {
    baseUrl: cleanBase,

    checkHealth(): Promise<AIHealthStatus> {
      return requestJson<AIHealthStatus>(`${cleanBase}/health`, { method: "GET" }, fetchImpl);
    },

    createPlan(request: GenerationRequest): Promise<TheoreticalPlan> {
      return requestJson<TheoreticalPlan>(
        `${cleanBase}/plan`,
        { method: "POST", body: JSON.stringify(request) },
        fetchImpl,
      );
    },

    generate(request: GenerationRequest): Promise<GenerationResult> {
      return requestJson<GenerationResult>(
        `${cleanBase}/generate`,
        { method: "POST", body: JSON.stringify(request) },
        fetchImpl,
      );
    },

    inpaint(request: GenerationRequest): Promise<GenerationResult> {
      return requestJson<GenerationResult>(
        `${cleanBase}/inpaint`,
        { method: "POST", body: JSON.stringify(request) },
        fetchImpl,
      );
    },

    downloadModel(req: ModelDownloadRequest): Promise<ModelDownloadResponse> {
      return requestJson<ModelDownloadResponse>(
        `${cleanBase}/models/download`,
        { method: "POST", body: JSON.stringify(req) },
        fetchImpl,
      );
    },
  };
}

export const musicAIClient = createMusicAIClient();
