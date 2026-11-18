import { useEffect, useRef, useState } from "react";
import { getInstrumentDef } from "../../audio/instruments";
import {
  conflictingModifier,
  hasModifier,
  inversionBass,
  inversionCount,
  modifierStatus,
  resolveChord,
  type Modifier,
  sameModifier,
  type NoteStatus,
} from "../../core/modifiers";
import { chordNoteList, currentInversion, midiStatus, voicedInRange } from "../../core/view";
import { selectChord, useStore } from "../../state/store";
import { currentInstrument, previewChord, useBlock, useCtx, useSpeller } from "../hooks";
import { MiniKeyboard } from "../MiniKeyboard/MiniKeyboard";

type Group = { title: string; items: [Modifier, string][] };

const GROUPS: Group[] = [
  {
    title: "Extensões",
    items: [
      [{ kind: "ext", value: 6 }, "6"],
      [{ kind: "ext", value: 7 }, "7"],
      [{ kind: "ext", value: "maj7" }, "maj7"],
      [{ kind: "ext", value: 9 }, "9"],
      [{ kind: "ext", value: 11 }, "11"],
      [{ kind: "ext", value: 13 }, "13"],
    ],
  },
  {
    title: "Suspensões / Adições",
    items: [
      [{ kind: "sus", value: 2 }, "sus2"],
      [{ kind: "sus", value: 4 }, "sus4"],
      [{ kind: "add", value: 9 }, "add9"],
      [{ kind: "add", value: 11 }, "add11"],
      [{ kind: "add", value: 13 }, "add13"],
      [{ kind: "omit", value: 3 }, "omit3"],
      [{ kind: "omit", value: 5 }, "omit5"],
    ],
  },
  {
    title: "Alterações",
    items: [
      [{ kind: "alt", value: "b5" }, "♭5"],
      [{ kind: "alt", value: "#5" }, "♯5"],
      [{ kind: "alt", value: "b9" }, "♭9"],
      [{ kind: "alt", value: "#9" }, "♯9"],
      [{ kind: "alt", value: "#11" }, "♯11"],
      [{ kind: "alt", value: "b13" }, "♭13"],
    ],
  },
];

const ICON: Record<NoteStatus, string> = { diatonic: "✓", tension: "◐", outside: "⚠" };
const STATUS_TEXT: Record<NoteStatus, string> = {
  diatonic: "nota da escala",
  tension: "tensão idiomática (fora da escala)",
  outside: "fora da escala, sem uso idiomático",
};
const labelOf = (m: Modifier) => GROUPS.flatMap((g) => g.items).find(([x]) => sameModifier(x, m))?.[1] ?? "";
const ORDINAL = ["Fund.", "1ª", "2ª", "3ª", "4ª", "5ª", "6ª"];

export function ModifierPanel() {
  const chord = useStore((s) => selectChord(s));
  const block = useBlock();
  const mode = useStore((s) => s.mode);
  const ctx = useCtx();
  const spell = useSpeller();
  const actions = useStore.getState();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const chordId = chord?.id ?? null;

  // Gaveta (celular): abre ao selecionar um acorde (ajuste de estado durante o render); Esc fecha.
  const [seenChord, setSeenChord] = useState(chordId);
  if (seenChord !== chordId) {
    setSeenChord(chordId);
    if (chordId) setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    // Camada mais baixa: só fecha se nenhuma camada de cima tratou o Esc e o foco é da gaveta (ou da página).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const a = document.activeElement;
      if (a && a !== document.body && !panel.current?.contains(a)) return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const drawerToggle = (
    <button className="btn drawer-toggle" aria-expanded={open} aria-label={open ? "Recolher modificadores" : "Expandir modificadores"} onClick={() => setOpen(!open)}>
      {open ? "▾" : "▴"}
    </button>
  );

  if (!chord || !block) {
    return (
      <section ref={panel} className={`modifiers empty ${open ? "open" : ""}`} aria-label="Modificadores">
        <div className="mod-bar">
          <h2>Modificadores</h2>
          {drawerToggle}
        </div>
        <p className="muted">Selecione um acorde da progressão para enriquecer a harmonia com extensões, suspensões, alterações e inversões.</p>
        <Presets />
      </section>
    );
  }

  const index = block.chords.findIndex((c) => c.id === chord.id);
  const resolved = resolveChord(chord, ctx, spell);
  const allowed = (st: NoteStatus) => mode === "free" || st === "diatonic" || (mode === "colorful" && st === "tension");

  const toggle = (m: Modifier) => {
    actions.toggleMod(chord.id, m);
    const updated = selectChord(useStore.getState());
    if (updated) previewChord(updated);
  };

  const invCount = Math.min(inversionCount(chord), ORDINAL.length);
  const inversion = currentInversion(chord, invCount);

  const setBass = (bass: number | undefined) => {
    actions.setBass(chord.id, bass);
    const updated = selectChord(useStore.getState());
    if (updated) previewChord(updated);
  };

  const def = getInstrumentDef(currentInstrument());
  const voiced = voicedInRange(chord, def.range);
  const noteList = chordNoteList(chord, resolved);

  return (
    <section ref={panel} className={`modifiers ${open ? "open" : ""}`} aria-label="Modificadores">
      <div className="mod-bar">
        <h2>
          Modificadores <span className="muted">— acorde {index + 1}:</span> <span className="accent">{resolved.symbol}</span>
        </h2>
        {drawerToggle}
      </div>

      {GROUPS.map((g) => (
        <fieldset key={g.title} className="mod-group">
          <legend>{g.title}</legend>
          <div className="mod-buttons">
            {g.items.map(([m, label]) => {
              const active = hasModifier(chord.modifiers, m);
              const st = modifierStatus(chord, m, ctx);
              const disabled = !active && !allowed(st);
              const clash = conflictingModifier(chord.modifiers, m);
              return (
                <button
                  key={label}
                  className={`mod ${st} ${active ? "active" : ""} ${clash && !disabled ? "conflict" : ""}`}
                  disabled={disabled}
                  aria-pressed={active}
                  aria-disabled={clash && !disabled ? true : undefined}
                  title={
                    disabled
                      ? `${label}: ${STATUS_TEXT[st]} — bloqueado no modo ${mode === "strict" ? "Estrito" : "Colorido"}`
                      : clash
                        ? `Conflita com ${labelOf(clash)} — remova-o primeiro`
                        : `${label}: ${STATUS_TEXT[st]}`
                  }
                  onClick={() => !clash && toggle(m)}
                >
                  <span className="mod-icon" aria-hidden>
                    {ICON[st]}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <fieldset className="mod-group">
        <legend>Baixo / Inversão</legend>
        <div className="mod-buttons">
          {Array.from({ length: invCount }, (_, n) => (
            <button key={n} className={`mod plain ${inversion === n ? "active" : ""}`} aria-pressed={inversion === n} onClick={() => setBass(inversionBass(chord, n))}>
              {ORDINAL[n]}
            </button>
          ))}
          <label className="field small">
            baixo /
            <select
              value={chord.bass ?? ""}
              onChange={(e) => setBass(e.target.value === "" ? undefined : Number(e.target.value))}
              aria-label="Baixo livre (slash)"
            >
              <option value="">—</option>
              {Array.from({ length: 12 }, (_, pc) => (
                <option key={pc} value={pc}>
                  {spell(pc)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="mod-group">
        <legend>Voicing</legend>
        <div className="mod-buttons">
          <select disabled aria-label="Voicing" title="Aberto, Drop 2/3, Quartal e Shell chegam na v2">
            <option>Fechado</option>
          </select>
          <span className="field small">
            Oitava
            <button className="icon-btn tiny" onClick={() => actions.setOctave(chord.id, (chord.octave ?? 0) - 1)} aria-label="Oitava abaixo">
              −
            </button>
            <span className="mono">{(chord.octave ?? 0) >= 0 ? `+${chord.octave ?? 0}` : chord.octave}</span>
            <button className="icon-btn tiny" onClick={() => actions.setOctave(chord.id, (chord.octave ?? 0) + 1)} aria-label="Oitava acima">
              +
            </button>
          </span>
        </div>
      </fieldset>

      <div className="notes-line">
        <span className="muted small">Notas:</span>
        {noteList.notes.map(({ pc, status }, i) => (
          <span key={i} className={`note ${status}`} title={STATUS_TEXT[status]}>
            {status === "diatonic" ? spell(pc) : `(${spell(pc)})`}
          </span>
        ))}
        {noteList.extraBass !== null && <span className="note">/ {spell(noteList.extraBass)}</span>}
      </div>
      <div className="legend small">
        <span>
          <i className="sw diatonic" /> ✓ diatônica
        </span>
        <span>
          <i className="sw tension" /> ◐ tensão
        </span>
        <span>
          <i className="sw outside" /> ⚠ fora
        </span>
      </div>

      <MiniKeyboard notes={voiced.notes} status={(midi) => midiStatus(resolved, midi)} />
      {voiced.dropped > 0 && <div className="warn small">⚠ {voiced.dropped} nota(s) fora da tessitura de {def.name}.</div>}

      <Presets />
    </section>
  );
}

function Presets() {
  const applyPreset = useStore((s) => s.applyPreset);
  return (
    <div className="presets">
      <div className="group-title">Ações rápidas (bloco atual)</div>
      <button className="btn" onClick={() => applyPreset("jazzify")} title="Aplica a 7ª diatônica natural de cada grau">
        🎷 Jazzificar
      </button>
      <button className="btn" onClick={() => applyPreset("add9")}>
        + 9ª em tudo
      </button>
      <button className="btn" onClick={() => applyPreset("susDominants")}>
        Suspender dominantes
      </button>
      <button className="btn" onClick={() => applyPreset("clear")}>
        Limpar modificadores
      </button>
    </div>
  );
}

