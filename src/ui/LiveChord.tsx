import type { Chord } from "../core/chords";
import { chordSymbol } from "../core/modifiers";
import { chordRole } from "../core/view";
import { useStore } from "../state/store";
import { useCtx, useSpeller } from "./hooks";
import { useLiveChord } from "./useMidiInput";

/** Acorde que está sendo tocado no teclado MIDI (nome, grau e se cabe na escala). */
export function LiveChordBadge() {
  const enabled = useStore((s) => s.midi.inputEnabled);
  const record = useStore((s) => s.midi.inputRecord);
  const { notes, chord } = useLiveChord();
  const ctx = useCtx();
  const spell = useSpeller();
  if (!enabled) return null;

  let body: React.ReactNode = <span className="muted">toque no teclado</span>;
  let tone = "";
  if (chord) {
    const c: Chord = { ...chord, id: "live", duration: 4 };
    const { inScale, chromatic, roman } = chordRole(ctx, c);
    tone = inScale ? "in" : chromatic ? "chromatic" : "out";
    body = (
      <>
        <b>{chordSymbol(c, spell)}</b>
        {roman && <span className="mono">{roman}</span>}
        {!inScale && <span title={chromatic ? "Cromático com função" : "Fora da escala"}>{chromatic ? "◐" : "⚠"}</span>}
      </>
    );
  } else if (notes.length) {
    body = <span className="mono muted">{notes.map((n) => spell(n % 12)).join(" ")}</span>;
  }
  return (
    // Sem região "live": o conteúdo muda a cada tecla e o leitor de tela anunciaria cada nota.
    <div className={`live-chord ${tone}`} role="group" aria-label="Acorde no teclado MIDI">
      <span aria-hidden="true">🎹</span>
      {body}
      {record && (
        <span className="live-rec" title="Ao soltar as teclas, o acorde entra na progressão">
          ● grava
        </span>
      )}
    </div>
  );
}
