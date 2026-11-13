// Persistência atrás de uma interface: hoje localStorage; no futuro, um backend
// (contas/sync) pode implementar o mesmo contrato sem mexer no resto do app.

import type { AccidentalPref } from "../core/pitch";
import type { Song } from "../core/song";
import { GRIDS, type Grid } from "../core/timeline";
import type { MidiSettings } from "../audio/midi";
import { SCALES } from "../core/scales";
import { sanitizeContent } from "../export/json";

export type RestrictionMode = "strict" | "colorful" | "free";

export type Session = {
  version: 1;
  scaleId: string;
  tonic: number | null;
  accidentals: AccidentalPref;
  mode: RestrictionMode;
  startWithSelected: boolean;
  soundOnClick: boolean;
  metronome: boolean;
  followScale: boolean;
  countIn?: boolean;
  /** Grade de edição das durações (padrão: 1 tempo). */
  grid?: Grid;
  /** Mostrar a lista por graus abaixo da roda. */
  showDegrees?: boolean;
  /** Tocar o acorde ao pousar o mouse numa fatia da roda. */
  soundOnHover?: boolean;
  midi?: MidiSettings;
  song: Song;
  /** Música salva associada à sessão (null = ainda não salva). */
  songId?: string | null;
  songName?: string;
  /** Hash do conteúdo no último salvamento, para detectar alterações. */
  savedHash?: string | null;
};

/** Conteúdo de uma música salva: tonalidade + arranjo. Preferências de UI ficam na sessão. */
export type SavedSong = {
  id: string;
  name: string;
  updatedAt: number;
  scaleId: string;
  tonic: number | null;
  song: Song;
};

export type SavedSongMeta = Omit<SavedSong, "song">;

export interface SongRepository {
  /** `true` se o armazenamento realmente persiste (false = só memória). */
  readonly persistent: boolean;
  loadSession(): Session | null;
  /** Devolve `true` se persistiu. */
  saveSession(session: Session): boolean;
  clearSession(): void;
  listSongs(): SavedSongMeta[];
  loadSong(id: string): SavedSong | null;
  /** Devolve `true` se persistiu. */
  saveSong(song: SavedSong): boolean;
  deleteSong(id: string): void;
}

const KEY = "chordplanner:session";
const SONGS_KEY = "chordplanner:songs";
const CORRUPT_KEY = "chordplanner:songs.corrompido";

function readSongs(): Record<string, SavedSong> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SONGS_KEY);
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, SavedSong>;
    throw new Error("formato inesperado");
  } catch {
    // Guarda o texto bruto para que um salvamento posterior não destrua os dados sem deixar cópia.
    try {
      // Mantém a primeira cópia: uma corrupção posterior não pode apagar o que ainda dá para recuperar.
      if (raw && localStorage.getItem(CORRUPT_KEY) === null) localStorage.setItem(CORRUPT_KEY, raw);
    } catch {
      // sem espaço: nada a fazer
    }
    return {};
  }
}

function writeSongs(songs: Record<string, SavedSong>): boolean {
  try {
    localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
    return true;
  } catch {
    // Sem armazenamento (modo privado, cota): a música continua só na sessão.
    return false;
  }
}

const SCALE_IDS = new Set(SCALES.map((s) => s.id));
const MODES: RestrictionMode[] = ["strict", "colorful", "free"];
const ACCIDENTALS: AccidentalPref[] = ["auto", "sharp", "flat"];
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export class LocalSongRepository implements SongRepository {
  readonly persistent = true;

  loadSession(): Session | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as Record<string, unknown> | null;
      if (!p || p.version !== 1) return null;
      const content = sanitizeContent(p);
      if (!content) return null;
      return {
        version: 1,
        ...content,
        accidentals: ACCIDENTALS.find((a) => a === p.accidentals) ?? "auto",
        mode: MODES.find((m) => m === p.mode) ?? "colorful",
        startWithSelected: bool(p.startWithSelected, false),
        soundOnClick: bool(p.soundOnClick, true),
        metronome: bool(p.metronome, false),
        followScale: bool(p.followScale, false),
        countIn: bool(p.countIn, false),
        grid: GRIDS.find((g) => g === p.grid) ?? 1,
        showDegrees: bool(p.showDegrees, true),
        soundOnHover: bool(p.soundOnHover, false),
        midi: typeof p.midi === "object" && p.midi !== null ? (p.midi as MidiSettings) : undefined,
        songId: typeof p.songId === "string" ? p.songId : null,
        songName: typeof p.songName === "string" ? p.songName : undefined,
        savedHash: typeof p.savedHash === "string" || p.savedHash === null ? p.savedHash : undefined,
      };
    } catch {
      return null;
    }
  }

  saveSession(session: Session): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
      return true;
    } catch {
      // Armazenamento indisponível (modo privado, cota): segue sem persistir.
      return false;
    }
  }

  clearSession(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignora
    }
  }

  listSongs(): SavedSongMeta[] {
    // Metadados coagidos: um registro adulterado não pode quebrar a lista "Abrir".
    return Object.entries(readSongs())
      .filter(([, s]) => typeof s === "object" && s !== null && typeof s.scaleId === "string" && SCALE_IDS.has(s.scaleId))
      .map(([key, s]) => ({
        id: typeof s.id === "string" ? s.id : key,
        name: typeof s.name === "string" ? s.name : "Sem título",
        updatedAt: typeof s.updatedAt === "number" && Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
        scaleId: s.scaleId,
        tonic: typeof s.tonic === "number" && Number.isInteger(s.tonic) && s.tonic >= 0 && s.tonic <= 11 ? s.tonic : null,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  loadSong(id: string): SavedSong | null {
    const stored = readSongs()[id];
    const content = stored ? sanitizeContent(stored) : null;
    if (!stored || !content) return null;
    return {
      id: typeof stored.id === "string" ? stored.id : id,
      name: typeof stored.name === "string" ? stored.name : "Sem título",
      updatedAt: typeof stored.updatedAt === "number" ? stored.updatedAt : 0,
      ...content,
    };
  }

  saveSong(song: SavedSong): boolean {
    return writeSongs({ ...readSongs(), [song.id]: song });
  }

  deleteSong(id: string): void {
    const songs = readSongs();
    delete songs[id];
    writeSongs(songs);
  }
}

/** Repositório em memória (testes, ou quando não há armazenamento). */
export class MemorySongRepository implements SongRepository {
  readonly persistent = false;
  private session: Session | null = null;
  private songs = new Map<string, SavedSong>();
  loadSession() {
    return this.session;
  }
  saveSession(session: Session) {
    this.session = session;
    return true;
  }
  clearSession() {
    this.session = null;
  }
  listSongs() {
    return [...this.songs.values()].map(({ song: _song, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  loadSong(id: string) {
    return this.songs.get(id) ?? null;
  }
  saveSong(song: SavedSong) {
    this.songs.set(song.id, structuredClone(song));
    return true;
  }
  deleteSong(id: string) {
    this.songs.delete(id);
  }
}

const storageAvailable = (() => {
  try {
    return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
})();

export const repository: SongRepository = storageAvailable ? new LocalSongRepository() : new MemorySongRepository();
