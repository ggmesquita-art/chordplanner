import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { instrumentProgress, instrumentStatus, play, type PlayOptions, previewNotes, stop, subscribeStatus } from "../audio/engine";
import { configureMidi, midiSnapshot, subscribeMidi } from "../audio/midi";
import { setMixState } from "../audio/status";
import { isRest, type Chord } from "../core/chords";
import { DEFAULT_MELODY_INSTRUMENT } from "../core/melody";
import { makeSpeller, type Speller } from "../core/pitch";
import { blockMeter, expandArrangement, expandRegion } from "../core/song";
import { meterLabel } from "../core/timeline";
import { voiceChord } from "../core/voicing";
import { scaleContext } from "../core/diatonic";
import { blockKey, flushSession, selectBlock, selectRegion, sessionAtRisk, useStore } from "../state/store";

/** Contexto de escala do bloco selecionado: a tonalidade do bloco (modulação) ou a global. */
export function useCtx() {
  const { tonic, scaleId } = useStore(
    useShallow((s) => {
      const key = blockKey(s, selectBlock(s));
      return { tonic: key?.tonic ?? null, scaleId: key?.scaleId ?? s.scaleId };
    }),
  );
  return useMemo(() => (tonic === null ? null : scaleContext(tonic, scaleId)), [tonic, scaleId]);
}

export function useSpeller(): Speller {
  const ctx = useCtx();
  const accidentals = useStore((s) => s.accidentals);
  return useMemo(() => makeSpeller(ctx?.tonic ?? null, ctx?.pcs ?? [], accidentals), [ctx, accidentals]);
}

export function useBlock() {
  return useStore((s) => selectBlock(s));
}

export function useInstrumentStatus(id: string) {
  return useSyncExternalStore(subscribeStatus, () => instrumentStatus(id));
}

/** Progresso (0–1) do carregamento de samples, ou null se desconhecido. */
export function useInstrumentProgress(id: string) {
  return useSyncExternalStore(subscribeStatus, () => instrumentProgress(id));
}

/** Instrumento efetivo do bloco selecionado (override ou global). */
export function currentInstrument(): string {
  const s = useStore.getState();
  return selectBlock(s)?.instrument ?? s.song.instrument;
}

/** Instrumento efetivo da pista de melodia no bloco selecionado. */
export function currentMelodyInstrument(): string {
  const s = useStore.getState();
  return selectBlock(s)?.melodyInstrument ?? s.song.melodyInstrument ?? DEFAULT_MELODY_INSTRUMENT;
}

export function previewChord(chord: Chord, instrumentId = currentInstrument()) {
  if (isRest(chord)) return;
  void previewNotes(voiceChord(chord), instrumentId);
}

export async function togglePlay() {
  const s = useStore.getState();
  if (s.playing) {
    s.setPlaying(false);
    stop();
    return;
  }
  const region = s.playScope === "region" ? selectRegion(s) : null;
  const only = s.playScope === "block" || s.playScope === "region" ? [s.selectedItem] : undefined;
  const expanded = region ? expandRegion(s.song, s.selectedItem, region.from, region.to) : expandArrangement(s.song, only);
  if ((!expanded.events.length && !expanded.melodyEvents.length) || expanded.totalSec <= 0) return;
  s.setPlaying(true);
  const opts: PlayOptions = {
    channelFor: (blockId) => useStore.getState().song.blocks[blockId]?.midiChannel ?? useStore.getState().midi.channel,
    melodyChannelFor: (blockId) => useStore.getState().song.blocks[blockId]?.melodyMidiChannel ?? useStore.getState().midi.melodyChannel,
    mixer: s.mixer,
    loop: s.loop,
    metronome: s.metronome,
    countIn: s.countIn,
    swing: s.song.swing,
    tonicFor: (blockId) => {
      const st = useStore.getState();
      return blockKey(st, st.song.blocks[blockId])?.tonic ?? null;
    },
    reattack: s.song.reattack,
    voiceLeading: s.song.voiceLeading,
    onEvent: (i) => {
      const ev = expanded.events[i];
      if (!ev) return;
      useStore.getState().setPlayhead({ itemIndex: ev.itemIndex, chordIndex: ev.isPadding ? -1 : ev.chordIndex, eventIndex: i });
    },
    onEnd: () => useStore.getState().setPlaying(false),
  };
  await play(expanded, opts);
}

export function stopPlayback() {
  useStore.getState().setPlaying(false);
  stop();
}

/** Mantém o módulo de MIDI e o mixer ao vivo em sincronia com as configurações do store. */
export function useMidiSync() {
  useEffect(() => {
    configureMidi(useStore.getState().midi);
    setMixState(useStore.getState().mixer);
    return useStore.subscribe((s, prev) => {
      if (s.midi !== prev.midi) configureMidi(s.midi);
      if (s.mixer !== prev.mixer) setMixState(s.mixer);
    });
  }, []);
}

export function useMixerSync() {
  useEffect(() => {
    setMixState(useStore.getState().mixer);
    return useStore.subscribe((s, prev) => {
      if (s.mixer !== prev.mixer) setMixState(s.mixer);
    });
  }, []);
}

export function useMidiState() {
  return useSyncExternalStore(subscribeMidi, midiSnapshot);
}

/** Grava a sessão ao fechar/ocultar a página; só pede confirmação se a sessão não estiver sendo persistida. */
export function useSessionGuard() {
  useEffect(() => {
    const onHide = () => flushSession();
    const onVisibility = () => document.visibilityState === "hidden" && flushSession();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushSession();
      if (sessionAtRisk()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
}

/** "Bloco · acorde N · compasso" do que está tocando, ou "—". */
export function usePositionLabel(): string {
  const song = useStore((s) => s.song);
  const playhead = useStore((s) => s.playhead);
  if (!playhead) return "—";
  const item = song.arrangement[playhead.itemIndex];
  const block = item && song.blocks[item.blockId];
  if (!block) return "—";
  const meter = meterLabel(blockMeter(song, block));
  return playhead.chordIndex < 0 ? `${block.name} · melodia · ${meter}` : `${block.name} · acorde ${playhead.chordIndex + 1} · ${meter}`;
}
