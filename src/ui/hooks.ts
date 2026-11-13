import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { instrumentProgress, instrumentStatus, play, previewNotes, stop, subscribeStatus } from "../audio/engine";
import { configureMidi, midiSnapshot, subscribeMidi } from "../audio/midi";
import type { Chord } from "../core/chords";
import { makeSpeller, type Speller } from "../core/pitch";
import { expandArrangement, expandRegion } from "../core/song";
import { voiceChord } from "../core/voicing";
import { flushSession, selectBlock, selectCtx, selectRegion, sessionAtRisk, useStore } from "../state/store";

export function useCtx() {
  const { tonic, scaleId } = useStore(useShallow((s) => ({ tonic: s.tonic, scaleId: s.scaleId })));
  return useMemo(() => selectCtx({ tonic, scaleId }), [tonic, scaleId]);
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

export function previewChord(chord: Chord, instrumentId = currentInstrument()) {
  void previewNotes(voiceChord(chord), instrumentId);
}

export async function togglePlay() {
  const s = useStore.getState();
  if (s.playing) {
    stop();
    s.setPlaying(false);
    return;
  }
  const region = s.playScope === "region" ? selectRegion(s) : null;
  const only = s.playScope === "block" || s.playScope === "region" ? [s.selectedItem] : undefined;
  const expanded = region ? expandRegion(s.song, s.selectedItem, region.from, region.to) : expandArrangement(s.song, only);
  if (!expanded.events.length) return;
  s.setPlaying(true);
  await play(expanded, {
    channelFor: (blockId) => useStore.getState().song.blocks[blockId]?.midiChannel ?? useStore.getState().midi.channel,
    loop: s.loop,
    metronome: s.metronome,
    countIn: s.countIn,
    swing: s.song.swing,
    onEvent: (i) => {
      const ev = expanded.events[i];
      useStore.getState().setPlayhead({ itemIndex: ev.itemIndex, chordIndex: ev.chordIndex, eventIndex: i });
    },
    onEnd: () => useStore.getState().setPlaying(false),
  });
}

export function stopPlayback() {
  stop();
  useStore.getState().setPlaying(false);
}

/** Mantém o módulo de MIDI em sincronia com as configurações do store. */
export function useMidiSync() {
  useEffect(() => {
    configureMidi(useStore.getState().midi);
    return useStore.subscribe((s, prev) => {
      if (s.midi !== prev.midi) configureMidi(s.midi);
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
