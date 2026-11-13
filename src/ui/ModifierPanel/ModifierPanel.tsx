import { getInstrumentDef } from "../../audio/instruments";
import {
  hasModifier,
  inversionBass,
  inversionCount,
  modifierStatus,
  resolveChord,
  type Modifier,
  type NoteStatus,
} from "../../core/modifiers";
import { mod12 } from "../../core/pitch";
import { fitToRange, voiceChord } from "../../core/voicing";
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
const ORDINAL = ["Fund.", "1ª", "2ª", "3ª", "4ª", "5ª", "6ª"];

export function ModifierPanel() {
  const chord = useStore((s) => selectChord(s));
  const block = useBlock();
  const mode = useStore((s) => s.mode);
  const ctx = useCtx();
  const spell = useSpeller();
  const actions = useStore.getState();

  if (!chord || !block) {
    return (
      <section className="modifiers empty" aria-label="Modificadores">
        <h2>Modificadores</h2>
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
  const currentInversion = chord.bass === undefined ? 0 : [...Array(invCount).keys()].find((n) => n > 0 && inversionBass(chord, n) === chord.bass) ?? -1;

  const setBass = (bass: number | undefined) => {
    actions.setBass(chord.id, bass);
    const updated = selectChord(useStore.getState());
    if (updated) previewChord(updated);
  };

  const def = getInstrumentDef(currentInstrument());
  const voiced = fitToRange(voiceChord(chord), def.range);
  const statusByPc = new Map(resolved.pcs.map((pc, i) => [pc, resolved.status[i]]));

  return (
    <section className="modifiers" aria-label="Modificadores">
      <h2>
        Modificadores <span className="muted">— acorde {index + 1}:</span> <span className="accent">{resolved.symbol}</span>
      </h2>

      {GROUPS.map((g) => (
        <fieldset key={g.title} className="mod-group">
          <legend>{g.title}</legend>
          <div className="mod-buttons">
            {g.items.map(([m, label]) => {
              const active = hasModifier(chord.modifiers, m);
              const st = modifierStatus(chord, m, ctx);
              const disabled = !active && !allowed(st);
              return (
                <button
                  key={label}
                  className={`mod ${st} ${active ? "active" : ""}`}
                  disabled={disabled}
                  aria-pressed={active}
                  title={`${label}: ${STATUS_TEXT[st]}${disabled ? ` — bloqueado no modo ${mode === "strict" ? "Estrito" : "Colorido"}` : ""}`}
                  onClick={() => toggle(m)}
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
            <button key={n} className={`mod plain ${currentInversion === n ? "active" : ""}`} aria-pressed={currentInversion === n} onClick={() => setBass(inversionBass(chord, n))}>
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
        {resolved.pcs.map((pc, i) => (
          <span key={i} className={`note ${resolved.status[i]}`} title={STATUS_TEXT[resolved.status[i]]}>
            {resolved.status[i] === "diatonic" ? spell(pc) : `(${spell(pc)})`}
          </span>
        ))}
        {chord.bass !== undefined && !resolved.pcs.includes(mod12(chord.bass)) && <span className="note">/ {spell(chord.bass)}</span>}
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

      <MiniKeyboard notes={voiced.notes} status={(midi) => statusByPc.get(mod12(midi)) ?? "diatonic"} />
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

