// Estado da aplicação (Zustand). Ações de edição passam por `commit`, que guarda
// o histórico para desfazer/refazer.

import { create } from "zustand";
import { DEFAULT_MIXER, type MixerState, type TrackBus, type TrackMix } from "../audio/status";
import { isRest, makeChord, makeRest, newChordId, type Chord, type QualityId, type VoicingId } from "../core/chords";
import { hasInstrument } from "../audio/instruments";
import { chordFits, scaleContext, tonicChord, type ScaleContext } from "../core/diatonic";
import {
  makeMelodyNote,
  newMelodyNoteId,
  shortestTransposeDelta,
  snapMelodyToScale,
  transposeMelody,
  upsertMelodyNote as upsertMelodyList,
  type MelodyNote,
} from "../core/melody";
import { toggleModifier, type Modifier } from "../core/modifiers";
import { mod12, type AccidentalPref, type PitchClass } from "../core/pitch";
import { getScale, SCALES } from "../core/scales";
import { makeBlock, makeSong, newId, type Block, type InstrumentId, type PlaybackPattern, type Song } from "../core/song";
import { buildTemplate, type TemplateId } from "../core/templates";
import { gridBeats, type Grid, type Meter } from "../core/timeline";
import { suggestionsFor } from "../audio/scaleInstruments";
import { DEFAULT_MIDI, type MidiSettings } from "../audio/midi";
import { sanitizeContent, type SongContent } from "../export/json";
import { CURRENT_VERSION } from "../export/migrate";
import {
  DEFAULT_DOCK_PANELS,
  repository,
  type DockMode,
  type DockPanels,
  type RestrictionMode,
  type SavedSongMeta,
  type Session,
  type Theme,
  type TopBarMode,
} from "./repository";

export { DEFAULT_DOCK_PANELS, DEFAULT_MIXER, type DockPanels, type MixerState, type TrackBus, type TrackMix };

export type Playhead = { itemIndex: number; chordIndex: number; eventIndex: number } | null;

const SCALE_IDS = new Set(SCALES.map((s) => s.id));
const hasScale = (id: unknown): id is string => typeof id === "string" && SCALE_IDS.has(id);

export type PlayScope = "song" | "block" | "region";

export const UNTITLED = "Sem título";

/** JSON com chaves ordenadas: o mesmo conteúdo dá o mesmo texto, seja qual for a ordem de criação dos campos. */
const stableStringify = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

const stripIds = <T extends { id: string }>(arr?: T[]) => arr?.map(({ id: _id, ...rest }) => rest);

/** Conteúdo que conta como "a música" para salvar e detectar alterações. Ids de acorde, nota e de item não entram (só os de bloco). */
export const contentHash = (s: { song: Song; scaleId: string; tonic: number | null }) =>
  stableStringify([
    s.scaleId,
    s.tonic,
    {
      ...s.song,
      blocks: Object.fromEntries(
        Object.entries(s.song.blocks).map(([k, b]) => [
          k,
          {
            ...b,
            chords: stripIds(b.chords),
            ...(b.ending ? { ending: stripIds(b.ending) } : {}),
            ...(b.melody ? { melody: stripIds(b.melody) } : {}),
            ...(b.melodyEnding ? { melodyEnding: stripIds(b.melodyEnding) } : {}),
          },
        ]),
      ),
      arrangement: s.song.arrangement.map(({ id: _id, ...it }) => it),
    },
  ]);

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

type State = Omit<
  Session,
  | "version"
  | "songId"
  | "songName"
  | "savedHash"
  | "midi"
  | "countIn"
  | "grid"
  | "melodyGrid"
  | "melodyVisible"
  | "mixer"
  | "showDegrees"
  | "soundOnHover"
  | "instrumentView"
  | "theme"
  | "topBar"
  | "dock"
  | "dockPanels"
  | "melodyCompact"
  | "timelineFit"
> & {
  theme: Theme;
  midi: MidiSettings;
  countIn: boolean;
  grid: Grid;
  melodyGrid: Grid;
  melodyVisible: boolean;
  melodyCompact: boolean;
  timelineFit: boolean;
  mixer: MixerState;
  showDegrees: boolean;
  soundOnHover: boolean;
  instrumentView: "keyboard" | "guitar";
  topBar: TopBarMode;
  dock: DockMode;
  dockPanels: DockPanels;
  /** Outra ponta da região selecionada (id de acorde do bloco atual); a primeira é `selectedChord`. */
  regionEnd: string | null;
  /** A progressão edita a casa 2 do bloco (`block.ending` / `block.melodyEnding`) em vez do conteúdo principal. */
  editEnding: boolean;
  songId: string | null;
  songName: string;
  savedHash: string | null;
  savedSongs: SavedSongMeta[];
  selectedItem: number;
  selectedChord: string | null;
  selectedMelodyNote: string | null;
  past: Snapshot[];
  future: Snapshot[];
  playing: boolean;
  loop: boolean;
  playScope: PlayScope;
  playhead: Playhead;
  /** Durante a reprodução, a progressão acompanha o bloco que está tocando. */
  followPlayback: boolean;
};

export type ChordOrRestInput =
  | Chord
  | { rest: true; duration?: number }
  | { root: PitchClass; quality: QualityId; modifiers?: Modifier[]; bass?: PitchClass; duration?: number };

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
  setMelodyGrid: (g: Grid) => void;
  setMelodyVisible: (v: boolean) => void;
  setMelodyCompact: (v: boolean) => void;
  setTimelineFit: (v: boolean) => void;
  setDockPanel: (panel: keyof DockPanels, expanded: boolean) => void;
  toggleDockPanel: (panel: keyof DockPanels) => void;
  selectMelodyNote: (id: string | null) => void;
  setTrackMix: (track: TrackBus, patch: Partial<TrackMix>) => void;
  setShowDegrees: (v: boolean) => void;
  setSoundOnHover: (v: boolean) => void;
  setInstrumentView: (v: "keyboard" | "guitar") => void;
  setTopBar: (v: TopBarMode) => void;
  setDock: (v: DockMode) => void;
  setTheme: (t: Theme) => void;
  /** Estende a seleção até este acorde do bloco atual (null desfaz a região). */
  setRegionEnd: (id: string | null) => void;
  /** Alterna a edição entre os acordes do bloco e a casa 2. */
  setEditEnding: (v: boolean) => void;
  /** Remove a casa 2 do bloco selecionado. */
  clearEnding: () => void;
  setLoop: (v: boolean) => void;
  setPlayScope: (s: PlayScope) => void;
  setPlaying: (p: boolean) => void;
  setPlayhead: (p: Playhead) => void;
  setFollowPlayback: (v: boolean) => void;
  setMidi: (patch: Partial<MidiSettings>) => void;

  /** `modifiers` já entram no acorde criado (um único passo de desfazer). */
  /** `bass`: baixo invertido/slash (ex.: acorde tocado no teclado MIDI). */
  addChord: (root: PitchClass, quality: QualityId, modifiers?: Modifier[], bass?: PitchClass, duration?: number) => Chord | null;
  addRest: (duration?: number) => Chord | null;
  insertChordAtBeat: (beat: number, chordOrRest: ChordOrRestInput) => Chord | null;
  toggleRest: (id: string) => void;
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

  upsertMelodyNote: (note: Omit<MelodyNote, "id"> & { id?: string }) => MelodyNote | null;
  updateMelodyNote: (id: string, patch: Partial<Pick<MelodyNote, "pitch" | "start" | "duration" | "velocity">>) => void;
  removeMelodyNote: (id: string) => void;
  clearMelody: () => void;
  snapBlockMelodyToScale: () => void;
  setBlockChords: (chords: Chord[]) => void;
  applyAIGeneration: (patch: {
    chords?: Chord[];
    melody?: MelodyNote[];
    bassInstrument?: InstrumentId;
    tonic?: PitchClass;
    scaleId?: string;
  }) => void;

  selectItem: (i: number) => void;
  addBlock: () => void;
  addLinkedInstance: (i: number) => void;
  makeUnique: (i: number) => void;
  removeItem: (i: number) => void;
  moveItem: (from: number, to: number) => void;
  setRepeat: (i: number, n: number) => void;
  renameBlock: (blockId: string, name: string) => void;
  setBlockProps: (
    blockId: string,
    patch: Partial<
      Pick<
        Block,
        | "bpm"
        | "meter"
        | "pattern"
        | "instrument"
        | "melodyInstrument"
        | "melodyMidiChannel"
        | "midiChannel"
        | "color"
        | "bassInstrument"
        | "drone"
        | "rampTo"
        | "key"
      >
    >,
  ) => void;
  /** Preferências de execução da música inteira. */
  setSongProps: (patch: Partial<Pick<Song, "voiceLeading" | "reattack">>) => void;
  setVoicing: (id: string, voicing: VoicingId | undefined) => void;
  applyTemplate: (id: TemplateId) => void;

  setBpm: (bpm: number) => void;
  setMeter: (m: Meter) => void;
  setSwing: (s: number) => void;
  setInstrument: (id: string) => void;
  setMelodyInstrument: (id: string) => void;
  setPattern: (p: PlaybackPattern) => void;

  undo: () => void;
  redo: () => void;

  /** Salva a música atual (cria uma nova entrada se ainda não foi salva). */
  saveSong: () => boolean;
  /** Salva uma cópia com outro nome e passa a editar a cópia. */
  saveCopy: (name: string) => boolean;
  /** Devolve false se a gravação do nome falhou (o nome na tela fica). */
  renameSong: (name: string) => boolean;
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
  const {
    songId = null,
    songName = UNTITLED,
    savedHash,
    midi,
    countIn = false,
    grid = "bar",
    melodyGrid = 0.5,
    melodyVisible = true,
    melodyCompact = false,
    timelineFit = false,
    mixer = structuredClone(DEFAULT_MIXER),
    showDegrees = true,
    soundOnHover = false,
    instrumentView = "keyboard",
    theme = "auto",
    topBar = "pinned",
    dock = "full",
    dockPanels = { ...DEFAULT_DOCK_PANELS },
    ...rest
  } = base;
  return {
    ...rest,
    theme,
    countIn,
    grid,
    melodyGrid,
    melodyVisible,
    melodyCompact,
    timelineFit,
    mixer,
    showDegrees,
    soundOnHover,
    instrumentView,
    topBar,
    dock,
    dockPanels,
    regionEnd: null,
    editEnding: false,
    // Saída MIDI começa desligada a cada sessão. A entrada (teclado) continua ligada se estava: a permissão já foi
    // concedida num gesto antes; mas gravar na progressão volta desligado, para tocar não editar a música sem querer.
    midi: { ...DEFAULT_MIDI, ...midi, enabled: false, inputRecord: false },
    songId,
    songName,
    // Sessão antiga sem hash: considera o estado atual como "salvo" para não acusar alteração falsa.
    savedHash: savedHash === undefined ? contentHash(base) : normalizeHash(savedHash),
    savedSongs: repository.listSongs(),
    selectedItem: 0,
    selectedChord: null,
    selectedMelodyNote: null,
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

/** Tonalidade efetiva de um bloco (§3.8): a própria (modulação) ou a global. null = sem tônica. */
export function blockKey(s: Pick<State, "tonic" | "scaleId">, block: Pick<Block, "key"> | null | undefined): { tonic: number; scaleId: string } | null {
  if (block?.key) return block.key;
  return s.tonic === null ? null : { tonic: s.tonic, scaleId: s.scaleId };
}

/** Contexto de escala do bloco selecionado (considera a modulação do bloco). */
export function selectBlockCtx(s: Pick<State, "tonic" | "scaleId" | "song" | "selectedItem">): ScaleContext | null {
  const key = blockKey(s, selectBlock(s));
  return key ? scaleContext(key.tonic, key.scaleId) : null;
}

const NO_CHORDS: Chord[] = [];
const NO_MELODY: MelodyNote[] = [];

/** Acordes que a progressão está editando: os do bloco ou os da casa 2 (referência estável, segura em `useStore`). */
export function selectEditChords(s: Pick<State, "song" | "selectedItem" | "editEnding">): Chord[] {
  const block = selectBlock(s);
  if (!block) return NO_CHORDS;
  return s.editEnding ? (block.ending ?? NO_CHORDS) : block.chords;
}

/** Notas da melodia em edição: as do bloco ou as da casa 2 (referência estável, segura em `useStore`). */
export function selectEditMelody(s: Pick<State, "song" | "selectedItem" | "editEnding">): MelodyNote[] {
  const block = selectBlock(s);
  if (!block) return NO_MELODY;
  return s.editEnding ? (block.melodyEnding ?? NO_MELODY) : (block.melody ?? NO_MELODY);
}

export const selectBlock = (s: Pick<State, "song" | "selectedItem">): Block | null => {
  const item = s.song.arrangement[s.selectedItem] ?? s.song.arrangement[0];
  return item ? s.song.blocks[item.blockId] ?? null : null;
};

export const selectChord = (s: State): Chord | null => selectEditChords(s).find((c) => c.id === s.selectedChord) ?? null;

/** Região selecionada no bloco atual: índices (inclusivos, em ordem) dos acordes, ou null se não houver. */
export function selectRegion(s: Pick<State, "song" | "selectedItem" | "selectedChord" | "regionEnd"> & { editEnding?: boolean }): { from: number; to: number } | null {
  if (s.editEnding) return null;
  const chords = selectBlock(s)?.chords;
  if (!chords || s.selectedChord === null || s.regionEnd === null) return null;
  const a = chords.findIndex((c) => c.id === s.selectedChord);
  const b = chords.findIndex((c) => c.id === s.regionEnd);
  return a < 0 || b < 0 || a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) };
}

// ——— Helpers ————————————————————————————————————————————————————————

function tonicChordFor(s: Pick<State, "tonic" | "scaleId" | "song">, block: Block): Chord | null {
  const key = blockKey(s, block);
  if (!key) return null;
  const q = tonicChord(scaleContext(key.tonic, key.scaleId));
  return q ? makeChord(key.tonic, q, (block.meter ?? s.song.meter)[0]) : null;
}

function cloneBlock(b: Block, name: string): Block {
  const fresh = (list: Chord[]) => list.map((c) => ({ ...structuredClone(c), id: newChordId() }));
  const freshMelody = (list: MelodyNote[]) => list.map((m) => ({ ...structuredClone(m), id: newMelodyNoteId() }));
  return {
    ...structuredClone(b),
    id: newId("b"),
    name,
    chords: fresh(b.chords),
    ...(b.ending ? { ending: fresh(b.ending) } : {}),
    ...(b.melody ? { melody: freshMelody(b.melody) } : {}),
    ...(b.melodyEnding ? { melodyEnding: freshMelody(b.melodyEnding) } : {}),
  };
}

/** Ajusta a seleção ao restaurar uma música: bloco existente e acorde/nota ainda presentes; sai da casa 2 se o bloco mudou. */
function fixSelection(
  s: State,
  song: Song,
): Pick<State, "selectedItem" | "selectedChord" | "selectedMelodyNote" | "regionEnd" | "editEnding"> {
  const selectedItem = Math.max(0, Math.min(s.selectedItem, song.arrangement.length - 1));
  const block = selectBlock({ song, selectedItem });
  const editEnding = s.editEnding && block?.id === selectBlock(s)?.id;
  const list = editEnding ? (block?.ending ?? []) : (block?.chords ?? []);
  const keep = s.selectedChord !== null && list.some((c) => c.id === s.selectedChord);
  const melList = editEnding ? (block?.melodyEnding ?? []) : (block?.melody ?? []);
  const keepMel = s.selectedMelodyNote !== null && melList.some((m) => m.id === s.selectedMelodyNote);
  return {
    selectedItem,
    selectedChord: keep ? s.selectedChord : null,
    selectedMelodyNote: keepMel ? s.selectedMelodyNote : null,
    regionEnd: null,
    editEnding,
  };
}

export const useStore = create<Store>()((set, get) => {
  /** Aplica uma edição à música guardando o estado anterior no histórico. */
  /** Último commit coalescível: só vale enquanto `song` ainda for o estado que ele produziu (nada mexeu no meio). */
  let mark: { key: string; at: number; song: Song } | null = null;

  /**
   * Aplica uma edição à música guardando o estado anterior no histórico. Com `coalesce`, um commit da mesma chave
   * em menos de 1 s do que abriu a entrada substitui o estado sem empilhar outra (ex.: digitar "300" no BPM).
   */
  const commit = (fn: (song: Song, s: State) => void, extra: Partial<State> = {}, opts?: { coalesce?: string }) => {
    const s = get();
    const next = structuredClone(s.song);
    fn(next, s);
    const now = Date.now();
    const merge = !!opts?.coalesce && mark?.key === opts.coalesce && mark.song === s.song && now - mark.at < 1000 && s.past.length > 0;
    mark = opts?.coalesce ? { key: opts.coalesce, at: merge ? mark!.at : now, song: next } : null;
    const prev: Snapshot = { song: s.song, tonic: s.tonic, scaleId: s.scaleId };
    // Trocar o bloco selecionado sai do modo casa 2 (a menos que a ação diga outra coisa).
    const blockChanged =
      extra.selectedItem !== undefined &&
      (extra.selectedItem !== s.selectedItem || next.arrangement[extra.selectedItem]?.blockId !== currentBlock(s.song, s)?.id);
    // Uma edição que muda o acorde selecionado desfaz a região (ela parte da seleção).
    set({
      song: next,
      ...(merge ? {} : { past: [...s.past, prev].slice(-HISTORY_LIMIT) }),
      future: [],
      ...(blockChanged ? { editEnding: false } : {}),
      ...extra,
      ...("selectedChord" in extra ? { regionEnd: null } : {}),
    });
  };

  const currentBlock = (song: Song, s: State): Block | null => {
    const item = song.arrangement[s.selectedItem] ?? song.arrangement[0];
    return item ? song.blocks[item.blockId] ?? null : null;
  };

  /** Lista que as ações de edição alteram (acordes do bloco ou casa 2); `create` cria a casa 2 se faltar. */
  const editList = (song: Song, s: State, create = false): Chord[] | null => {
    const b = currentBlock(song, s);
    if (!b) return null;
    if (!s.editEnding) return b.chords;
    if (!b.ending && create) b.ending = [];
    return b.ending ?? null;
  };
  const editMelodyList = (song: Song, s: State, create = false): MelodyNote[] | null => {
    const b = currentBlock(song, s);
    if (!b) return null;
    if (s.editEnding) {
      if (!b.melodyEnding && create) b.melodyEnding = [];
      return b.melodyEnding ?? null;
    }
    if (!b.melody && create) b.melody = [];
    return b.melody ?? null;
  };
  /** Casa 2 vazia não é guardada. */
  const tidyEnding = (song: Song, s: State) => {
    const b = currentBlock(song, s);
    if (b?.ending && !b.ending.length) delete b.ending;
    if (b?.melodyEnding && !b.melodyEnding.length) delete b.melodyEnding;
    if (b?.melody && !b.melody.length) delete b.melody;
  };

  const editChord = (id: string, fn: (c: Chord) => void) =>
    commit((song, s) => {
      const c = editList(song, s)?.find((x) => x.id === id);
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
        // Transpor: a progressão e a melodia inteiras acompanham, mantendo os graus.
        const delta = pc - s.tonic;
        const melDelta = shortestTransposeDelta(s.tonic, pc);
        commit(
          (song) => {
            for (const b of Object.values(song.blocks)) {
              for (const c of [...b.chords, ...(b.ending ?? [])]) {
                if (isRest(c)) continue;
                c.root = mod12(c.root + delta);
                if (c.bass !== undefined) c.bass = mod12(c.bass + delta);
              }
              if (b.melody?.length) b.melody = transposeMelody(b.melody, melDelta);
              if (b.melodyEnding?.length) b.melodyEnding = transposeMelody(b.melodyEnding, melDelta);
              // Modulações acompanham: a relação entre as tonalidades se mantém.
              if (b.key) b.key = { ...b.key, tonic: mod12(b.key.tonic + delta) };
            }
          },
          { tonic: pc },
        );
        return;
      }
      // Primeira definição: um único commit (tônica + acorde da tônica, se `startWithSelected` estiver marcado).
      const block = selectBlock(s);
      const chord = block && !block.key && !block.chords.length && s.startWithSelected ? tonicChordFor({ ...s, tonic: pc }, block) : null;
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
    setMelodyGrid: (melodyGrid) => set({ melodyGrid }),
    setMelodyVisible: (melodyVisible) => set({ melodyVisible }),
    setMelodyCompact: (melodyCompact) => set({ melodyCompact }),
    setTimelineFit: (timelineFit) => set({ timelineFit }),
    setDockPanel: (panel, expanded) => set((s) => ({ dockPanels: { ...s.dockPanels, [panel]: expanded } })),
    toggleDockPanel: (panel) => set((s) => ({ dockPanels: { ...s.dockPanels, [panel]: !s.dockPanels[panel] } })),
    selectMelodyNote: (selectedMelodyNote) =>
      set(selectedMelodyNote ? { selectedMelodyNote, selectedChord: null, regionEnd: null } : { selectedMelodyNote }),
    setTrackMix: (track, patch) => {
      const cur = get().mixer;
      const prev = cur[track];
      const nextTrack: TrackMix = {
        volume: patch.volume !== undefined && Number.isFinite(patch.volume) ? Math.max(0, Math.min(1.5, patch.volume)) : prev.volume,
        muted: patch.muted !== undefined ? patch.muted : prev.muted,
        solo: patch.solo !== undefined ? patch.solo : prev.solo,
      };
      set({ mixer: { ...cur, [track]: nextTrack } });
    },
    setShowDegrees: (showDegrees) => set({ showDegrees }),
    setSoundOnHover: (soundOnHover) => set({ soundOnHover }),
    setInstrumentView: (instrumentView) => set({ instrumentView }),
    setTopBar: (topBar) => set({ topBar }),
    setDock: (dock) => set({ dock }),
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
      set({
        playhead,
        selectedItem: playhead.itemIndex,
        selectedChord: keep ? s.selectedChord : null,
        selectedMelodyNote: null,
        regionEnd: null,
        editEnding: false,
      });
    },
    setFollowPlayback: (followPlayback) => set({ followPlayback }),
    setMidi: (patch) => set({ midi: { ...get().midi, ...patch } }),

    addChord: (root, quality, modifiers, bass, duration) => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return null;
      const dur = Math.max(0.25, duration ?? gridBeats(s.grid, block.meter ?? s.song.meter));
      const chord = makeChord(root, quality, dur);
      if (modifiers?.length) chord.modifiers = structuredClone(modifiers);
      if (bass !== undefined && bass !== root) chord.bass = bass;
      commit(
        (song, st) => {
          const list = editList(song, st, true)!;
          const at = list.findIndex((c) => c.id === st.selectedChord);
          list.splice(at >= 0 ? at + 1 : list.length, 0, chord);
        },
        { selectedChord: chord.id },
      );
      return chord;
    },

    addRest: (duration) => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return null;
      const dur = Math.max(0.25, duration ?? gridBeats(s.grid, block.meter ?? s.song.meter));
      const rest = makeRest(dur);
      commit(
        (song, st) => {
          const list = editList(song, st, true)!;
          const at = list.findIndex((c) => c.id === st.selectedChord);
          list.splice(at >= 0 ? at + 1 : list.length, 0, rest);
        },
        { selectedChord: rest.id },
      );
      return rest;
    },

    insertChordAtBeat: (beat, chordOrRest) => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return null;
      const defDur = gridBeats(s.grid, block.meter ?? s.song.meter);
      const item: Chord =
        "id" in chordOrRest
          ? structuredClone(chordOrRest)
          : "rest" in chordOrRest && chordOrRest.rest
            ? makeRest(Math.max(0.25, chordOrRest.duration ?? defDur))
            : (() => {
                const c = makeChord(chordOrRest.root, chordOrRest.quality, Math.max(0.25, chordOrRest.duration ?? defDur));
                if (chordOrRest.modifiers?.length) c.modifiers = structuredClone(chordOrRest.modifiers);
                if (chordOrRest.bass !== undefined && chordOrRest.bass !== chordOrRest.root) c.bass = chordOrRest.bass;
                return c;
              })();
      commit(
        (song, st) => {
          const list = editList(song, st, true)!;
          const end = list.reduce((sum, c) => sum + c.duration, 0);
          if (beat > end + 1e-6) {
            list.push(makeRest(Math.max(0.25, beat - end)));
          }
          list.push(item);
        },
        { selectedChord: item.id },
      );
      return item;
    },

    toggleRest: (id) =>
      editChord(id, (c) => {
        if (isRest(c)) {
          delete c.rest;
        } else {
          c.root = 0;
          c.quality = "maj";
          c.modifiers = [];
          delete c.bass;
          delete c.voicing;
          delete c.octave;
          c.rest = true;
        }
      }),

    selectChord: (selectedChord) =>
      set(selectedChord ? { selectedChord, selectedMelodyNote: null, regionEnd: null } : { selectedChord, regionEnd: null }),
    setEditEnding: (editEnding) => set({ editEnding, selectedChord: null, selectedMelodyNote: null, regionEnd: null }),
    clearEnding: () =>
      commit(
        (song, s) => {
          const b = currentBlock(song, s);
          if (b) {
            delete b.ending;
            delete b.melodyEnding;
          }
        },
        { selectedChord: null, selectedMelodyNote: null, editEnding: false },
      ),

    removeChord: (id) =>
      commit(
        (song, s) => {
          const list = editList(song, s);
          const i = list?.findIndex((c) => c.id === id) ?? -1;
          if (list && i >= 0) list.splice(i, 1);
          tidyEnding(song, s);
        },
        get().selectedChord === id ? { selectedChord: null } : {},
      ),

    duplicateChord: (id) => {
      const copyId = newChordId();
      commit(
        (song, s) => {
          const list = editList(song, s);
          const i = list?.findIndex((c) => c.id === id) ?? -1;
          if (list && i >= 0) list.splice(i + 1, 0, { ...structuredClone(list[i]), id: copyId });
        },
        { selectedChord: copyId },
      );
    },

    moveChord: (from, to) =>
      commit((song, s) => {
        const list = editList(song, s);
        if (!list || from === to) return;
        const [c] = list.splice(from, 1);
        list.splice(to, 0, c);
      }),

    setDuration: (id, beats) => editChord(id, (c) => void (c.duration = Math.max(0.25, beats))),
    toggleMod: (id, m) => editChord(id, (c) => void (!isRest(c) && (c.modifiers = toggleModifier(c.modifiers, m)))),
    setBass: (id, bass) =>
      editChord(id, (c) => {
        if (isRest(c)) return;
        if (bass === undefined || mod12(bass) === c.root) delete c.bass;
        else c.bass = mod12(bass);
      }),
    setOctave: (id, octave) => editChord(id, (c) => void (!isRest(c) && (c.octave = Math.max(-2, Math.min(2, octave))))),

    clearBlock: () => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return;
      if (s.editEnding) {
        commit(
          (song, st) => {
            const b = currentBlock(song, st)!;
            delete b.ending;
            delete b.melodyEnding;
          },
          { selectedChord: null, selectedMelodyNote: null },
        );
        return;
      }
      const chord = s.startWithSelected ? tonicChordFor(s, block) : null;
      commit((song, st) => void (currentBlock(song, st)!.chords = chord ? [chord] : []), { selectedChord: chord?.id ?? null });
    },

    completeBar: () =>
      commit((song, s) => {
        const b = currentBlock(song, s);
        const list = editList(song, s);
        if (!b || !list?.length) return;
        const per = (b.meter ?? song.meter)[0];
        const total = list.reduce((n, c) => n + c.duration, 0);
        const rest = total % per;
        if (rest) list[list.length - 1].duration += per - rest;
        tidyEnding(song, s);
      }),

    applyPreset: (preset) =>
      commit((song, s) => {
        const b = currentBlock(song, s);
        const key = blockKey(s, b);
        const ctx = key ? scaleContext(key.tonic, key.scaleId) : null;
        const list = editList(song, s);
        if (!b || !list) return;
        for (const c of list) {
          if (isRest(c)) continue;
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

    upsertMelodyNote: (note) => {
      const s = get();
      if (!selectBlock(s)) return null;
      const full = makeMelodyNote(note.pitch, note.start, note.duration, note.velocity);
      if (note.id) full.id = note.id;
      commit(
        (song, st) => {
          const b = currentBlock(song, st);
          if (!b) return;
          const list = editMelodyList(song, st, true) ?? [];
          const next = upsertMelodyList(list, full);
          if (st.editEnding) b.melodyEnding = next;
          else b.melody = next;
        },
        { selectedMelodyNote: full.id },
      );
      return full;
    },

    updateMelodyNote: (id, patch) =>
      commit((song, st) => {
        const b = currentBlock(song, st);
        const list = editMelodyList(song, st);
        const cur = list?.find((n) => n.id === id);
        if (!b || !list || !cur) return;
        const nextNote = makeMelodyNote(
          patch.pitch ?? cur.pitch,
          patch.start ?? cur.start,
          patch.duration ?? cur.duration,
          "velocity" in patch ? patch.velocity : cur.velocity,
        );
        nextNote.id = cur.id;
        const next = upsertMelodyList(list, nextNote);
        if (st.editEnding) b.melodyEnding = next;
        else b.melody = next;
      }),

    removeMelodyNote: (id) =>
      commit(
        (song, st) => {
          const b = currentBlock(song, st);
          const list = editMelodyList(song, st);
          if (!b || !list) return;
          const next = list.filter((n) => n.id !== id);
          if (st.editEnding) {
            if (next.length) b.melodyEnding = next;
            else delete b.melodyEnding;
          } else {
            if (next.length) b.melody = next;
            else delete b.melody;
          }
        },
        get().selectedMelodyNote === id ? { selectedMelodyNote: null } : {},
      ),

    clearMelody: () =>
      commit(
        (song, st) => {
          const b = currentBlock(song, st);
          if (!b) return;
          if (st.editEnding) delete b.melodyEnding;
          else delete b.melody;
        },
        { selectedMelodyNote: null },
      ),

    snapBlockMelodyToScale: () => {
      const s = get();
      const ctx = selectBlockCtx(s);
      const cur = selectEditMelody(s);
      if (!ctx || !cur.length) return;
      const snapped = snapMelodyToScale(cur, ctx);
      if (snapped.every((n, i) => n.pitch === cur[i].pitch)) return;
      commit((song, st) => {
        const b = currentBlock(song, st);
        if (!b) return;
        if (st.editEnding) b.melodyEnding = snapped;
        else b.melody = snapped;
      });
    },

    setBlockChords: (chords) =>
      commit(
        (song, st) => {
          const b = currentBlock(song, st);
          if (!b) return;
          const clean = structuredClone(chords);
          if (st.editEnding) {
            if (clean.length) b.ending = clean;
            else delete b.ending;
          } else {
            b.chords = clean;
          }
        },
        { selectedChord: chords[0]?.id ?? null },
      ),

    applyAIGeneration: (patch) => {
      const s = get();
      const block = selectBlock(s);
      if (!block) return;
      const hasChange =
        patch.chords !== undefined ||
        patch.melody !== undefined ||
        patch.bassInstrument !== undefined ||
        patch.tonic !== undefined ||
        patch.scaleId !== undefined;
      if (!hasChange) return;

      const extra: Partial<State> = {};
      if (patch.chords !== undefined) {
        extra.selectedChord = patch.chords[0]?.id ?? null;
        extra.selectedMelodyNote = null;
      } else if (patch.melody !== undefined) {
        extra.selectedMelodyNote = patch.melody[0]?.id ?? null;
        extra.selectedChord = null;
      }
      if (!block.key) {
        if (patch.tonic !== undefined && Number.isFinite(patch.tonic)) {
          extra.tonic = mod12(patch.tonic);
        }
        if (patch.scaleId !== undefined && hasScale(patch.scaleId)) {
          extra.scaleId = patch.scaleId;
        }
      }

      commit((song, st) => {
        const b = currentBlock(song, st);
        if (!b) return;
        if (patch.chords !== undefined) {
          const cleanChords = structuredClone(patch.chords);
          if (st.editEnding) {
            if (cleanChords.length) b.ending = cleanChords;
            else delete b.ending;
          } else {
            b.chords = cleanChords;
          }
        }
        if (patch.melody !== undefined) {
          const cleanMelody = structuredClone(patch.melody);
          if (st.editEnding) {
            if (cleanMelody.length) b.melodyEnding = cleanMelody;
            else delete b.melodyEnding;
          } else if (cleanMelody.length) {
            b.melody = cleanMelody;
          } else {
            delete b.melody;
          }
        }
        if (patch.bassInstrument !== undefined && hasInstrument(patch.bassInstrument)) {
          b.bassInstrument = patch.bassInstrument;
        }
        if (b.key && (patch.tonic !== undefined || patch.scaleId !== undefined)) {
          b.key = {
            tonic: patch.tonic !== undefined && Number.isFinite(patch.tonic) ? mod12(patch.tonic) : b.key.tonic,
            scaleId: patch.scaleId !== undefined && hasScale(patch.scaleId) ? patch.scaleId : b.key.scaleId,
          };
        }
      }, extra);
    },

    selectItem: (selectedItem) => set({ selectedItem, selectedChord: null, selectedMelodyNote: null, regionEnd: null, editEnding: false }),

    addBlock: () => {
      const s = get();
      const block = makeBlock(`Bloco ${Object.keys(s.song.blocks).length + 1}`, Object.keys(s.song.blocks).length);
      const chord = s.startWithSelected ? tonicChordFor(s, block) : null;
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
      commit(
        (song) => {
        const b = song.blocks[blockId];
        if (!b) return;
        for (const [k, v] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
          let value = v;
          if (k === "bpm" || k === "midiChannel" || k === "melodyMidiChannel" || k === "rampTo") {
            const [lo, hi] = k === "midiChannel" || k === "melodyMidiChannel" ? [1, 16] : [30, 300];
            value = typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined;
          }
          if (k === "color") value = typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : b.color;
          if (k === "bassInstrument" || k === "melodyInstrument") value = typeof v === "string" && hasInstrument(v) ? v : undefined;
          if (k === "drone") value = v === true ? true : undefined;
          if (k === "key") {
            const key = v as Block["key"];
            value = key && Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic <= 11 && hasScale(key.scaleId) ? { tonic: key.tonic, scaleId: key.scaleId } : undefined;
          }
          if (value === undefined) delete b[k];
          else Object.assign(b, { [k]: value });
        }
        },
        {},
        Object.keys(patch).every((k) => k === "bpm") ? { coalesce: `bpm:${blockId}` } : undefined,
      ),

    setSongProps: (patch) =>
      commit((song) => {
        for (const k of ["voiceLeading", "reattack"] as const) {
          if (!(k in patch)) continue;
          if (patch[k]) song[k] = true;
          else delete song[k];
        }
      }),

    setVoicing: (id, voicing) =>
      editChord(id, (c) => {
        if (isRest(c)) return;
        if (voicing === undefined || voicing === "closed") delete c.voicing;
        else c.voicing = voicing;
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
        { selectedItem: 0, selectedChord: null, selectedMelodyNote: null, tonic },
      );
    },

    setBpm: (bpm) => commit((song) => void (song.bpm = Math.max(30, Math.min(300, Math.round(bpm)))), {}, { coalesce: "bpm" }),
    setMeter: (meter) => commit((song) => void (song.meter = meter)),
    setSwing: (swing) => commit((song) => void (song.swing = Math.max(0, Math.min(75, swing))), {}, { coalesce: "swing" }),
    setInstrument: (id) => commit((song) => void (song.instrument = id)),
    setMelodyInstrument: (id) => commit((song) => void (hasInstrument(id) && (song.melodyInstrument = id))),
    setPattern: (p) => commit((song) => void (song.pattern = p)),

    saveSong: () => {
      const s = get();
      const id = s.songId ?? newId("s");
      const name = s.songName.trim() || UNTITLED;
      if (!repository.saveSong({ id, name, updatedAt: Date.now(), version: CURRENT_VERSION, scaleId: s.scaleId, tonic: s.tonic, song: s.song })) return false;
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
      if (!stored || !songName.trim()) return true;
      if (!repository.saveSong({ ...stored, name: songName.trim() })) return false;
      set({ savedSongs: repository.listSongs() });
      return true;
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
        selectedMelodyNote: null,
        regionEnd: null,
        editEnding: false,
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
        selectedMelodyNote: null,
        regionEnd: null,
        editEnding: false,
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
        selectedMelodyNote: null,
        regionEnd: null,
        editEnding: false,
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
    version: CURRENT_VERSION,
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
    melodyGrid: s.melodyGrid,
    melodyVisible: s.melodyVisible,
    melodyCompact: s.melodyCompact,
    timelineFit: s.timelineFit,
    mixer: s.mixer,
    showDegrees: s.showDegrees,
    soundOnHover: s.soundOnHover,
    instrumentView: s.instrumentView,
    topBar: s.topBar,
    dock: s.dock,
    dockPanels: s.dockPanels,
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

/** O acorde cabe na escala atual? (sem tônica ou pausa N.C., sempre cabe) */
export function chordInScale(
  s: Pick<State, "tonic" | "scaleId">,
  c: Pick<Chord, "root" | "quality" | "rest">,
  block?: Pick<Block, "key"> | null,
): boolean {
  if (isRest(c)) return true;
  const key = blockKey(s, block);
  const ctx = key ? scaleContext(key.tonic, key.scaleId) : null;
  return !ctx || chordFits(c.root, c.quality, ctx.pcSet);
}

/** Há alterações desde o último salvamento (ou desde "Novo")? */
export const selectDirty = (s: Pick<State, "song" | "scaleId" | "tonic" | "savedHash">) => contentHash(s) !== s.savedHash;
