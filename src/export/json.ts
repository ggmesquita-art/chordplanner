// Formato de arquivo da música (.json) e validação de conteúdo vindo de fora
// (arquivo, link, localStorage). Módulo puro: sem React nem DOM.

import { hasInstrument } from "../audio/instruments";
import { newChordId, QUALITIES, type Chord, type QualityId, type VoicingId } from "../core/chords";
import type { Modifier } from "../core/modifiers";
import { SCALES } from "../core/scales";
import { BLOCK_COLORS, newId, type ArrangementItem, type Block, type PlaybackPattern, type Song } from "../core/song";
import { METERS, type Meter } from "../core/timeline";

export type SongContent = { scaleId: string; tonic: number | null; song: Song };
export type SongFile = SongContent & { format: "chordplanner-song"; version: 1; name: string };

export class SongFileError extends Error {}

const SCALE_IDS = new Set(SCALES.map((s) => s.id));
const QUALITY_IDS = new Set<string>(QUALITIES.map((q) => q.id));
const PATTERNS: PlaybackPattern[] = ["block", "arp-up", "arp-down", "comping"];
const VOICINGS: VoicingId[] = ["closed", "open", "drop2", "drop3", "quartal", "shell"];

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const MAX_NAME = 80;
// Limites para conteúdo de terceiros (arquivo/link): bem acima do uso real, mas impedem travar a aba.
const MAX_ID = 64;
const MAX_ITEMS = 256;
const MAX_CHORDS = 256;
const MAX_MODIFIERS = 12;
const MIN_DURATION = 0.25;
const MAX_DURATION = 64;

/** Id utilizável como chave de objeto: curto e sem colidir com `__proto__`, `constructor`, `toString`… */
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID && !(v in Object.prototype);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function bpmOf(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(30, Math.min(300, Math.round(v)));
}

function meterOf(v: unknown): Meter | undefined {
  if (!Array.isArray(v)) return undefined;
  const m = METERS.find((x) => x[0] === v[0] && x[1] === v[1]);
  return m ? [m[0], m[1]] : undefined;
}

const patternOf = (v: unknown): PlaybackPattern | undefined => PATTERNS.find((p) => p === v);
const instrumentOf = (v: unknown): string | undefined => (typeof v === "string" && hasInstrument(v) ? v : undefined);

function modifierOf(v: unknown): Modifier | null {
  if (!isObj(v)) return null;
  const { kind, value } = v;
  const ok =
    (kind === "ext" && [6, 7, "maj7", 9, 11, 13].includes(value as never)) ||
    (kind === "sus" && (value === 2 || value === 4)) ||
    (kind === "add" && (value === 9 || value === 11 || value === 13)) ||
    (kind === "alt" && ["b5", "#5", "b9", "#9", "#11", "b13"].includes(value as never)) ||
    (kind === "omit" && (value === 3 || value === 5));
  return ok ? ({ kind, value } as Modifier) : null;
}

function chordOf(v: unknown, used: Set<string>): Chord | null {
  if (!isObj(v)) return null;
  if (!isInt(v.root, 0, 11) || typeof v.quality !== "string" || !QUALITY_IDS.has(v.quality)) return null;
  let id = isId(v.id) && !used.has(v.id) ? v.id : newChordId();
  while (used.has(id)) id = newChordId();
  used.add(id);
  const chord: Chord = {
    id,
    root: v.root,
    quality: v.quality as QualityId,
    modifiers: Array.isArray(v.modifiers)
      ? v.modifiers
          .slice(0, MAX_MODIFIERS)
          .map(modifierOf)
          .filter((m): m is Modifier => m !== null)
      : [],
    duration:
      typeof v.duration === "number" && Number.isFinite(v.duration) && v.duration > 0 ? Math.max(MIN_DURATION, Math.min(MAX_DURATION, v.duration)) : 4,
  };
  if (isInt(v.bass, 0, 11)) chord.bass = v.bass;
  if (typeof v.octave === "number" && Number.isFinite(v.octave)) chord.octave = Math.max(-2, Math.min(2, Math.round(v.octave)));
  const voicing = VOICINGS.find((x) => x === v.voicing);
  if (voicing) chord.voicing = voicing;
  return chord;
}

function blockOf(key: string, v: unknown, colorIndex: number, used: Set<string>): Block | null {
  if (!isObj(v) || !Array.isArray(v.chords)) return null;
  const block: Block = {
    id: key,
    name: typeof v.name === "string" && v.name.trim() ? v.name.slice(0, MAX_NAME) : "Bloco",
    // Só cor hexadecimal: o valor vai para uma variável CSS e não pode carregar `url(...)` de um link de terceiros.
    color: typeof v.color === "string" && HEX_COLOR.test(v.color) ? v.color : BLOCK_COLORS[colorIndex % BLOCK_COLORS.length],
    chords: v.chords
      .slice(0, MAX_CHORDS)
      .map((c) => chordOf(c, used))
      .filter((c): c is Chord => c !== null),
  };
  const bpm = bpmOf(v.bpm);
  if (bpm !== undefined) block.bpm = bpm;
  const meter = meterOf(v.meter);
  if (meter) block.meter = meter;
  const pattern = patternOf(v.pattern);
  if (pattern) block.pattern = pattern;
  const instrument = instrumentOf(v.instrument);
  if (instrument) block.instrument = instrument;
  if (typeof v.midiChannel === "number" && Number.isFinite(v.midiChannel)) block.midiChannel = Math.max(1, Math.min(16, Math.round(v.midiChannel)));
  return block;
}

/** Valida e saneia conteúdo vindo de fora (arquivo, URL, localStorage). null = irrecuperável. */
export function sanitizeContent(input: unknown): SongContent | null {
  if (!isObj(input) || typeof input.scaleId !== "string" || !SCALE_IDS.has(input.scaleId)) return null;
  const s = input.song;
  if (!isObj(s) || !isObj(s.blocks) || !Array.isArray(s.arrangement)) return null;

  const usedItems = new Set<string>();
  const arrangement: ArrangementItem[] = [];
  for (const raw of s.arrangement.slice(0, MAX_ITEMS)) {
    if (!isObj(raw) || !isId(raw.blockId) || !Object.hasOwn(s.blocks, raw.blockId)) continue;
    let id = isId(raw.id) && !usedItems.has(raw.id) ? raw.id : newId("i");
    while (usedItems.has(id)) id = newId("i");
    usedItems.add(id);
    const repeat = typeof raw.repeat === "number" && Number.isFinite(raw.repeat) ? Math.max(1, Math.min(16, Math.round(raw.repeat))) : 1;
    arrangement.push({ id, blockId: raw.blockId, repeat });
  }
  if (!arrangement.length) return null;

  const usedChords = new Set<string>();
  const blocks: Record<string, Block> = {};
  let colorIndex = 0;
  for (const item of arrangement) {
    if (Object.hasOwn(blocks, item.blockId)) continue;
    const b = blockOf(item.blockId, s.blocks[item.blockId], colorIndex, usedChords);
    if (!b) continue;
    blocks[item.blockId] = b;
    colorIndex++;
  }
  // Itens que apontam para blocos inválidos também são descartados.
  const valid = arrangement.filter((it) => Object.hasOwn(blocks, it.blockId));
  if (!valid.length) return null;

  return {
    scaleId: input.scaleId,
    tonic: isInt(input.tonic, 0, 11) ? input.tonic : null,
    song: {
      bpm: bpmOf(s.bpm) ?? 90,
      meter: meterOf(s.meter) ?? [4, 4],
      swing: typeof s.swing === "number" && Number.isFinite(s.swing) ? Math.max(0, Math.min(75, s.swing)) : 0,
      instrument: instrumentOf(s.instrument) ?? "piano",
      pattern: patternOf(s.pattern) ?? "block",
      blocks,
      arrangement: valid,
    },
  };
}

export function toSongFile(data: SongContent & { name: string }): SongFile {
  return { format: "chordplanner-song", version: 1, name: data.name, scaleId: data.scaleId, tonic: data.tonic, song: data.song };
}

export function serializeSongFile(file: SongFile, pretty = false): string {
  return JSON.stringify(file, null, pretty ? 2 : undefined);
}

/** Lança SongFileError (mensagem em pt-BR, pronta para a UI) se o texto não for um arquivo válido. */
export function parseSongFile(text: string): SongFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SongFileError("O arquivo não é um JSON válido.");
  }
  if (!isObj(raw) || raw.format !== "chordplanner-song") throw new SongFileError("Este arquivo não é uma música do ChordPlanner.");
  if (typeof raw.version === "number" && raw.version > 1) throw new SongFileError("Arquivo criado por uma versão mais nova do ChordPlanner.");
  const content = sanitizeContent(raw);
  if (!content) throw new SongFileError("O arquivo está danificado ou incompleto.");
  const name = (typeof raw.name === "string" ? raw.name.trim() : "").slice(0, MAX_NAME).trim() || "Sem título";
  return toSongFile({ ...content, name });
}
