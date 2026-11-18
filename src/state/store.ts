// Estado da aplicação (Zustand). Ações de edição passam por `commit`, que guarda
// o histórico para desfazer/refazer.

import { create } from "zustand";
import { makeChord, newChordId, type Chord, type QualityId } from "../core/chords";
import { chordFits, scaleContext, tonicChord, type ScaleContext } from "../core/diatonic";
import { toggleModifier, type Modifier } from "../core/modifiers";
import { mod12, type AccidentalPref, type PitchClass } from "../core/pitch";
import { getScale } from "../core/scales";
import { makeBlock, makeSong, newId, type Block, type PlaybackPattern, type Song } from "../core/song";
import { buildTemplate, type TemplateId } from "../core/templates";
import type { Grid, Meter } from "../core/timeline";
import { suggestionsFor } from "../audio/scaleInstruments";
import { DEFAULT_MIDI, type MidiSettings } from "../audio/midi";
import { sanitizeContent, type SongContent } from "../export/json";
import { repository, type RestrictionMode, type SavedSongMeta, type Session, type Theme } from "./repository";

export type Playhead = { itemIndex: number; chordIndex: number; eventIndex: number } | null;

export type PlayScope = "song" | "block" | "region";

export const UNTITLED = "Sem título";

/** JSON com chaves ordenadas: o mesmo conteúdo dá o mesmo texto, seja qual for a ordem de criação dos campos. */
const stableStringify = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/** Conteúdo que conta como "a música" para salvar e detectar alterações. */
export const contentHash = (s: { song: Song; scaleId: string; tonic: number | null }) =>
  stableStringify([s.scaleId, s.tonic, s.song]);

/**
 * Reescreve um hash guardado (o próprio conteúdo em JSON) na forma canônica atual, passando pelo mesmo
 * saneamento do carregamento — sem isso, reabrir o app acusaria "alterações não salvas" falsas.
 */
export function normalizeHash(hash: string | null): string | null {
  if (hash === null) return null;
  try {
    const [scaleId, tonic, song] = JSON.parse(hash) as unknown[];
    const content = sanitizeContent({ scaleId, tonic, song });
    return content ? contentHash(content) : hash;
  } catch {
    return hash;
  }
}

/** Estado restaurado por desfazer/refazer: a tonalidade acompanha a música. */
type Snapshot = { song: Song; tonic: number | null; scaleId: string };

type State = Omit<Session, "version" | "songId" | "songName" | "savedHash" | "midi" | "countIn" | "grid" | "showDegrees" | "soundOnHover" | "theme"> & {
  theme: Theme;
  midi: MidiSettings;
  countIn: boolean;
  grid: Grid;
  showDegrees: boolean;
  soundOnHover: boolean;
  /** Outra ponta da região selecionada (id de acorde do bloco atual); a primeira é `selectedChord`. */
  regionEnd: string | null;
  songId: string | null;
  songName: string;
  savedHash: string | null;
  savedSongs: SavedSongMeta[];
  selectedItem: number;
  selectedChord: string | null;
  past: Snapshot[];
  future: Snapshot[];
  playing: boolean;
  loop: boolean;
  playScope: PlayScope;
  playhead: Playhead;
  /** Durante a reprodução, a progressão acompanha o bloco que está tocando. */
  followPlayback: boolean;
};

type Actions = {
  setScale: (id: string) => void;
  setTonic: (pc: PitchClass) => void;
  /** Troca escala e tônica juntas sem transpor (modos relativos). */
  setKey: (tonic: PitchClass, scaleId: string) => void;
  setAccidentals: (a: AccidentalPref) => void;
  setMode: (m: RestrictionMode) => void;
  setStartWithSelected: (v: boolean) => void;
  setSoundOnClick: (v: boolean) => void;
  setMetronome: (v: boolean) => void;
  setFollowScale: (v: boolean) => void;
  setCountIn: (v: boolean) => void;
  setGrid: (g: Grid) => void;
  setShowDegrees: (v: boolean) => void;
  setSoundOnHover: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  /** Estende a seleção até este acorde do bloco atual (null desfaz a região). */
  setRegionEnd: (id: string | null) => void;
  setLoop: (v: boolean) => void;
  setPlayScope: (s: PlayScope) => void;
  setPlaying: (p: boolean) => void;
  setPlayhead: (p: Playhead) => void;
  setFollowPlayback: (v: boolean) => void;
  setMidi: (patch: Partial<MidiSettings>) => void;

  addChord: (root: PitchClass, quality: QualityId) => Chord | null;
  selectChord: (id: string | null) => void;
  removeChord: (id: string) => void;
  duplicateChord: (id: string) => void;
  moveChord: (from: number, to: number) => void;
  setDuration: (id: string, beats: number) => void;
  toggleMod: (id: string, m: Modifier) => void;
  setBass: (id: string, bass: PitchClass | undefined) => void;
  setOctave: (id: string, octave: number) => void;
  clearBlock: () => void;
  completeBar: () => void;
  applyPreset: (p: "jazzify" | "add9" | "susDominants" | "clear") => void;

  selectItem: (i: number) => void;
  addBlock: () => void;
  addLinkedInstance: (i: number) => void;
  makeUnique: (i: number) => void;
  removeItem: (i: number) => void;
  moveItem: (from: number, to: number) => void;
  setRepeat: (i: number, n: number) => void;
  renameBlock: (blockId: string, name: string) => void;
  setBlockProps: (blockId: string, patch: Partial<Pick<Block, "bpm" | "meter" | "pattern" | "instrument" | "midiChannel" | "color">>) => void;
  applyTemplate: (id: TemplateId) => void;

  setBpm: (bpm: number) => void;
  setMeter: (m: Meter) => void;
  setSwing: (s: number) => void;
  setInstrument: (id: string) => void;
  setPattern: (p: PlaybackPattern) => void;

  undo: () => void;
  redo: () => void;

  /** Salva a música atual (cria uma nova entrada se ainda não foi salva). */
  saveSong: () => boolean;
  /** Salva uma cópia com outro nome e passa a editar a cópia. */
  saveCopy: (name: string) => boolean;
  renameSong: (name: string) => void;
  newSong: () => void;
  openSong: (id: string) => boolean;
  /** Carrega conteúdo externo (arquivo/link) como música nova, ainda não salva. */
  loadExternal: (file: SongContent & { name: string }) => void;
  deleteSong: (id: string) => void;
};

export type Store = State & Actions;

const HISTORY_LIMIT = 100;

function initialState(): State {
  const saved = repository.loadSession();
  const base: Omit<Session, "version"> = saved ?? {
    scaleId: "major",
    tonic: null,
    accidentals: "auto",
    mode: "colorful",
    startWithSelected: false,
    soundOnClick: true,
    metronome: false,
    followScale: false,
    countIn: false,
    song: makeSong(),
  };
  const { songId = null, songName = UNTITLED, savedHash, midi, countIn = false, grid = 1, showDegrees = true, soundOnHover = false, theme = "auto", ...rest } = base;
  return {
    ...rest,
    theme,
    countIn,
    grid,
    showDegrees,
    soundOnHover,
    regionEnd: null,
    // A permissão de MIDI é pedida de novo a cada sessão: começa desligado.
    midi: { ...DEFAULT_MIDI, ...midi, enabled: false },
    songId,
    songName,
    // Sessão antiga sem hash: considera o estado atual como "salvo" para não acusar alteração falsa.
    savedHash: savedHash === undefined ? contentHash(base) : normalizeHash(savedHash),
    savedSongs: repository.listSongs(),
    selectedItem: 0,
    selectedChord: null,
    past: [],
    future: [],
    playing: false,
    loop: false,
    followPlayback: true,
    playScope: "song",
    playhead: null,
  };
}

// ——— Seletores puros ————————————————————————————————————————————————

export const selectCtx = (s: Pick<State, "tonic" | "scaleId">): ScaleContext | null =>
  s.tonic === null ? null : scaleContext(s.tonic, s.scaleId);

export const selectBlock = (s: Pick<State, "song" | "selectedItem">): Block | null => {
  const item = s.song.arrangement[s.selectedItem] ?? s.song.arrangement[0];
  return item ? s.song.blocks[item.blockId] ?? null : null;
};

export const selectChord = (s: State): Chord | null =>
  selectBlock(s)?.chords.find((c) => c.id === s.selectedChord) ?? null;

/** Região selecionada no bloco atual: índices (inclusivos, em ordem) dos acordes, ou null se não houver. */
export function selectRegion(s: Pick<State, "song" | "selectedItem" | "selectedChord" | "regionEnd">): { from: number; to: number } | null {
  const chords = selectBlock(s)?.chords;
  if (!chords || s.selectedChord === null || s.regionEnd === null) return null;
  const a = chords.findIndex((c) => c.id === s.selectedChord);
  const b = chords.findIndex((c) => c.id === s.regionEnd);
  return a < 0 || b < 0 || a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) };
}

// ——— Helpers ————————————————————————————————————————————————————————

function tonicChordFor(s: Pick<State, "tonic" | "scaleId" | "song">, block: Block): Chord | null {
  if (s.tonic === null) return null;
  const q = tonicChord(scaleContext(s.tonic, s.scaleId));
  return q ? makeChord(s.tonic, q, (block.meter ?? s.song.meter)[0]) : null;
}

function cloneBlock(b: Block, name: string): Block {
  return { ...structuredClone(b), id: newId("b"), name, chords: b.chords.map((c) => ({ ...structuredClone(c), id: newChordId() })) };
}

/** Ajusta a seleção ao restaurar uma música: bloco existente e acorde ainda presente. */
function fixSelection(s: State, song: Song): Pick<State, "selectedItem" | "selectedChord" | "regionEnd"> {
  const selectedItem = Math.max(0, Math.min(s.selectedItem, song.arrangement.length - 1));
  const block = selectBlock({ song, selectedItem });
  const keep = s.selectedChord !== null && !!block?.chords.some((c) => c.id === s.selectedChord);
  return { selectedItem, selectedChord: keep ? s.selectedChord : null, regionEnd: null };
}

export const useStore = create<Store>()((set, get) => {
  /** Aplica uma edição à música guardando o estado anterior no histórico. */
  const commit = (fn: (song: Song, s: State) => void, extra: Partial<State> = {}) => {
    const s = get();
    const next = structuredClone(s.song);
    fn(next, s);
    const prev: Snapshot = { song: s.song, tonic: s.tonic, scaleId: s.scaleId };
    // Uma edição que muda o acorde selecionado desfaz a região (ela parte da seleção).
    set({ song: next, past: [...s.past, prev].slice(-HISTORY_LIMIT), future: [], ...extra, ...("selectedChord" in extra ? { regionEnd: null } : {}) });
  };

  const currentBlock = (song: Song, s: State): Block | null => {
    const item = song.arrangement[s.selectedItem] ?? song.arrangement[0];
    return item ? song.blocks[item.blockId] ?? null : null;
  };

  const editChord = (id: string, fn: (c: Chord) => void) =>
    commit((song, s) => {
      const c = currentBlock(song, s)?.chords.find((x) => x.id === id);
      if (c) fn(c);
    });

  return {
    ...initialState(),

    setScale: (scaleId) => {
      if (get().scaleId === scaleId) return;
      const follow = get().followScale;
      const first = follow ? suggestionsFor(getScale(scaleId)).instruments[0] : undefined;
      commit((song) => void (first && (song.instrument = first)), { scaleId });
    },

    setTonic: (pc) => {
      const s = get();
      if (s.tonic === pc) return;
      if (s.tonic !== null) {
        // Transpor: a progressão inteira acompanha, mantendo os graus.
        const delta = pc - s.tonic;
        commit(
          (song) => {
            for (const b of Object.values(song.blocks))
              for (const c of b.chords) {
                c.root = mod12(c.root + delta);
                if (c.bass !== undefined) c.bass = mod12(c.bass + delta);
              }
          },
          { tonic: pc },
        );
        return;
      }
      // Primeira definição: um único commit (tônica + acorde da tônica, se for o caso).
      const block = selectBlock(s);
      const chord = block && !block.chords.length && !s.startWithSelected ? tonicChordFor({ ...s, tonic: pc }, block) : null;
      commit(
        (song, st) => {
          if (chord) currentBlock(song, st)!.chords.push(chord);
        },
        { tonic: pc, ...(chord ? { selectedChord: chord.id } : {}) },
      );
    },

    setKey: (tonic, scaleId) => {
      const s = get();
      if (s.tonic === tonic && s.scaleId === scaleId) return;
      commit(() => {}, { tonic, scaleId });
    },
    setAccidentals: (accidentals) => set({ accidentals }),
    setMode: (mode) => set({ mode }),
    setStartWithSelected: (startWithSelected) => set({ startWithSelected }),
    setSoundOnClick: (soundOnClick) => set({ soundOnClick }),
    setMetronome: (metronome) => set({ metronome }),
    setFollowScale: (followScale) => set({ followScale }),
    setCountIn: (countIn) => set({ countIn }),
    setGrid: (grid) => set({ grid }),
    setShowDegrees: (showDegrees) => set({ showDegrees }),
    setSoundOnHover: (soundOnHover) => set({ soundOnHover }),
    setTheme: (theme) => set({ theme }),
    setRegionEnd: (regionEnd) => set({ regionEnd }),
    setLoop: (loop) => set({ loop }),
    setPlayScope: (playScope) => set({ playScope }),
    setPlaying: (playing) => set(playing ? { playing } : { playing, playhead: null }),
    setPlayhead: (playhead) => {
      const s = get();
      if (!playhead || !s.followPlayback || playhead.itemIndex === s.selectedItem) return set({ playhead });
      // Muda o bloco exibido; mantém a seleção só se o acorde existir no novo bloco.
      const item = s.song.arrangement[playhead.itemIndex];
      const keep = item && s.song.blocks[item.blockId]?.chords.some((c) => c.id === s.selectedChord);
      set({ playhead, selectedItem: playhead.itemIndex, selectedChord: keep ? s.selectedChord : null, regionEnd: null });
    },
    setFollowPlayback: (followPlayback) => set({ followPlayback }),
    setMidi: (patch) => set({ midi: { ...get().midi, ...patch } }),

    addChord: (root, quality) => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return null;
      const chord = makeChord(root, quality, (block.meter ?? s.song.meter)[0]);
      commit(
        (song, st) => {
          const b = currentBlock(song, st)!;
          const at = b.chords.findIndex((c) => c.id === st.selectedChord);
          b.chords.splice(at >= 0 ? at + 1 : b.chords.length, 0, chord);
        },
        { selectedChord: chord.id },
      );
      return chord;
    },

    selectChord: (selectedChord) => set({ selectedChord, regionEnd: null }),

    removeChord: (id) =>
      commit(
        (song, s) => {
          const b = currentBlock(song, s);
          if (b) b.chords = b.chords.filter((c) => c.id !== id);
        },
        get().selectedChord === id ? { selectedChord: null } : {},
      ),

    duplicateChord: (id) => {
      const copyId = newChordId();
      commit(
        (song, s) => {
          const b = currentBlock(song, s);
          const i = b?.chords.findIndex((c) => c.id === id) ?? -1;
          if (b && i >= 0) b.chords.splice(i + 1, 0, { ...structuredClone(b.chords[i]), id: copyId });
        },
        { selectedChord: copyId },
      );
    },

    moveChord: (from, to) =>
      commit((song, s) => {
        const b = currentBlock(song, s);
        if (!b || from === to) return;
        const [c] = b.chords.splice(from, 1);
        b.chords.splice(to, 0, c);
      }),

    setDuration: (id, beats) => editChord(id, (c) => void (c.duration = Math.max(0.5, beats))),
    toggleMod: (id, m) => editChord(id, (c) => void (c.modifiers = toggleModifier(c.modifiers, m))),
    setBass: (id, bass) =>
      editChord(id, (c) => {
        if (bass === undefined || mod12(bass) === c.root) delete c.bass;
        else c.bass = mod12(bass);
      }),
    setOctave: (id, octave) => editChord(id, (c) => void (c.octave = Math.max(-2, Math.min(2, octave)))),

    clearBlock: () => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return;
      const chord = s.startWithSelected ? null : tonicChordFor(s, block);
      commit((song, st) => void (currentBlock(song, st)!.chords = chord ? [chord] : []), { selectedChord: chord?.id ?? null });
    },

    completeBar: () =>
      commit((song, s) => {
        const b = currentBlock(song, s);
        if (!b?.chords.length) return;
        const per = (b.meter ?? song.meter)[0];
        const total = b.chords.reduce((n, c) => n + c.duration, 0);
        const rest = total % per;
        if (rest) b.chords[b.chords.length - 1].duration += per - rest;
      }),

    applyPreset: (preset) =>
      commit((song, s) => {
        const b = currentBlock(song, s);
        const ctx = selectCtx(s);
        if (!b) return;
        for (const c of b.chords) {
          const has = (iv: number) => (ctx ? ctx.pcSet.has(mod12(c.root + iv)) : true);
          const exts = c.modifiers.filter((m) => m.kind === "ext");
          const hasSeventh = exts.some((m) => m.value === 7 || m.value === "maj7");
          if (preset === "clear") c.modifiers = [];
          else if (preset === "jazzify") {
            if (hasSeventh) continue;
            const ext: Modifier | null =
              c.quality === "dim" && !has(10) && has(9)
                ? { kind: "ext", value: 6 }
                : c.quality !== "aug" && has(11) && c.quality !== "dim"
                  ? { kind: "ext", value: "maj7" }
                  : has(10)
                    ? { kind: "ext", value: 7 }
                    : has(11)
                      ? { kind: "ext", value: "maj7" }
                      : null;
            if (ext) c.modifiers = toggleModifier(c.modifiers, ext);
          } else if (preset === "add9") {
            const m: Modifier = hasSeventh ? { kind: "ext", value: 9 } : { kind: "add", value: 9 };
            if (!c.modifiers.some((x) => x.kind === m.kind && x.value === m.value)) c.modifiers = toggleModifier(c.modifiers, m);
          } else if (preset === "susDominants") {
            const dominant = c.quality === "maj" && exts.some((m) => m.value === 7);
            if (dominant && !c.modifiers.some((m) => m.kind === "sus")) c.modifiers = toggleModifier(c.modifiers, { kind: "sus", value: 4 });
          }
        }
      }),

    selectItem: (selectedItem) => set({ selectedItem, selectedChord: null, regionEnd: null }),

    addBlock: () => {
      const s = get();
      const block = makeBlock(`Bloco ${Object.keys(s.song.blocks).length + 1}`, Object.keys(s.song.blocks).length);
      const chord = s.startWithSelected ? null : tonicChordFor(s, block);
      if (chord) block.chords.push(chord);
      commit(
        (song) => {
          song.blocks[block.id] = block;
          song.arrangement.push({ id: newId("i"), blockId: block.id, repeat: 1 });
        },
        { selectedItem: s.song.arrangement.length, selectedChord: chord?.id ?? null },
      );
    },

    addLinkedInstance: (i) =>
      commit(
        (song) => {
          const item = song.arrangement[i];
          if (item) song.arrangement.splice(i + 1, 0, { id: newId("i"), blockId: item.blockId, repeat: item.repeat });
        },
        { selectedItem: i + 1 },
      ),

    makeUnique: (i) =>
      commit((song) => {
        const item = song.arrangement[i];
        const block = item && song.blocks[item.blockId];
        if (!block) return;
        const copy = cloneBlock(block, `${block.name} (cópia)`);
        song.blocks[copy.id] = copy;
        item.blockId = copy.id;
      }),

    removeItem: (i) => {
      const s = get();
      if (s.song.arrangement.length <= 1) return;
      commit(
        (song) => {
          const [removed] = song.arrangement.splice(i, 1);
          if (!song.arrangement.some((it) => it.blockId === removed.blockId)) delete song.blocks[removed.blockId];
        },
        { selectedItem: Math.max(0, Math.min(s.selectedItem, s.song.arrangement.length - 2)), selectedChord: null },
      );
    },

    moveItem: (from, to) =>
      commit(
        (song) => {
          if (from === to) return;
          const [it] = song.arrangement.splice(from, 1);
          song.arrangement.splice(to, 0, it);
        },
        { selectedItem: to },
      ),

    setRepeat: (i, n) => commit((song) => void (song.arrangement[i] && (song.arrangement[i].repeat = Math.max(1, Math.min(16, n))))),
    renameBlock: (blockId, name) => commit((song) => void (song.blocks[blockId] && (song.blocks[blockId].name = name || "Bloco"))),
    setBlockProps: (blockId, patch) =>
      commit((song) => {
        const b = song.blocks[blockId];
        if (!b) return;
        for (const [k, v] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
          let value = v;
          if (k === "bpm" || k === "midiChannel") {
            const [lo, hi] = k === "bpm" ? [30, 300] : [1, 16];
            value = typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined;
          }
          if (k === "color") value = typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : b.color;
          if (value === undefined) delete b[k];
          else Object.assign(b, { [k]: value });
        }
      }),

    applyTemplate: (id) => {
      const s = get();
      const tonic = s.tonic ?? 0;
      const { blocks, arrangement } = buildTemplate(id, scaleContext(tonic, s.scaleId), s.song.meter[0]);
      commit(
        (song) => {
          song.blocks = Object.fromEntries(blocks.map((b) => [b.id, b]));
          song.arrangement = arrangement;
        },
        { selectedItem: 0, selectedChord: null, tonic },
      );
    },

    setBpm: (bpm) => commit((song) => void (song.bpm = Math.max(30, Math.min(300, Math.round(bpm))))),
    setMeter: (meter) => commit((song) => void (song.meter = meter)),
    setSwing: (swing) => commit((song) => void (song.swing = Math.max(0, Math.min(75, swing)))),
    setInstrument: (id) => commit((song) => void (song.instrument = id)),
    setPattern: (p) => commit((song) => void (song.pattern = p)),

    saveSong: () => {
      const s = get();
      const id = s.songId ?? newId("s");
      const name = s.songName.trim() || UNTITLED;
      if (!repository.saveSong({ id, name, updatedAt: Date.now(), scaleId: s.scaleId, tonic: s.tonic, song: s.song })) return false;
      set({ songId: id, songName: name, savedHash: contentHash(s), savedSongs: repository.listSongs() });
      return true;
    },

    saveCopy: (name) => {
      const { songId, songName } = get();
      set({ songId: null, songName: name.trim() || `${songName} (cópia)` });
      const ok = get().saveSong();
      if (!ok) set({ songId, songName });
      return ok;
    },

    renameSong: (songName) => {
      set({ songName });
      const s = get();
      // Renomear uma música já salva atualiza só o nome na lista, sem salvar o conteúdo.
      const stored = s.songId ? repository.loadSong(s.songId) : null;
      if (stored && songName.trim()) {
        repository.saveSong({ ...stored, name: songName.trim() });
        set({ savedSongs: repository.listSongs() });
      }
    },

    newSong: () => {
      const song = makeSong();
      const fresh = { song, scaleId: "major", tonic: null };
      set({
        ...fresh,
        songId: null,
        songName: UNTITLED,
        savedHash: contentHash(fresh),
        selectedItem: 0,
        selectedChord: null,
        regionEnd: null,
        past: [],
        future: [],
        playhead: null,
      });
    },

    openSong: (id) => {
      const stored = repository.loadSong(id);
      if (!stored) return false;
      set({
        song: stored.song,
        scaleId: stored.scaleId,
        tonic: stored.tonic,
        songId: stored.id,
        songName: stored.name,
        savedHash: contentHash(stored),
        selectedItem: 0,
        selectedChord: null,
        regionEnd: null,
        past: [],
        future: [],
        playhead: null,
      });
      return true;
    },

    loadExternal: (file) => {
      // Campos explícitos: `file` pode ser um SongFile (com `format`/`version`), que não pertencem ao estado.
      const { name, scaleId, tonic, song } = structuredClone(file);
      set({
        scaleId,
        tonic,
        song,
        songId: null,
        songName: name,
        savedHash: null,
        selectedItem: 0,
        selectedChord: null,
        regionEnd: null,
        past: [],
        future: [],
        playhead: null,
      });
    },

    deleteSong: (id) => {
      repository.deleteSong(id);
      const s = get();
      // Apagar a música aberta: o conteúdo continua na tela, mas deixa de estar salvo.
      set({ savedSongs: repository.listSongs(), ...(s.songId === id ? { songId: null, savedHash: null } : {}) });
    },

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        ...prev,
        past: s.past.slice(0, -1),
        future: [{ song: s.song, tonic: s.tonic, scaleId: s.scaleId }, ...s.future],
        ...fixSelection(s, prev.song),
      });
    },
    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({
        ...next,
        future: s.future.slice(1),
        past: [...s.past, { song: s.song, tonic: s.tonic, scaleId: s.scaleId }],
        ...fixSelection(s, next.song),
      });
    },
  };
});

// Persistência: salva a sessão (debounce) sempre que algo relevante muda.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSessionOk = true;

function buildSession(s: State): Session {
  return {
    version: 1,
    scaleId: s.scaleId,
    tonic: s.tonic,
    accidentals: s.accidentals,
    mode: s.mode,
    startWithSelected: s.startWithSelected,
    soundOnClick: s.soundOnClick,
    metronome: s.metronome,
    followScale: s.followScale,
    countIn: s.countIn,
    grid: s.grid,
    showDegrees: s.showDegrees,
    soundOnHover: s.soundOnHover,
    theme: s.theme,
    midi: s.midi,
    song: s.song,
    songId: s.songId,
    songName: s.songName,
    savedHash: s.savedHash,
  };
}

let sessionDiscarded = false;

/** Grava a sessão agora, cancelando o debounce pendente. */
export function flushSession(): void {
  clearTimeout(saveTimer);
  if (sessionDiscarded) return;
  lastSessionOk = repository.saveSession(buildSession(useStore.getState()));
}

/** Apaga a sessão guardada e para de gravá-la (recuperação de erro; segue-se um recarregamento). */
export function discardSession(): void {
  sessionDiscarded = true;
  clearTimeout(saveTimer);
  repository.clearSession();
}

/** A sessão não está sendo persistida e há conteúdo não salvo (risco de perda). */
export function sessionAtRisk(): boolean {
  return !sessionDiscarded && (!lastSessionOk || !repository.persistent) && selectDirty(useStore.getState());
}

// O escopo "Região" sem região selecionada vira "Bloco" (senão o botão fica marcado e desabilitado).
useStore.subscribe((s) => {
  if (s.playScope === "region" && !selectRegion(s)) useStore.setState({ playScope: "block" });
});

useStore.subscribe(() => {
  clearTimeout(saveTimer);
  if (!sessionDiscarded) saveTimer = setTimeout(flushSession, 300);
});

/** O acorde cabe na escala atual? (sem tônica, tudo cabe) */
export function chordInScale(s: Pick<State, "tonic" | "scaleId">, c: Pick<Chord, "root" | "quality">): boolean {
  const ctx = selectCtx(s);
  return !ctx || chordFits(c.root, c.quality, ctx.pcSet);
}

/** Há alterações desde o último salvamento (ou desde "Novo")? */
export const selectDirty = (s: Pick<State, "song" | "scaleId" | "tonic" | "savedHash">) => contentHash(s) !== s.savedHash;
