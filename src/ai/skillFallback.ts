// Gerador musical simbólico 100% offline baseado nas regras da skill `music-composition`.
// Usado pelo AIPanel como fallback quando o servidor MIDI-GPT não está disponível.
// Módulo puro (sem React nem efeitos de rede).

import { hasInstrument } from "../audio/instruments";
import {
  chordsToBarSymbols,
  parseChordSymbol,
  planToChords,
  AI_GENRES,
  type AIBlockPatch,
  type AIGenerationOptions,
  type AIGenre,
  type TheoreticalPlan,
  type TrackRole,
} from "./client";
import { isRest, makeChord, makeRest, newChordId, type Chord, type QualityId } from "../core/chords";
import { toCamelotCode } from "../core/camelot";
import { scaleContext, type ScaleContext } from "../core/diatonic";
import { autoHarmonize, beatWeight, chordAtBeat } from "../core/harmonize";
import {
  MELODY_DEFAULT_HIGH,
  MELODY_DEFAULT_LOW,
  MELODY_EPS,
  MELODY_MIN_DURATION,
  makeMelodyNote,
  normalizeMonophonic,
  type MelodyNote,
} from "../core/melody";
import { chordIntervals, chordSymbol, type Modifier } from "../core/modifiers";
import { toAscii } from "../core/notation";
import { makeSpeller, mod12, pcName, prefersFlats, type PitchClass, type Speller } from "../core/pitch";
import { getScale } from "../core/scales";
import { blockBeats, type Block, type InstrumentId, type Song } from "../core/song";
import type { Meter } from "../core/timeline";

const EPS = 1e-6;

type ChordSpec = {
  /** Deslocamento em semitons a partir da tônica efetiva (0..11). */
  offset: number;
  quality: QualityId;
  modifiers?: Modifier[];
};

type GenreProgressionSet = {
  major: ChordSpec[];
  minor: ChordSpec[];
  major4?: ChordSpec[];
  minor4?: ChordSpec[];
  major12?: ChordSpec[];
  minor12?: ChordSpec[];
  groove: string;
  voiceLeading: "drop2" | "shell" | "close";
};

const EXT_7: Modifier = { kind: "ext", value: 7 };
const EXT_MAJ7: Modifier = { kind: "ext", value: "maj7" };
const ALT_B9: Modifier = { kind: "alt", value: "b9" };

const cSpec = (offset: number, quality: QualityId, ...modifiers: Modifier[]): ChordSpec => ({
  offset,
  quality,
  ...(modifiers.length ? { modifiers } : {}),
});

/**
 * Catálogo funcional por gênero e modo (maior / menor), alinhado a
 * `.agents/skills/music-composition/assets/progressions-catalog.md`.
 */
const GENRE_CATALOG: Record<AIGenre, GenreProgressionSet> = {
  pop: {
    // I - V - vi - IV | I - vi - ii - V
    major: [
      cSpec(0, "maj"),
      cSpec(7, "maj"),
      cSpec(9, "m"),
      cSpec(5, "maj"),
      cSpec(0, "maj"),
      cSpec(9, "m"),
      cSpec(2, "m"),
      cSpec(7, "maj"),
    ],
    // i - bVI - bIII - bVII | i - iv - bVI - V
    minor: [
      cSpec(0, "m"),
      cSpec(8, "maj"),
      cSpec(3, "maj"),
      cSpec(10, "maj"),
      cSpec(0, "m"),
      cSpec(5, "m"),
      cSpec(8, "maj"),
      cSpec(7, "maj"),
    ],
    groove: "straight",
    voiceLeading: "close",
  },
  jazz: {
    // ii7 - V7 - Imaj7 - vi7 | ii7 - V7 - iii7 - VI7
    major: [
      cSpec(2, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "maj", EXT_MAJ7),
      cSpec(9, "m", EXT_7),
      cSpec(2, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(4, "m", EXT_7),
      cSpec(9, "maj", EXT_7),
    ],
    // iiø7 - V7(b9) - im7 - iv7 | iiø7 - V7(b9) - bVImaj7 - V7
    minor: [
      cSpec(2, "dim", EXT_7),
      cSpec(7, "maj", EXT_7, ALT_B9),
      cSpec(0, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(2, "dim", EXT_7),
      cSpec(7, "maj", EXT_7, ALT_B9),
      cSpec(8, "maj", EXT_MAJ7),
      cSpec(7, "maj", EXT_7),
    ],
    groove: "swing",
    voiceLeading: "drop2",
  },
  rock: {
    // I - bVII - IV - I | I - V - bVII - IV
    major: [
      cSpec(0, "maj"),
      cSpec(10, "maj"),
      cSpec(5, "maj"),
      cSpec(0, "maj"),
      cSpec(0, "maj"),
      cSpec(7, "maj"),
      cSpec(10, "maj"),
      cSpec(5, "maj"),
    ],
    // i - bVII - bVI - bVII | i - bIII - bVII - iv
    minor: [
      cSpec(0, "m"),
      cSpec(10, "maj"),
      cSpec(8, "maj"),
      cSpec(10, "maj"),
      cSpec(0, "m"),
      cSpec(3, "maj"),
      cSpec(10, "maj"),
      cSpec(5, "m"),
    ],
    groove: "driving_8ths",
    voiceLeading: "close",
  },
  "hip-hop": {
    // Imaj7 - vi7 - ii7 - V7 | IVmaj7 - iii7 - ii7 - V7
    major: [
      cSpec(0, "maj", EXT_MAJ7),
      cSpec(9, "m", EXT_7),
      cSpec(2, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(5, "maj", EXT_MAJ7),
      cSpec(4, "m", EXT_7),
      cSpec(2, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
    ],
    // im7 - iv7 - bVImaj7 - V7 | im7 - bVII7 - bVImaj7 - V7
    minor: [
      cSpec(0, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(8, "maj", EXT_MAJ7),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(10, "maj", EXT_7),
      cSpec(8, "maj", EXT_MAJ7),
      cSpec(7, "maj", EXT_7),
    ],
    groove: "boom_bap",
    voiceLeading: "shell",
  },
  latin: {
    // Imaj7 - II7 - ii7 - V7 | Imaj7 - vi7 - ii7 - V7
    major: [
      cSpec(0, "maj", EXT_MAJ7),
      cSpec(2, "maj", EXT_7),
      cSpec(2, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "maj", EXT_MAJ7),
      cSpec(9, "m", EXT_7),
      cSpec(2, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
    ],
    // im7 - iv7 - bVII7 - bIIImaj7 | bVImaj7 - iiø7 - V7(b9) - im7
    minor: [
      cSpec(0, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(10, "maj", EXT_7),
      cSpec(3, "maj", EXT_MAJ7),
      cSpec(8, "maj", EXT_MAJ7),
      cSpec(2, "dim", EXT_7),
      cSpec(7, "maj", EXT_7, ALT_B9),
      cSpec(0, "m", EXT_7),
    ],
    groove: "bossa_clave",
    voiceLeading: "drop2",
  },
  blues: {
    major4: [cSpec(0, "maj", EXT_7), cSpec(5, "maj", EXT_7), cSpec(0, "maj", EXT_7), cSpec(7, "maj", EXT_7)],
    minor4: [cSpec(0, "m", EXT_7), cSpec(5, "m", EXT_7), cSpec(0, "m", EXT_7), cSpec(7, "maj", EXT_7)],
    // 8-bar blues
    major: [
      cSpec(0, "maj", EXT_7),
      cSpec(5, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(5, "maj", EXT_7),
      cSpec(5, "maj", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
    ],
    minor: [
      cSpec(0, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(8, "maj", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "m", EXT_7),
    ],
    // 12-bar blues
    major12: [
      cSpec(0, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(5, "maj", EXT_7),
      cSpec(5, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(5, "maj", EXT_7),
      cSpec(0, "maj", EXT_7),
      cSpec(7, "maj", EXT_7),
    ],
    minor12: [
      cSpec(0, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(5, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(8, "maj", EXT_7),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "m", EXT_7),
      cSpec(7, "maj", EXT_7),
    ],
    groove: "shuffle",
    voiceLeading: "shell",
  },
  classical: {
    // I - IV - V - I | vi - ii - V7 - I
    major: [
      cSpec(0, "maj"),
      cSpec(5, "maj"),
      cSpec(7, "maj"),
      cSpec(0, "maj"),
      cSpec(9, "m"),
      cSpec(2, "m"),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "maj"),
    ],
    // i - iv - V - i | bVI - ii° - V7 - i
    minor: [
      cSpec(0, "m"),
      cSpec(5, "m"),
      cSpec(7, "maj"),
      cSpec(0, "m"),
      cSpec(8, "maj"),
      cSpec(2, "dim"),
      cSpec(7, "maj", EXT_7),
      cSpec(0, "m"),
    ],
    groove: "legato_classical",
    voiceLeading: "close",
  },
  "dance-electronic": {
    // vi - IV - I - V | vi - IV - ii - V
    major: [
      cSpec(9, "m"),
      cSpec(5, "maj"),
      cSpec(0, "maj"),
      cSpec(7, "maj"),
      cSpec(9, "m"),
      cSpec(5, "maj"),
      cSpec(2, "m"),
      cSpec(7, "maj"),
    ],
    // i - bVI - bIII - bVII | i - bVI - iv - V
    minor: [
      cSpec(0, "m"),
      cSpec(8, "maj"),
      cSpec(3, "maj"),
      cSpec(10, "maj"),
      cSpec(0, "m"),
      cSpec(8, "maj"),
      cSpec(5, "m"),
      cSpec(7, "maj"),
    ],
    groove: "four_on_the_floor",
    voiceLeading: "close",
  },
  soundtrack: {
    // I - V - vi - IV | bVI - bVII - I - V
    major: [
      cSpec(0, "maj"),
      cSpec(7, "maj"),
      cSpec(9, "m"),
      cSpec(5, "maj"),
      cSpec(8, "maj"),
      cSpec(10, "maj"),
      cSpec(0, "maj"),
      cSpec(7, "maj"),
    ],
    // i - bVI - bIII - bVII | i - iv - bVI - V
    minor: [
      cSpec(0, "m"),
      cSpec(8, "maj"),
      cSpec(3, "maj"),
      cSpec(10, "maj"),
      cSpec(0, "m"),
      cSpec(5, "m"),
      cSpec(8, "maj"),
      cSpec(7, "maj"),
    ],
    groove: "cinematic_sustained",
    voiceLeading: "close",
  },
  folk: {
    // I - IV - V - I | I - V - IV - I
    major: [
      cSpec(0, "maj"),
      cSpec(5, "maj"),
      cSpec(7, "maj"),
      cSpec(0, "maj"),
      cSpec(0, "maj"),
      cSpec(7, "maj"),
      cSpec(5, "maj"),
      cSpec(0, "maj"),
    ],
    // i - bVII - bVI - bVII | i - iv - bVII - i
    minor: [
      cSpec(0, "m"),
      cSpec(10, "maj"),
      cSpec(8, "maj"),
      cSpec(10, "maj"),
      cSpec(0, "m"),
      cSpec(5, "m"),
      cSpec(10, "maj"),
      cSpec(0, "m"),
    ],
    groove: "acoustic_strum",
    voiceLeading: "close",
  },
};

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function clampFloat(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function resolveGenre(rawGenre: string): AIGenre {
  const normalized = rawGenre.trim().toLowerCase();
  if ((AI_GENRES as readonly string[]).includes(normalized)) {
    return normalized as AIGenre;
  }
  return "pop";
}

function resolveEffectiveScaleId(rawScaleId: string): string {
  const candidate = rawScaleId.trim() || "major";
  try {
    getScale(candidate);
    return candidate;
  } catch {
    const lower = candidate.toLowerCase();
    return lower.includes("minor") || lower.includes("aeolian") ? "minor" : "major";
  }
}

function isMinorMode(scaleId: string): boolean {
  try {
    const sc = getScale(scaleId);
    const hasMinor3 = sc.intervals.includes(3);
    const hasMajor3 = sc.intervals.includes(4);
    if (hasMinor3 && !hasMajor3) return true;
    if (hasMajor3) return false;
  } catch {
    // fallback abaixo
  }
  const lower = scaleId.toLowerCase();
  return (
    lower.includes("minor") ||
    lower.includes("aeolian") ||
    lower.includes("dorian") ||
    lower.includes("phrygian") ||
    lower.includes("locrian")
  );
}

function safeAsciiChordSymbol(chord: Chord, tonic: PitchClass, speller: Speller): string {
  const raw = toAscii(chordSymbol(chord, speller));
  if (parseChordSymbol(raw)) return raw;
  const fallbackSpeller: Speller = (pc) => toAscii(pcName(pc, prefersFlats(tonic, "auto")));
  return toAscii(chordSymbol(chord, fallbackSpeller));
}

function safeAsciiTonicName(tonic: PitchClass, speller: Speller): string {
  const candidate = toAscii(speller(tonic));
  if (candidate.includes("bb") || candidate.includes("##")) {
    return toAscii(pcName(tonic, prefersFlats(tonic, "auto")));
  }
  return candidate;
}

function buildGenreProgressionSymbols(
  genre: AIGenre,
  tonic: PitchClass,
  minor: boolean,
  totalBars: number,
  speller: Speller,
  durationPerBar: number,
): string[] {
  const entry = GENRE_CATALOG[genre];
  let template: ChordSpec[];
  if (totalBars <= 4 && (minor ? entry.minor4 : entry.major4)) {
    template = (minor ? entry.minor4 : entry.major4)!;
  } else if (totalBars >= 9 && (minor ? entry.minor12 : entry.major12)) {
    template = (minor ? entry.minor12 : entry.major12)!;
  } else {
    template = minor ? entry.minor : entry.major;
  }

  const out: string[] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    const spec = template[bar % template.length];
    const root = mod12(tonic + spec.offset);
    const chord = makeChord(root, spec.quality, durationPerBar);
    if (spec.modifiers?.length) {
      chord.modifiers = spec.modifiers.map((m) => ({ ...m }));
    }
    out.push(safeAsciiChordSymbol(chord, tonic, speller));
  }
  return out;
}

function voiceLeadingStyleForGenre(genre: AIGenre): "drop2" | "shell" | "close" {
  return GENRE_CATALOG[genre].voiceLeading;
}

function targetRolesForMode(options: AIGenerationOptions): TrackRole[] {
  switch (options.mode) {
    case "harmonize":
      return ["chords", "bass"];
    case "melody":
      return ["melody"];
    case "inpaint":
      return options.inpaintRange?.roles.length
        ? [...options.inpaintRange.roles]
        : ["chords", "melody"];
    case "full":
    default:
      return ["chords", "bass", "melody"];
  }
}

function resolveContext(params: {
  block: Block;
  song: Song;
  tonic: PitchClass | null;
  scaleId: string;
  options: AIGenerationOptions;
}): {
  effectiveTonic: PitchClass;
  effectiveScale: string;
  ctx: ScaleContext;
  speller: Speller;
  meter: Meter;
  totalBars: number;
  genre: AIGenre;
  minor: boolean;
} {
  const { block, song, tonic, scaleId, options } = params;
  const meter = block.meter ?? song.meter;
  const effectiveTonic = block.key
    ? mod12(block.key.tonic)
    : tonic !== null
      ? mod12(tonic)
      : 0;
  const effectiveScale = resolveEffectiveScaleId(block.key ? block.key.scaleId : scaleId);
  const ctx = scaleContext(effectiveTonic, effectiveScale);
  const speller = makeSpeller(effectiveTonic, ctx.pcs, "auto");
  const rawBlockBars = Math.ceil(blockBeats(block) / Math.max(1, meter[0]));
  const totalBars = clampInt(options.bars ?? Math.max(4, rawBlockBars || 4), 1, 64);
  const genre = resolveGenre(options.genre);
  const minor = isMinorMode(effectiveScale);

  return {
    effectiveTonic,
    effectiveScale,
    ctx,
    speller,
    meter,
    totalBars,
    genre,
    minor,
  };
}

function padHarmonizedChords(
  harmonized: readonly Chord[],
  totalBars: number,
  beatsPerBar: number,
  fallbackChords: readonly Chord[],
): Chord[] {
  const out = harmonized.map((c) => ({ ...c, modifiers: [...c.modifiers] }));
  let totalDur = out.reduce((sum, c) => sum + c.duration, 0);
  const targetDur = totalBars * beatsPerBar;
  let barIdx = Math.floor((totalDur + EPS) / beatsPerBar);

  while (totalDur < targetDur - EPS) {
    const needed = Math.min(beatsPerBar, Math.round((targetDur - totalDur) * 64) / 64);
    const fb = fallbackChords[barIdx % fallbackChords.length];
    if (fb && !isRest(fb)) {
      const c = makeChord(fb.root, fb.quality, needed);
      c.modifiers = fb.modifiers.map((m) => ({ ...m }));
      out.push(c);
    } else {
      out.push(makeRest(needed));
    }
    totalDur += needed;
    barIdx++;
  }
  return out;
}

/**
 * Gera um `TheoreticalPlan` completo de forma 100% offline aplicando as regras da skill
 * `music-composition` (progressões funcionais, cadências, voice leading e harmonização).
 */
export function buildOfflineSkillPlan(params: {
  block: Block;
  song: Song;
  tonic: PitchClass | null;
  scaleId: string;
  options: AIGenerationOptions;
}): TheoreticalPlan {
  const { block, options } = params;
  const {
    effectiveTonic,
    effectiveScale,
    ctx,
    speller,
    meter,
    totalBars,
    genre,
    minor,
  } = resolveContext(params);

  const beatsPerBar = Math.max(1, meter[0]);
  const camelotKey = toCamelotCode(effectiveTonic, effectiveScale);
  const tonicName = safeAsciiTonicName(effectiveTonic, speller);
  const voiceLeadingStyle = voiceLeadingStyleForGenre(genre);
  const grooveStyle = GENRE_CATALOG[genre].groove;
  const targetRoles = targetRolesForMode(options);

  const hasMelody = (block.melody?.length ?? 0) > 0;
  const hasExistingChords = block.chords.some((c) => !isRest(c));

  let progression: string[];
  let modeSummary: string;

  if (options.mode === "harmonize" && hasMelody && block.melody) {
    const harmonized = autoHarmonize({
      melody: block.melody,
      ctx,
      meter,
      stepBeats: beatsPerBar,
      mode: "replace",
    });
    if (harmonized.length > 0) {
      const genreFallback = buildGenreProgressionSymbols(
        genre,
        effectiveTonic,
        minor,
        totalBars,
        speller,
        beatsPerBar,
      )
        .map((sym) => parseChordSymbol(sym))
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => {
          const c = makeChord(p.root, p.quality, beatsPerBar);
          c.modifiers = p.modifiers;
          return c;
        });
      const padded = padHarmonizedChords(harmonized, totalBars, beatsPerBar, genreFallback);
      progression = chordsToBarSymbols(padded, effectiveTonic, meter, totalBars);
      modeSummary = "harmonização funcional da melodia existente via autoHarmonize";
    } else {
      progression = buildGenreProgressionSymbols(genre, effectiveTonic, minor, totalBars, speller, beatsPerBar);
      modeSummary = `progressão idiomática ${genre} (${minor ? "menor" : "maior"})`;
    }
  } else if (options.mode === "melody" && hasExistingChords) {
    progression = chordsToBarSymbols(block.chords, effectiveTonic, meter, totalBars);
    modeSummary = "preservação da harmonia existente para condução melódica guiada por tons do acorde";
  } else {
    progression = buildGenreProgressionSymbols(genre, effectiveTonic, minor, totalBars, speller, beatsPerBar);
    modeSummary =
      options.mode === "inpaint"
        ? `regeneração parcial (inpaint) com progressão idiomática ${genre} (${minor ? "menor" : "maior"})`
        : `progressão idiomática ${genre} (${minor ? "menor" : "maior"})`;
  }

  const progPreview = progression.slice(0, 8).join(" – ") + (progression.length > 8 ? " …" : "");
  const explanation =
    `Plano gerado pela Skill music-composition (modo offline, sem servidor MIDI-GPT): ` +
    `tonalidade ${tonicName} ${ctx.scale.name} (${camelotKey}), gênero ${genre}, ${totalBars} compassos ` +
    `(${modeSummary}). Condução de vozes "${voiceLeadingStyle}", groove "${grooveStyle}". ` +
    `Progressão: ${progPreview}.`;

  return {
    camelot_key: camelotKey,
    tonic_pc: effectiveTonic,
    tonic_name: tonicName,
    scale_id: effectiveScale,
    scale_pitches: [...ctx.pcs],
    genre,
    total_bars: totalBars,
    chord_progression_per_bar: progression,
    voice_leading_style: voiceLeadingStyle,
    groove_style: grooveStyle,
    target_roles_order: targetRoles,
    primer_python_code: "",
    theoretical_explanation: explanation,
  };
}

// ——— PRNG determinístico (Mulberry32) ————————————————————————————————————————

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ——— Slicing / Inpaint de Acordes e Melodia ————————————————————————————————————

function sliceChordsForInpaint(
  existing: readonly Chord[],
  replacementWindow: readonly Chord[],
  startBeat: number,
  endBeat: number,
): Chord[] {
  const before: Chord[] = [];
  const after: Chord[] = [];
  let cursor = 0;

  for (const c of existing) {
    const cStart = cursor;
    const cEnd = cursor + c.duration;
    cursor = cEnd;

    if (cEnd <= startBeat + EPS) {
      before.push({ ...c, modifiers: [...c.modifiers] });
      continue;
    }
    if (cStart >= endBeat - EPS) {
      after.push({ ...c, modifiers: [...c.modifiers] });
      continue;
    }

    // Acorde cruza a borda inicial
    if (cStart < startBeat - EPS) {
      const keepDur = Math.round((startBeat - cStart) * 64) / 64;
      if (keepDur >= 0.25 - EPS) {
        before.push({ ...c, modifiers: [...c.modifiers], duration: keepDur });
      }
    }
    // Acorde cruza a borda final
    if (cEnd > endBeat + EPS) {
      const keepDur = Math.round((cEnd - endBeat) * 64) / 64;
      if (keepDur >= 0.25 - EPS) {
        after.push({ ...c, id: newChordId(), modifiers: [...c.modifiers], duration: keepDur });
      }
    }
  }

  const beforeDur = before.reduce((sum, c) => sum + c.duration, 0);
  if (beforeDur < startBeat - EPS) {
    const gap = Math.round((startBeat - beforeDur) * 64) / 64;
    if (gap >= 0.25 - EPS) {
      before.push(makeRest(gap));
    }
  }

  return [
    ...before,
    ...replacementWindow.map((c) => ({ ...c, modifiers: [...c.modifiers] })),
    ...after,
  ];
}

function sliceMelodyOutsideRange(
  existing: readonly MelodyNote[],
  startBeat: number,
  endBeat: number,
): MelodyNote[] {
  const kept: MelodyNote[] = [];
  for (const n of existing) {
    const nStart = n.start;
    const nEnd = n.start + n.duration;
    if (nEnd <= startBeat + EPS || nStart >= endBeat - EPS) {
      kept.push({ ...n });
      continue;
    }
    if (nStart < startBeat - EPS) {
      const trimmed = Math.round((startBeat - nStart) * 10000) / 10000;
      if (trimmed >= MELODY_MIN_DURATION - MELODY_EPS) {
        kept.push({ ...n, duration: trimmed });
      }
    }
    if (nEnd > endBeat + EPS) {
      const trimmed = Math.round((nEnd - endBeat) * 10000) / 10000;
      if (trimmed >= MELODY_MIN_DURATION - MELODY_EPS) {
        kept.push(makeMelodyNote(n.pitch, endBeat, trimmed, n.velocity));
      }
    }
  }
  return kept;
}

// ——— Gerador Melódico Guiado por Tons do Acorde e Contorno em Arco ——————————————

function chordAtOrFallback(
  chords: readonly Chord[],
  planChords: readonly Chord[],
  beat: number,
  beatsPerBar: number,
): Chord | null {
  const direct = chordAtBeat(chords, beat);
  if (direct && !isRest(direct.chord)) return direct.chord;
  if (chords.length > 0 && direct && isRest(direct.chord)) {
    const barIdx = Math.floor(beat / Math.max(1, beatsPerBar));
    const fallback = planChords[barIdx % Math.max(1, planChords.length)];
    return direct.chord.rest ? direct.chord : fallback ?? null;
  }
  if (planChords.length > 0) {
    const barIdx = Math.floor(beat / Math.max(1, beatsPerBar));
    return planChords[barIdx % planChords.length] ?? null;
  }
  return null;
}

function buildOnsetsForBar(params: {
  barIdx: number;
  totalBars: number;
  beatsPerBar: number;
  meter: Meter;
  grid: number;
  density: number;
  genre: AIGenre;
  temperature: number;
  rng: () => number;
}): number[] {
  const { barIdx, totalBars, beatsPerBar, meter, grid, density, genre, temperature, rng } = params;
  const maxSlots = Math.max(1, Math.floor((beatsPerBar + EPS) / grid));
  const candidates: { offset: number; score: number }[] = [];

  const syncopationBias =
    genre === "jazz" || genre === "latin" || genre === "hip-hop" || genre === "dance-electronic"
      ? 0.35
      : 0.08;

  for (let i = 0; i < maxSlots; i++) {
    const offset = Math.round(i * grid * 10000) / 10000;
    const w = beatWeight(offset, meter);
    const isHalfBeat = Math.abs((offset * 2) - Math.round(offset * 2)) < EPS && Math.abs(offset - Math.round(offset)) > EPS;
    let score = w;
    if (i === 0) score += 10; // âncora do tempo 1
    if (isHalfBeat) score += syncopationBias;
    score += (rng() - 0.5) * 0.45 * Math.min(1.5, temperature);
    candidates.push({ offset, score });
  }

  let targetCount: number;
  if (density <= 1) {
    targetCount = 1;
  } else if (density <= 5) {
    targetCount = Math.round(1 + ((density - 1) / 4) * Math.max(0, beatsPerBar - 1));
  } else {
    const extraMax = Math.max(0, Math.min(beatsPerBar * 1.5, maxSlots - beatsPerBar));
    targetCount = Math.round(beatsPerBar + ((density - 5) / 5) * extraMax);
  }

  // Último compasso da frase respira um pouco para cadência conclusiva
  if (barIdx === totalBars - 1 && targetCount > 2) {
    targetCount = Math.max(2, Math.ceil(targetCount * 0.65));
  }

  targetCount = clampInt(targetCount, 1, maxSlots);

  const chosen = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)
    .map((c) => c.offset)
    .sort((a, b) => a - b);

  return chosen;
}

function buildScaleMidiPool(ctx: ScaleContext, low: number, high: number): number[] {
  const pool: number[] = [];
  for (let m = low; m <= high; m++) {
    if (ctx.pcSet.has(mod12(m))) pool.push(m);
  }
  return pool.length ? pool : [60, 62, 64, 65, 67, 69, 71, 72];
}

function chordMidiPool(chord: Chord | null, low: number, high: number): {
  all: number[];
  guide: Set<PitchClass>;
  rootAndFifth: Set<PitchClass>;
} {
  const guide = new Set<PitchClass>();
  const rootAndFifth = new Set<PitchClass>();
  if (!chord || isRest(chord)) {
    return { all: [], guide, rootAndFifth };
  }
  const ivs = chordIntervals(chord);
  const allPcs = new Set<PitchClass>();
  for (const iv of ivs) {
    const m12 = mod12(iv);
    const pc = mod12(chord.root + m12);
    allPcs.add(pc);
    if (m12 === 3 || m12 === 4 || m12 === 10 || m12 === 11) {
      guide.add(pc);
    } else if (m12 === 0 || m12 === 6 || m12 === 7 || m12 === 8) {
      rootAndFifth.add(pc);
    }
  }
  const all: number[] = [];
  for (let m = low; m <= high; m++) {
    if (allPcs.has(mod12(m))) all.push(m);
  }
  return { all, guide, rootAndFifth };
}

function generateMelodySegment(params: {
  startBar: number;
  endBar: number;
  totalBars: number;
  beatsPerBar: number;
  meter: Meter;
  grid: number;
  chords: readonly Chord[];
  planChords: readonly Chord[];
  ctx: ScaleContext;
  options: AIGenerationOptions;
  genre: AIGenre;
  rng: () => number;
}): MelodyNote[] {
  const {
    startBar,
    endBar,
    totalBars,
    beatsPerBar,
    meter,
    grid,
    chords,
    planChords,
    ctx,
    options,
    genre,
    rng,
  } = params;

  const density = clampInt(options.density, 1, 10);
  const durRatio = clampFloat(options.noteDuration, 0.1, 1.0);
  const temp = clampFloat(options.temperature, 0.1, 2.0);
  const scaleMidis = buildScaleMidiPool(ctx, MELODY_DEFAULT_LOW, MELODY_DEFAULT_HIGH);
  const scaleMidiSet = new Set(scaleMidis);

  const segmentBars = Math.max(1, endBar - startBar);
  const segmentStartBeat = startBar * beatsPerBar;
  const segmentEndBeat = endBar * beatsPerBar;
  const segmentSpan = Math.max(grid, segmentEndBeat - segmentStartBeat);

  // Coleta todos os onsets do trecho
  const barOnsets: { absBeat: number; barEnd: number; barIdx: number }[] = [];
  for (let b = startBar; b < endBar; b++) {
    const barStart = b * beatsPerBar;
    const barEnd = (b + 1) * beatsPerBar;
    const localOnsets = buildOnsetsForBar({
      barIdx: b,
      totalBars,
      beatsPerBar,
      meter,
      grid,
      density,
      genre,
      temperature: temp,
      rng,
    });
    for (const off of localOnsets) {
      barOnsets.push({
        absBeat: Math.round((barStart + off) * 10000) / 10000,
        barEnd,
        barIdx: b,
      });
    }
  }

  const notes: MelodyNote[] = [];
  let prevPitch: number | null = null;
  let prevPrevPitch: number | null = null;
  let repeatCount = 0;

  for (let idx = 0; idx < barOnsets.length; idx++) {
    const { absBeat, barEnd } = barOnsets[idx];
    const nextLimit = idx + 1 < barOnsets.length ? Math.min(barEnd, barOnsets[idx + 1].absBeat) : barEnd;
    const slotDur = Math.max(MELODY_MIN_DURATION, Math.round((nextLimit - absBeat) * 10000) / 10000);
    const minNoteDur = Math.min(slotDur, Math.max(MELODY_MIN_DURATION, grid));
    const quantizedDur = Math.round((slotDur * durRatio) / grid) * grid;
    const duration = Math.round(Math.max(minNoteDur, Math.min(slotDur, quantizedDur)) * 10000) / 10000;

    const progress = Math.min(1, Math.max(0, (absBeat - segmentStartBeat) / segmentSpan));
    const subPhraseCycles = Math.max(1, Math.round(segmentBars / 4));
    const archTarget =
      67 +
      9 * Math.sin(Math.PI * Math.pow(progress, 0.85)) +
      2 * Math.sin(2 * Math.PI * progress * subPhraseCycles);

    const chord = chordAtOrFallback(chords, planChords, absBeat, beatsPerBar);
    const chordInfo = chordMidiPool(chord, MELODY_DEFAULT_LOW, MELODY_DEFAULT_HIGH);
    const weight = beatWeight(absBeat, meter);
    const isPrimaryStrong = weight >= 2.0;
    const isMediumBeat = weight >= 1.5 && weight < 2.0;
    const isFinalNote = idx === barOnsets.length - 1;
    const isOpeningNote = idx === 0;

    let candidatePool: number[];
    if (isPrimaryStrong && chordInfo.all.length > 0) {
      candidatePool = chordInfo.all;
    } else if (isMediumBeat && chordInfo.all.length > 0) {
      candidatePool = Array.from(new Set([...chordInfo.all, ...scaleMidis]));
    } else {
      candidatePool = Array.from(new Set([...scaleMidis, ...chordInfo.all]));
    }

    const chordSet = new Set(chordInfo.all);
    const prevLeap = prevPitch !== null && prevPrevPitch !== null ? prevPitch - prevPrevPitch : 0;

    let bestPitch = candidatePool[0];
    let bestScore = -Infinity;

    for (const pitch of candidatePool) {
      const pc = mod12(pitch);
      let score = 0;

      // 1. Aderência ao contorno em arco suave
      score -= Math.abs(pitch - archTarget) * 0.42;

      // 2. Hierarquia harmônica (tons-guia nos tempos fortes, notas da escala nos fracos)
      if (isPrimaryStrong) {
        if (chordInfo.guide.has(pc)) score += 3.0;
        else if (chordInfo.rootAndFifth.has(pc)) score += 2.2;
        else if (chordSet.has(pitch)) score += 1.4;
      } else if (isMediumBeat) {
        if (chordSet.has(pitch)) score += 1.4;
        if (scaleMidiSet.has(pitch)) score += 0.8;
      } else {
        // Tempo fraco: favorece graus conjuntos diatônicos (notas de passagem)
        if (scaleMidiSet.has(pitch)) score += 1.6;
        if (chordSet.has(pitch)) score += 0.4;
      }

      // 3. Condução melódica / graus conjuntos vs saltos
      if (prevPitch !== null) {
        const dist = Math.abs(pitch - prevPitch);
        if (dist === 0) {
          score -= repeatCount >= 1 ? 3.5 : 1.0;
        } else if (dist <= 2) {
          score += isPrimaryStrong ? 1.2 : 2.5;
        } else if (dist <= 4) {
          score += 1.4;
        } else if (dist <= 7) {
          score += 0.2;
        } else {
          score -= (dist - 7) * 0.7;
        }

        // Recuperação pós-salto (leap recovery) em grau conjunto na direção oposta
        if (Math.abs(prevLeap) >= 5 && dist >= 1 && dist <= 3) {
          const sameReturnDir = (pitch - prevPitch) * prevLeap < 0;
          if (sameReturnDir) score += 2.2;
        }
      }

      // 4. Ancoragem tonal no início e fechamento cadencial no fim
      if (isOpeningNote && (pc === ctx.tonic || chordInfo.rootAndFifth.has(pc))) {
        score += 1.4;
      }
      if (isFinalNote) {
        if (pc === ctx.tonic) score += 4.0;
        else if (chordInfo.rootAndFifth.has(pc)) score += 2.2;
        else if (chordInfo.guide.has(pc)) score += 1.2;
      }

      // 5. Variação determinística controlada por temperature
      score += (rng() - 0.5) * 0.9 * temp;

      if (score > bestScore) {
        bestScore = score;
        bestPitch = pitch;
      }
    }

    if (prevPitch === bestPitch) repeatCount++;
    else repeatCount = 0;

    let velocity: number | undefined;
    if (options.useVelocity) {
      const baseVel =
        weight >= 3.0 ? 0.9 : weight >= 2.0 ? 0.82 : weight >= 1.5 ? 0.74 : 0.63;
      const phraseBoost = 0.05 * Math.sin(Math.PI * progress);
      const jitter = (rng() - 0.5) * 0.08 * Math.min(1.5, temp);
      velocity = Math.round(clampFloat(baseVel + phraseBoost + jitter, 0.45, 0.98) * 1000) / 1000;
    }

    notes.push(makeMelodyNote(bestPitch, absBeat, duration, velocity));
    prevPrevPitch = prevPitch;
    prevPitch = bestPitch;
  }

  return normalizeMonophonic(notes);
}

function selectBassInstrument(genre: AIGenre): InstrumentId {
  if (genre === "classical" || genre === "soundtrack") {
    return hasInstrument("contrabass") ? "contrabass" : "piano";
  }
  return hasInstrument("contrabass-pizz") ? "contrabass-pizz" : "contrabass";
}

/**
 * Gera o plano teórico (`TheoreticalPlan`) e o patch de aplicação direta no bloco (`AIBlockPatch`)
 * 100% offline, sem depender de servidor Python / MIDI-GPT.
 */
export function generateOfflineSkillPatch(params: {
  block: Block;
  song: Song;
  tonic: PitchClass | null;
  scaleId: string;
  options: AIGenerationOptions;
  melodyGridBeats: number;
}): { plan: TheoreticalPlan; patch: AIBlockPatch } {
  const { block, tonic, options, melodyGridBeats } = params;
  const {
    effectiveTonic,
    effectiveScale,
    ctx,
    meter,
    totalBars,
    genre,
  } = resolveContext(params);

  const plan = buildOfflineSkillPlan(params);
  const beatsPerBar = Math.max(1, meter[0]);
  const planChords = planToChords(plan, meter);

  const inpaintRoles: TrackRole[] =
    options.mode === "inpaint"
      ? options.inpaintRange?.roles.length
        ? [...options.inpaintRange.roles]
        : ["chords", "melody"]
      : [];

  const wantsChords =
    options.mode === "harmonize" ||
    options.mode === "full" ||
    (options.mode === "inpaint" && inpaintRoles.includes("chords"));

  const wantsMelody =
    options.mode === "melody" ||
    options.mode === "full" ||
    (options.mode === "inpaint" && inpaintRoles.includes("melody"));

  const startBar =
    options.mode === "inpaint"
      ? clampInt(options.inpaintRange?.startBar ?? 0, 0, Math.max(0, totalBars - 1))
      : 0;
  const endBar =
    options.mode === "inpaint"
      ? clampInt(options.inpaintRange?.endBar ?? totalBars, startBar + 1, totalBars)
      : totalBars;

  const patch: AIBlockPatch = {};

  if (wantsChords) {
    if (options.mode === "harmonize" && block.melody?.length) {
      const harmonized = autoHarmonize({
        melody: block.melody,
        ctx,
        meter,
        stepBeats: beatsPerBar,
        mode: "replace",
      });
      if (harmonized.length > 0) {
        patch.chords = padHarmonizedChords(harmonized, totalBars, beatsPerBar, planChords);
      } else {
        patch.chords = planChords;
      }
    } else if (options.mode === "inpaint") {
      const startBeat = startBar * beatsPerBar;
      const endBeat = endBar * beatsPerBar;
      const replacementWindow = planChords.slice(startBar, endBar);
      patch.chords = sliceChordsForInpaint(block.chords, replacementWindow, startBeat, endBeat);
    } else {
      patch.chords = planChords;
    }
  }

  if (wantsMelody) {
    const grid = Math.max(MELODY_MIN_DURATION, melodyGridBeats);
    const seedValue =
      options.seed !== undefined && options.seed !== null
        ? options.seed
        : hashString(
            `${effectiveTonic}|${effectiveScale}|${genre}|${totalBars}|${options.mode}|${options.density}|${options.noteDuration}|${options.temperature}|${startBar}-${endBar}|${options.stylePrompt}`,
          );
    const rng = createRng(seedValue);

    const effectiveChordsForMelody =
      patch.chords ?? (block.chords.some((c) => !isRest(c)) ? block.chords : planChords);

    const generatedSegment = generateMelodySegment({
      startBar,
      endBar,
      totalBars,
      beatsPerBar,
      meter,
      grid,
      chords: effectiveChordsForMelody,
      planChords,
      ctx,
      options,
      genre,
      rng,
    });

    if (options.mode === "inpaint") {
      const startBeat = startBar * beatsPerBar;
      const endBeat = endBar * beatsPerBar;
      const preserved = sliceMelodyOutsideRange(block.melody ?? [], startBeat, endBeat);
      patch.melody = normalizeMonophonic([...preserved, ...generatedSegment]);
    } else {
      patch.melody = generatedSegment;
    }
  }

  if ((options.mode === "harmonize" || options.mode === "full") && !block.bassInstrument) {
    patch.bassInstrument = selectBassInstrument(genre);
  }

  if (tonic === null && !block.key) {
    patch.tonic = effectiveTonic;
    patch.scaleId = effectiveScale;
  }

  return { plan, patch };
}
