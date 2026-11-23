import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { preload, previewNotes } from "../../audio/engine";
import { CATEGORY_NAMES, INSTRUMENTS, getInstrumentDef, type InstrumentCategory, type InstrumentDef } from "../../audio/instruments";
import { suggestionsFor } from "../../audio/scaleInstruments";
import type { TrackBus } from "../../audio/status";
import { getScale } from "../../core/scales";
import { previewChordNotes } from "../../core/view";
import { selectBlockCtx, selectChord, useStore } from "../../state/store";
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

function previewInstrument(id: string, track?: TrackBus) {
  const s = useStore.getState();
  const notes = previewChordNotes(selectChord(s), selectBlockCtx(s)?.tonic ?? null, selectBlockCtx(s));
  if (track) void previewNotes(notes, id, { track });
  else void previewNotes(notes, id);
}

function Row({
  def,
  id,
  selected,
  cursor,
  onPick,
  previewTrack,
}: {
  def: InstrumentDef;
  id: string;
  selected: boolean;
  cursor: boolean;
  onPick: (id: string) => void;
  previewTrack?: TrackBus;
}) {
  const preview = (e: React.MouseEvent) => {
    e.stopPropagation();
    previewInstrument(def.id, previewTrack);
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
export function InstrumentPicker({
  value,
  onChange,
  inheritLabel,
  inheritGlobalId,
  previewTrack,
}: {
  value?: string;
  onChange?: (id: string | undefined) => void;
  inheritLabel?: string;
  inheritGlobalId?: string;
  previewTrack?: TrackBus;
}) {
  const globalId = useStore((s) => s.song.instrument);
  const effectiveGlobalId = inheritGlobalId ?? globalId;
  const setInstrument = useStore((s) => s.setInstrument);
  const scaleId = useStore((s) => s.scaleId);
  const followScale = useStore((s) => s.followScale);
  const setFollowScale = useStore((s) => s.setFollowScale);
  const { open, setOpen, ref, popoverRef } = usePopover();
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});

  const perBlock = !!onChange;

  useLayoutEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const pad = 8;
      const width = Math.min(360, Math.max(240, vw - pad * 2));
      const rawLeft = perBlock ? rect.left : rect.right - width;
      const left = Math.max(pad, Math.min(vw - width - pad, rawLeft));
      const spaceAbove = Math.max(0, rect.top - pad - 6);
      const spaceBelow = Math.max(0, vh - rect.bottom - pad - 6);
      const openUp = perBlock ? spaceAbove >= 220 || spaceAbove >= spaceBelow : spaceBelow < 220 && spaceAbove > spaceBelow;
      const availH = openUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(180, Math.min(Math.round(vh * 0.65), Math.floor(availH)));
      setPos({
        position: "fixed",
        left: `${Math.round(left)}px`,
        width: `${Math.round(width)}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: 95,
        ...(openUp
          ? { top: "auto", bottom: `${Math.round(vh - rect.top + 6)}px` }
          : { top: `${Math.round(rect.bottom + 6)}px`, bottom: "auto" }),
      });
    };
    updatePos();
    const onScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && popoverRef.current?.contains(t)) return;
      updatePos();
    };
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, perBlock, popoverRef]);
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
    onPlay: (i) => flat[i] && previewInstrument(flat[i], previewTrack),
  });
  let n = perBlock ? 1 : 0;
  const nextIndex = () => n++;

  const label = current ? getInstrumentDef(current).name : inheritLabel ?? "—";

  return (
    <div className={`picker ${perBlock ? "" : "inst-picker"}`} ref={ref}>
      <button
        ref={btnRef}
        className={`picker-button ${perBlock ? "compact" : ""}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {!perBlock && <span className="picker-label">Instrumento</span>}
        <span className="picker-value">{current && getInstrumentDef(current).approximates ? "≈ " : ""}{label}</span>
        {current && <StatusDot id={current} />}
        <span aria-hidden>▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={`popover inst-popover inst-popover-portal ${perBlock ? "align-left" : "align-right"}`}
            style={pos}
            data-popover-portal="instrument"
            data-popover-owner={perBlock ? "dock" : "topbar"}
          >
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
                  <span className="inst-name">↳ Herdar do global ({getInstrumentDef(effectiveGlobalId).name})</span>
                </div>
              )}
              {!query && (
                <div className="scale-group suggested">
                  <div className="group-title">Sugeridos para {scale.name}</div>
                  {suggestion.context && <div className="muted small pad-x">{suggestion.context}</div>}
                  {suggestion.instruments.map((id) => {
                    const i = nextIndex();
                    return <Row key={`s-${id}`} def={getInstrumentDef(id)} id={lb.optionId(i)} selected={current === id} cursor={lb.active === i} onPick={pick} previewTrack={previewTrack} />;
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
                    return <Row key={d.id} def={d} id={lb.optionId(i)} selected={current === d.id} cursor={lb.active === i} onPick={pick} previewTrack={previewTrack} />;
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
