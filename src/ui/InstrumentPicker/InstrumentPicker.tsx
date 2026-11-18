import { useMemo, useState } from "react";
import { preload, previewNotes } from "../../audio/engine";
import { CATEGORY_NAMES, INSTRUMENTS, getInstrumentDef, type InstrumentCategory, type InstrumentDef } from "../../audio/instruments";
import { suggestionsFor } from "../../audio/scaleInstruments";
import { getScale } from "../../core/scales";
import { voiceChord } from "../../core/voicing";
import { makeChord } from "../../core/chords";
import { selectChord, selectCtx, useStore } from "../../state/store";
import { useInstrumentProgress, useInstrumentStatus } from "../hooks";
import { useListbox } from "../useListbox";
import { usePopover } from "../usePopover";

const normalize = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function StatusDot({ id }: { id: string }) {
  const status = useInstrumentStatus(id);
  const progress = useInstrumentProgress(id);
  if (status === "loading") {
    const pct = progress === null ? null : Math.round(progress * 100);
    return (
      <>
        <span className="spinner" title="Carregando samples…" />
        {pct !== null && (
          <span className="mono small" aria-label={`Carregando ${pct}%`}>
            {pct}%
          </span>
        )}
      </>
    );
  }
  if (status === "error") return <span className="warn small" title="Falha ao carregar samples; usando synth">⚠</span>;
  return null;
}

function previewInstrument(id: string) {
  const s = useStore.getState();
  const chord = selectChord(s) ?? (() => {
    const ctx = selectCtx(s);
    const q = ctx?.degrees[0]?.primary ?? "maj";
    return makeChord(s.tonic ?? 0, q);
  })();
  void previewNotes(voiceChord(chord), id);
}

function Row({ def, id, selected, cursor, onPick }: { def: InstrumentDef; id: string; selected: boolean; cursor: boolean; onPick: (id: string) => void }) {
  const preview = (e: React.MouseEvent) => {
    e.stopPropagation();
    previewInstrument(def.id);
  };
  return (
    <div id={id} className={`inst-row ${cursor ? "active" : ""}`} role="option" aria-selected={selected} onClick={() => onPick(def.id)}>
      <button className="icon-btn" aria-label={`Ouvir ${def.name}`} onClick={preview}>▶</button>
      <span className="inst-name">
        {def.approximates && <span className="approx" title={`≈ ${def.name} — não existe no banco GM; usando ${def.approximates}`}>≈ </span>}
        {def.name}
        {def.polyphony === "mono" && <span className="muted small" title="Monofônico: acordes tocam em arpejo"> · arpejo</span>}
      </span>
      <StatusDot id={def.id} />
    </div>
  );
}

/** Seletor de instrumento (§3.9). `value`/`onChange` permitem uso por bloco. */
export function InstrumentPicker({ value, onChange, inheritLabel }: { value?: string; onChange?: (id: string | undefined) => void; inheritLabel?: string }) {
  const globalId = useStore((s) => s.song.instrument);
  const setInstrument = useStore((s) => s.setInstrument);
  const scaleId = useStore((s) => s.scaleId);
  const followScale = useStore((s) => s.followScale);
  const setFollowScale = useStore((s) => s.setFollowScale);
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");

  const perBlock = !!onChange;
  const current = perBlock ? value : globalId;
  const scale = getScale(scaleId);
  const suggestion = suggestionsFor(scale);

  const pick = (id: string | undefined) => {
    if (id) preload(id);
    if (perBlock) onChange!(id);
    else if (id) setInstrument(id);
    setOpen(false);
  };

  const groups = useMemo(() => {
    const q = normalize(query);
    const map = new Map<InstrumentCategory, InstrumentDef[]>();
    for (const d of INSTRUMENTS) {
      if (q && !normalize(d.name).includes(q)) continue;
      map.set(d.category, [...(map.get(d.category) ?? []), d]);
    }
    return [...map];
  }, [query]);

  // Opções navegáveis na ordem em que aparecem: herdar, sugeridos, categorias.
  const flat = useMemo(() => {
    const list: (string | undefined)[] = [];
    if (perBlock) list.push(undefined);
    if (!query) list.push(...suggestion.instruments);
    for (const [, defs] of groups) list.push(...defs.map((d) => d.id));
    return list;
  }, [perBlock, query, suggestion, groups]);
  const lb = useListbox({
    count: flat.length,
    open,
    initial: flat.indexOf(current),
    onChoose: (i) => pick(flat[i]),
    onPlay: (i) => flat[i] && previewInstrument(flat[i]),
  });
  let n = perBlock ? 1 : 0;
  const nextIndex = () => n++;

  const label = current ? getInstrumentDef(current).name : inheritLabel ?? "—";

  return (
    <div className="picker" ref={ref}>
      <button className={`picker-button ${perBlock ? "compact" : ""}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {!perBlock && <span className="picker-label">Instrumento</span>}
        <span className="picker-value">{current && getInstrumentDef(current).approximates ? "≈ " : ""}{label}</span>
        {current && <StatusDot id={current} />}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className={`popover inst-popover ${perBlock ? "align-left" : "align-right"}`}>
          <input
            className="search"
            placeholder="Buscar instrumento…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), lb.resetActive())}
            autoFocus
            {...lb.inputProps}
          />
          <div className="inst-list" role="listbox" id={lb.listId} aria-label="Instrumentos">
            {perBlock && (
              <div id={lb.optionId(0)} role="option" aria-selected={!current} className={`inst-row ${lb.active === 0 ? "active" : ""}`} onClick={() => pick(undefined)}>
                <span className="inst-name">↳ Herdar do global ({getInstrumentDef(globalId).name})</span>
              </div>
            )}
            {!query && (
              <div className="scale-group suggested">
                <div className="group-title">Sugeridos para {scale.name}</div>
                {suggestion.context && <div className="muted small pad-x">{suggestion.context}</div>}
                {suggestion.instruments.map((id) => {
                  const i = nextIndex();
                  return <Row key={`s-${id}`} def={getInstrumentDef(id)} id={lb.optionId(i)} selected={current === id} cursor={lb.active === i} onPick={pick} />;
                })}
                {!perBlock && (
                  <label className="check pad-x">
                    <input type="checkbox" checked={followScale} onChange={(e) => setFollowScale(e.target.checked)} />
                    Seguir a escala (trocar instrumento ao mudar de escala)
                  </label>
                )}
              </div>
            )}
            {groups.map(([cat, defs]) => (
              <div key={cat} className="scale-group">
                <div className="group-title">{CATEGORY_NAMES[cat]}</div>
                {defs.map((d) => {
                  const i = nextIndex();
                  return <Row key={d.id} def={d} id={lb.optionId(i)} selected={current === d.id} cursor={lb.active === i} onPick={pick} />;
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
