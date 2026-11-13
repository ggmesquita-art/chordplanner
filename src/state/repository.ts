// Persistência atrás de uma interface: hoje localStorage; no futuro, um backend
// (contas/sync) pode implementar o mesmo contrato sem mexer no resto do app.

import type { AccidentalPref } from "../core/pitch";
import type { Song } from "../core/song";
import type { MidiSettings } from "../audio/midi";

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
  loadSession(): Session | null;
  saveSession(session: Session): void;
  listSongs(): SavedSongMeta[];
  loadSong(id: string): SavedSong | null;
  saveSong(song: SavedSong): void;
  deleteSong(id: string): void;
}

const KEY = "chordplanner:session";
const SONGS_KEY = "chordplanner:songs";

function readSongs(): Record<string, SavedSong> {
  try {
    return JSON.parse(localStorage.getItem(SONGS_KEY) ?? "{}") as Record<string, SavedSong>;
  } catch {
    return {};
  }
}

function writeSongs(songs: Record<string, SavedSong>) {
  try {
    localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
  } catch {
    // Sem armazenamento (modo privado, cota): a música continua só na sessão.
  }
}

export class LocalSongRepository implements SongRepository {
  loadSession(): Session | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      return parsed.version === 1 && parsed.song?.arrangement?.length ? parsed : null;
    } catch {
      return null;
    }
  }

  saveSession(session: Session): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      // Armazenamento indisponível (modo privado, cota): segue sem persistir.
    }
  }

  listSongs(): SavedSongMeta[] {
    return Object.values(readSongs())
      .map(({ song: _song, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  loadSong(id: string): SavedSong | null {
    return readSongs()[id] ?? null;
  }

  saveSong(song: SavedSong): void {
    writeSongs({ ...readSongs(), [song.id]: song });
  }

  deleteSong(id: string): void {
    const songs = readSongs();
    delete songs[id];
    writeSongs(songs);
  }
}

/** Repositório em memória (testes, ou quando não há armazenamento). */
export class MemorySongRepository implements SongRepository {
  private session: Session | null = null;
  private songs = new Map<string, SavedSong>();
  loadSession() {
    return this.session;
  }
  saveSession(session: Session) {
    this.session = session;
  }
  listSongs() {
    return [...this.songs.values()].map(({ song: _song, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  loadSong(id: string) {
    return this.songs.get(id) ?? null;
  }
  saveSong(song: SavedSong) {
    this.songs.set(song.id, structuredClone(song));
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
