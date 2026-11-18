// Teclado MIDI: liga a entrada (midiInput.ts) ao som, ao reconhecimento de acordes e à progressão.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { liveAllOff, liveNoteOff, liveNoteOn } from "../audio/engine";
import { configureMidiInput, pressedNotes, subscribeMidiInput, subscribePressed } from "../audio/midiInput";
import { recognizeChord, type Recognized } from "../core/recognize";
import { selectBlockCtx, useStore } from "../state/store";
import { currentInstrument, useCtx } from "./hooks";

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

/** Monta a entrada MIDI: configura portas, toca as notas (se "ouvir") e grava acordes (se "inserir"). */
export function useMidiInput() {
  useEffect(() => {
    const sync = () => {
      const { inputEnabled, inputId } = useStore.getState().midi;
      configureMidiInput({ enabled: inputEnabled, inputId });
    };
    sync();
    const recorder = createChordRecorder((r) => {
      const s = useStore.getState();
      if (s.midi.inputRecord) s.addChord(r.root, r.quality, r.modifiers, r.bass);
    });
    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.midi === prev.midi) return;
      if (!s.midi.inputThru && prev.midi.inputThru) liveAllOff();
      // Ligar a gravação (ou a entrada) no meio de um gesto não grava o acorde já segurado.
      if (s.midi.inputRecord !== prev.midi.inputRecord || s.midi.inputEnabled !== prev.midi.inputEnabled) recorder.reset();
      sync();
    });
    const unsubInput = subscribeMidiInput((e) => {
      const s = useStore.getState();
      if (e.type === "press") {
        if (s.midi.inputThru) liveNoteOn(e.note, e.velocity, currentInstrument());
        const notes = pressedNotes();
        recorder.pressed(notes, recognizeChord([...notes], selectBlockCtx(s)));
      } else if (e.type === "release") {
        recorder.released(pressedNotes());
      } else if (e.type === "reset") {
        recorder.reset(); // soltura forçada (porta saiu, All Notes Off): não é o fim de um gesto
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
