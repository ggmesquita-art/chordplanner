// Teclado MIDI: liga a entrada (midiInput.ts) ao som, ao reconhecimento de acordes e à gravação (acordes e melodia).

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { liveAllOff, liveNoteOff, liveNoteOn } from "../audio/engine";
import type { MidiRecordTarget } from "../audio/midi";
import { configureMidiInput, pressedNotes, subscribeMidiInput, subscribePressed } from "../audio/midiInput";
import { getPlaybackTime } from "../audio/status";
import type { ScaleContext } from "../core/diatonic";
import { melodyEndBeat, snapPitchToScale } from "../core/melody";
import { recognizeChord, type Recognized } from "../core/recognize";
import { blockMeter, endingCut, expandArrangement, expandRegion, playbackBeatAtSec } from "../core/song";
import { gridBeats, snapDuration } from "../core/timeline";
import type { RestrictionMode } from "../state/repository";
import { selectBlock, selectBlockCtx, selectEditMelody, selectRegion, useStore } from "../state/store";
import { currentInstrument, currentMelodyInstrument, useCtx } from "./hooks";

/**
 * Grava a progressão pelo teclado: guarda a leitura do maior acorde segurado durante o gesto
 * (soltar uma tecla antes das outras não troca o acorde) e o insere quando todas as teclas sobem.
 */
export function createChordRecorder(onChord: (r: Recognized) => void) {
  let best: { chord: Recognized; size: number } | null = null;
  return {
    pressed(notes: readonly number[], chord: Recognized | null) {
      if (chord && notes.length >= (best?.size ?? 0)) best = { chord, size: notes.length };
    },
    released(notes: readonly number[]) {
      if (notes.length) return;
      if (best) onChord(best.chord);
      best = null;
    },
    reset() {
      best = null;
    },
  };
}

export type MelodyRecorderHost = {
  isRecording: () => boolean;
  isPlaying: () => boolean;
  getTarget: () => MidiRecordTarget;
  getUnit: () => number;
  getMode: () => RestrictionMode;
  getCtx: () => ScaleContext | null;
  getInitialStepBeat: () => number;
  getLiveBeat: () => number | null;
  onNote: (note: { pitch: number; start: number; duration: number; velocity: number }) => void;
};

const quantizeStart = (raw: number, unit: number) => Math.max(0, Math.round(Math.round(raw / unit) * unit * 64) / 64);

/**
 * Grava melodia monofônica pelo teclado MIDI em dois modos:
 *  - `melody-step`: cada tecla pressionada insere na batida do cursor e avança pela grade da melodia;
 *  - `melody-live`: captura notas durante a reprodução (com count-in/metrônomo) e quantiza início e duração.
 */
export function createMelodyRecorder(host: MelodyRecorderHost) {
  let stepCursor: number | null = null;
  let activeLive: { midi: number; pitch: number; startBeat: number; velocity: number } | null = null;

  const commitLive = (endBeat: number) => {
    if (!activeLive) return;
    const live = activeLive;
    activeLive = null;
    const unit = Math.max(0.25, host.getUnit());
    const start = quantizeStart(live.startBeat, unit);
    const duration = snapDuration(Math.max(0.1, endBeat - live.startBeat), unit);
    host.onNote({ pitch: live.pitch, start, duration, velocity: live.velocity });
  };

  return {
    press(midi: number, velocity: number) {
      if (!host.isRecording()) return;
      const target = host.getTarget();
      if (target === "chords") return;
      const ctx = host.getCtx();
      const pitch = host.getMode() === "strict" && ctx ? snapPitchToScale(midi, ctx) : midi;
      const unit = Math.max(0.25, host.getUnit());

      if (target === "melody-step") {
        if (stepCursor === null) stepCursor = Math.max(0, host.getInitialStepBeat());
        const start = stepCursor;
        stepCursor = Math.round((stepCursor + unit) * 64) / 64;
        host.onNote({ pitch, start, duration: unit, velocity });
        return;
      }

      if (target === "melody-live") {
        if (!host.isPlaying()) return;
        const beat = host.getLiveBeat();
        if (beat === null) return;
        if (activeLive) {
          commitLive(Math.max(activeLive.startBeat + 0.05, beat));
        }
        activeLive = { midi, pitch, startBeat: Math.max(0, beat), velocity };
      }
    },
    release(midi: number) {
      if (!activeLive || activeLive.midi !== midi) return;
      const beat = host.getLiveBeat() ?? activeLive.startBeat + Math.max(0.25, host.getUnit());
      commitLive(beat);
    },
    flushLive(fallbackEndBeat?: number) {
      if (!activeLive) return;
      const beat = host.getLiveBeat() ?? fallbackEndBeat ?? activeLive.startBeat + Math.max(0.25, host.getUnit());
      commitLive(beat);
    },
    reset() {
      stepCursor = null;
      activeLive = null;
    },
  };
}

/** Monta a entrada MIDI: configura portas, toca as notas (se "ouvir") e grava acordes ou melodia. */
export function useMidiInput() {
  useEffect(() => {
    const sync = () => {
      const { inputEnabled, inputId } = useStore.getState().midi;
      configureMidiInput({ enabled: inputEnabled, inputId });
    };
    sync();
    const chordRecorder = createChordRecorder((r) => {
      const s = useStore.getState();
      if (s.midi.inputRecord && s.midi.inputRecordTarget === "chords") {
        s.addChord(r.root, r.quality, r.modifiers, r.bass);
      }
    });
    const melodyRecorder = createMelodyRecorder({
      isRecording: () => useStore.getState().midi.inputRecord,
      isPlaying: () => useStore.getState().playing,
      getTarget: () => useStore.getState().midi.inputRecordTarget,
      getUnit: () => {
        const s = useStore.getState();
        const block = selectBlock(s);
        return gridBeats(s.melodyGrid, block ? blockMeter(s.song, block) : s.song.meter);
      },
      getMode: () => useStore.getState().mode,
      getCtx: () => selectBlockCtx(useStore.getState()),
      getInitialStepBeat: () => {
        const s = useStore.getState();
        const mel = selectEditMelody(s);
        const sel = mel.find((n) => n.id === s.selectedMelodyNote);
        return sel ? Math.round((sel.start + sel.duration) * 64) / 64 : melodyEndBeat(mel);
      },
      getLiveBeat: () => {
        const snap = getPlaybackTime();
        if (!snap) return null;
        let elapsed = snap.seconds - snap.offset;
        if (elapsed < -0.08) return null;
        if (elapsed < 0) elapsed = 0;
        const s = useStore.getState();
        const block = selectBlock(s);
        if (!block) return null;
        const region = s.playScope === "region" ? selectRegion(s) : null;
        const expanded = region
          ? expandRegion(s.song, s.selectedItem, region.from, region.to)
          : expandArrangement(s.song, s.playScope === "block" ? [s.selectedItem] : undefined);
        if (expanded.totalSec <= 0) return null;
        if (s.loop) elapsed = elapsed % expanded.totalSec;
        const pos = playbackBeatAtSec(expanded, elapsed);
        const inEndingMatch = pos ? (s.editEnding ? pos.inEnding || pos.melodyInEnding : !pos.melodyInEnding) : false;
        if (!pos || pos.blockId !== block.id || !inEndingMatch) return null;
        const meter = blockMeter(s.song, block);
        return s.editEnding ? Math.max(0, pos.blockBeat - endingCut(block, meter)) : pos.blockBeat;
      },
      onNote: (note) => {
        useStore.getState().upsertMelodyNote(note);
      },
    });

    const unsubStore = useStore.subscribe((s, prev) => {
      if (prev.playing && !s.playing) melodyRecorder.flushLive();
      if (s.selectedItem !== prev.selectedItem || s.editEnding !== prev.editEnding) melodyRecorder.reset();
      if (s.midi === prev.midi) return;
      if (!s.midi.inputThru && prev.midi.inputThru) liveAllOff();
      if (
        s.midi.inputRecord !== prev.midi.inputRecord ||
        s.midi.inputRecordTarget !== prev.midi.inputRecordTarget ||
        s.midi.inputEnabled !== prev.midi.inputEnabled
      ) {
        chordRecorder.reset();
        melodyRecorder.reset();
      }
      sync();
    });
    const unsubInput = subscribeMidiInput((e) => {
      const s = useStore.getState();
      const target = s.midi.inputRecordTarget;
      if (e.type === "press") {
        if (s.midi.inputThru) {
          if (target === "chords") {
            liveNoteOn(e.note, e.velocity, currentInstrument());
          } else {
            const melCh = selectBlock(s)?.melodyMidiChannel ?? s.midi.melodyChannel;
            liveNoteOn(e.note, e.velocity, currentMelodyInstrument(), { track: "melody", channel: melCh });
          }
        }
        if (target === "chords") {
          const notes = pressedNotes();
          chordRecorder.pressed(notes, recognizeChord([...notes], selectBlockCtx(s)));
        } else {
          melodyRecorder.press(e.note, e.velocity);
        }
      } else if (e.type === "release") {
        if (target === "chords") chordRecorder.released(pressedNotes());
        else melodyRecorder.release(e.note);
      } else if (e.type === "reset") {
        chordRecorder.reset();
        melodyRecorder.reset();
      } else {
        liveNoteOff(e.note);
      }
    });
    return () => {
      unsubStore();
      unsubInput();
      liveAllOff();
    };
  }, []);
}

/** Notas apertadas agora e a leitura delas no tom do bloco atual. */
export function useLiveChord(): { notes: readonly number[]; chord: Recognized | null } {
  const notes = useSyncExternalStore(subscribePressed, pressedNotes);
  const ctx = useCtx();
  const chord = useMemo(() => recognizeChord([...notes], ctx), [notes, ctx]);
  return { notes, chord };
}
