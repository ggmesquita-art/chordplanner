import { useEffect, useMemo, useRef, useState } from "react";
import { previewNotes } from "../../audio/engine";
import { makeSpeller, mod12 } from "../../core/pitch";
import { FAMILY_NAMES, getScale, pitchSet, relativeModes, scaleFormula, searchScales, type ScaleDef, type ScaleFamily } from "../../core/scales";
import { useStore } from "../../state/store";
import { currentInstrument } from "../hooks";
import { useListbox } from "../useListbox";
import { usePopover } from "../usePopover";

export function ScalePicker() {
  const scaleId = useStore((s) => s.scaleId);
  const tonic = useStore((s) => s.tonic);
  const accidentals = useStore((s) => s.accidentals);
  const setScale = useStore((s) => s.setScale);
  const setKey = useStore((s) => s.setKey);
  const scale = getScale(scaleId);
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<ScaleDef | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      setQuery("");
      setHover(null);
    }
    setOpen(!open);
  };

  const groups = useMemo(() => {
    const map = new Map<ScaleFamily, ScaleDef[]>();
    for (const sc of searchScales(query)) map.set(sc.family, [...(map.get(sc.family) ?? []), sc]);
    return [...map];
  }, [query]);

  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const previewTonic = tonic ?? 0;
  const playScale = (sc: ScaleDef) => {
    const base = 60 + previewTonic;
    void previewNotes([...sc.intervals.map((i) => base + i), base + 12], currentInstrument(), { arpeggio: true });
  };

  const choose = (sc: ScaleDef) => {
    setScale(sc.id);
    setOpen(false);
  };

  const lb = useListbox({
    count: flat.length,
    open,
    initial: flat.findIndex((sc) => sc.id === scaleId),
    onChoose: (i) => choose(flat[i]),
    onPlay: (i) => playScale(flat[i]),
    onNavigate: () => setHover(null),
  });
  const shown = hover ?? flat[Math.min(lb.active, flat.length - 1)] ?? scale;
  const spell = makeSpeller(previewTonic, pitchSet(previewTonic, shown), accidentals);
  const notes = pitchSet(previewTonic, shown).map(spell).join(" ");

  const relatives = relativeModes(scale).filter((m) => m.id !== scale.id);
  const toRelative = (target: ScaleDef) => {
    if (tonic === null) return setScale(target.id);
    // Mesma coleção de notas: a tônica passa a ser o grau correspondente da escala-mãe.
    const parent = getScale(scale.mode?.parent ?? scale.id);
    const parentTonic = mod12(tonic - parent.intervals[(scale.mode?.degree ?? 1) - 1]);
    setKey(mod12(parentTonic + parent.intervals[(target.mode?.degree ?? 1) - 1]), target.id);
  };

  return (
    <div className="picker" ref={ref}>
      <button className="picker-button" onClick={toggleOpen} aria-haspopup="listbox" aria-expanded={open}>
        <span className="picker-label">Escala</span>
        <span className="picker-value">{scale.name}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="popover scale-popover">
          <input
            ref={input}
            className="search"
            placeholder="Buscar escala (nome ou alias)…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), lb.resetActive(), setHover(null))}
            {...lb.inputProps}
          />
          <div className="scale-popover-body">
            <div className="scale-list" role="listbox" id={lb.listId} aria-label="Escalas">
              {groups.map(([family, scales]) => (
                <div key={family} className="scale-group">
                  <div className="group-title">{FAMILY_NAMES[family]}</div>
                  {scales.map((sc) => {
                    const i = flat.indexOf(sc);
                    return (
                    <div
                      key={sc.id}
                      id={lb.optionId(i)}
                      role="option"
                      aria-selected={sc.id === scaleId}
                      className={`scale-item ${i === lb.active ? "active" : ""}`}
                      onMouseEnter={() => setHover(sc)}
                      onClick={() => choose(sc)}
                    >
                      <span>{sc.name}</span>
                      <span className="muted small">{sc.intervals.length}</span>
                    </div>
                    );
                  })}
                </div>
              ))}
              {!groups.length && <div className="muted pad">Nenhuma escala encontrada.</div>}
            </div>
            <aside className="scale-preview">
              <div className="preview-name">{shown.name}</div>
              {shown.aliases && <div className="muted small">{shown.aliases.join(" · ")}</div>}
              <div className="formula">{scaleFormula(shown)}</div>
              <div className="preview-notes">{notes}</div>
              {shown.approx && <div className="warn small">⚠ Não temperada — aproximação em 12-TET.</div>}
              <button className="btn" onClick={() => playScale(shown)}>▶ Ouvir escala</button>
              {relatives.length > 0 && (
                <div className="relatives">
                  <div className="group-title">Modos relativos de {scale.name}</div>
                  {relatives.map((m) => (
                    <button key={m.id} className="chip" title="Mesmas notas, outra tônica" onClick={() => { toRelative(m); setOpen(false); }}>
                      {m.name.replace(/ \(.*\)/, "")}
                    </button>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
