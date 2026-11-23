import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { previewNotes } from "../../audio/engine";
import { getInstrumentDef } from "../../audio/instruments";
import {
  autoHarmonize,
  chordAtBeat,
  melodyNoteRelation,
  type MelodyRelation,
} from "../../core/harmonize";
import {
  DEFAULT_MELODY_INSTRUMENT,
  MELODY_DEFAULT_HIGH,
  MELODY_MAX_DURATION,
  MELODY_MAX_MIDI,
  MELODY_MIN_DURATION,
  MELODY_MIN_MIDI,
  isPitchInScale,
  scalePitchesInRange,
  type MelodyNote,
} from "../../core/melody";
import { mod12 } from "../../core/pitch";
import { blockBeats, blockMeter, endingCut } from "../../core/song";
import { GRIDS, gridBeats, snapDuration, stepDuration, type Grid } from "../../core/timeline";
import { selectEditChords, useStore } from "../../state/store";
import { InstrumentPicker } from "../InstrumentPicker/InstrumentPicker";
import { stopPlayback, togglePlay, useBlock, useCtx, useSpeller } from "../hooks";
import {
  DEFAULT_PX_PER_BEAT,
  GRID_LABEL,
  LANE_GUTTER_PX,
  MELODY_COMPACT_ROW_H,
  MELODY_ROW_H,
  compactMelodyRows,
  laneTotalBeats,
  midiNoteLabel,
  snapStartBeat,
} from "./timelineLayout";
import { TrackMixControls } from "./TrackMixControls";

const EMPTY: MelodyNote[] = [];
const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
const REL_LABEL: Record<MelodyRelation, string> = {
  "chord-tone": "nota do acorde",
  tension: "tensão compatível",
  passing: "nota de passagem",
  nc: "sobre N.C.",
};

type Props = {
  pxPerBeat?: number;
  totalBeats?: number;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScrollSync?: (scrollLeft: number) => void;
  needleRef?: React.RefObject<HTMLDivElement | null>;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  focusMelody?: boolean;
  onToggleFocusMelody?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

type DragState = {
  id: string;
  kind: "move" | "resize";
  pointerId: number;
  el: HTMLElement;
  startX: number;
  startY: number;
  origPitch: number;
  origStart: number;
  origDuration: number;
  pitch: number;
  start: number;
  duration: number;
  moved: boolean;
};

/** Camada 2: piano roll monofônico da melodia, alinhado tempo a tempo com os acordes abaixo. */
export function MelodyTrack({
  pxPerBeat = DEFAULT_PX_PER_BEAT,
  totalBeats,
  scrollRef,
  onScrollSync,
  needleRef,
  onZoomIn,
  onZoomOut,
  focusMelody = false,
  onToggleFocusMelody,
  collapsed,
  onToggleCollapse,
}: Props) {
  const block = useBlock();
  const song = useStore((s) => s.song);
  const mode = useStore((s) => s.mode);
  const editEnding = useStore((s) => s.editEnding);
  const melodyGrid = useStore((s) => s.melodyGrid);
  const melodyCompact = useStore((s) => s.melodyCompact);
  const expandedInStore = useStore((s) => s.dockPanels.melody);
  const isCollapsed = collapsed ?? !expandedInStore;
  const grid = useStore((s) => s.grid);
  const playing = useStore((s) => s.playing);
  const selectedMelodyNote = useStore((s) => s.selectedMelodyNote);
  const soundOnClick = useStore((s) => s.soundOnClick);
  const midi = useStore((s) => s.midi);
  const midiEnabled = midi.enabled;
  const midiMelodyChannel = midi.melodyChannel;
  const editChords = useStore(selectEditChords);
  const actions = useStore.getState();
  const ctx = useCtx();
  const spell = useSpeller();
  const [harmonizeConfirm, setHarmonizeConfirm] = useState(false);

  const localScrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const stopEscRef = useRef<(() => void) | null>(null);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  const [liveDrag, setLiveDrag] = useState<{
    id: string;
    pitch: number;
    start: number;
    duration: number;
  } | null>(null);

  const notes = useMemo(
    () => (editEnding ? (block?.melodyEnding ?? EMPTY) : (block?.melody ?? EMPTY)),
    [editEnding, block?.melodyEnding, block?.melody],
  );

  const toggleCollapse = onToggleCollapse ?? (() => actions.toggleDockPanel("melody"));

  const outOfScalePitches = useMemo(
    () => (ctx ? notes.filter((n) => !isPitchInScale(n.pitch, ctx)).map((n) => n.pitch) : []),
    [ctx, notes],
  );

  const allRows = useMemo(
    () => scalePitchesInRange(mode === "strict" ? ctx : null, MELODY_MIN_MIDI, MELODY_MAX_MIDI, outOfScalePitches),
    [mode, ctx, outOfScalePitches],
  );
  const rows = useMemo(() => (melodyCompact ? compactMelodyRows(allRows, notes) : allRows), [melodyCompact, allRows, notes]);
  const rowH = melodyCompact ? MELODY_COMPACT_ROW_H : MELODY_ROW_H;

  useImperativeHandle(scrollRef, () => localScrollRef.current as HTMLDivElement);

  // Posiciona o scroll vertical inicialmente na janela padrão C4–C6 (ou nas notas existentes no modo compacto).
  useEffect(() => {
    if (isCollapsed) return;
    const sc = localScrollRef.current;
    if (!sc) return;
    if (melodyCompact) {
      if (notes.length > 0) {
        const maxP = Math.max(...notes.map((n) => n.pitch));
        const idx = rows.findIndex((p) => p <= maxP);
        sc.scrollTop = idx >= 0 ? Math.max(0, (idx - 1) * rowH) : 0;
      } else {
        sc.scrollTop = 0;
      }
      return;
    }
    const topIdx = rows.findIndex((p) => p <= MELODY_DEFAULT_HIGH);
    if (topIdx >= 0) sc.scrollTop = Math.max(0, topIdx * rowH - 4);
  }, [block?.id, mode, melodyCompact, isCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restaura foco na nota após remoção por teclado, quando houver vizinha.
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    const el = canvasRef.current?.querySelector<HTMLElement>(`[data-melody-id="${id}"]`);
    el?.focus();
  });

  // Limpa arrasto pendente se desmontar.
  useEffect(
    () => () => {
      dragRef.current = null;
      stopEscRef.current?.();
      stopEscRef.current = null;
      if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
    },
    [],
  );

  if (!block) return null;

  const meter = blockMeter(song, block);
  const bpb = meter[0];
  const melodyUnit = gridBeats(melodyGrid, meter);
  const beats = totalBeats ?? laneTotalBeats(block, meter, editEnding);
  const canvasWidth = beats * pxPerBeat;
  const cut = editEnding ? endingCut(block, meter) : 0;
  const globalMelodyInst = song.melodyInstrument ?? DEFAULT_MELODY_INSTRUMENT;
  const effectiveInst = block.melodyInstrument ?? globalMelodyInst;
  const outOfScaleCount = outOfScalePitches.length;
  const liveRecActive = playing && midi.inputRecord && midi.inputRecordTarget === "melody-live";

  if (isCollapsed) {
    return (
      <section className={`melody-track panel-collapsed ${editEnding ? "ending-lane" : ""}`} aria-label="Melodia">
        <div className="section-head melody-head">
          <button
            type="button"
            className="icon-btn tiny panel-collapse-btn"
            aria-expanded={false}
            aria-label="Expandir Melodia"
            title="Expandir painel de Melodia"
            onClick={toggleCollapse}
          >
            ▸
          </button>
          <h2>
            Melodia <span className="muted">— bloco</span> <span style={{ color: block.color }}>“{block.name}”</span>
          </h2>
          {editEnding && <span className="mini-tag small">Casa 2</span>}
          <span className="muted small">
            {notes.length} {notes.length === 1 ? "nota" : "notas"} · {getInstrumentDef(effectiveInst).name}
          </span>
          <div className="spacer" />
          <TrackMixControls track="melody" label="Melodia" />
        </div>
      </section>
    );
  }

  const runAutoHarmonize = (harmonizeMode: "fill" | "replace") => {
    if (!ctx || !notes.length) return;
    const harmonized = autoHarmonize({
      melody: notes,
      ctx,
      meter,
      stepBeats: gridBeats(grid, meter),
      existingChords: editChords,
      mode: harmonizeMode,
    });
    actions.setBlockChords(harmonized);
    setHarmonizeConfirm(false);
  };

  const toggleLiveRecord = () => {
    if (liveRecActive) {
      stopPlayback();
      actions.setMidi({ inputRecord: false });
      return;
    }
    actions.setMetronome(true);
    actions.setCountIn(true);
    actions.setMidi({ inputRecord: true, inputRecordTarget: "melody-live" });
    if (blockBeats(block) <= 0) actions.addRest(meter[0] * 4);
    actions.setPlayScope("block");
    void togglePlay();
  };

  const barMarks: { left: number; bar: number }[] = [];
  for (let b = 0; b < beats; b += bpb) {
    barMarks.push({ left: b * pxPerBeat, bar: Math.floor((cut + b) / bpb) + 1 });
  }

  const finishDrag = (commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    stopEscRef.current?.();
    stopEscRef.current = null;
    if (d.el.hasPointerCapture?.(d.pointerId)) {
      d.el.releasePointerCapture(d.pointerId);
    }
    setLiveDrag(null);
    if (!commit) return;

    if (d.moved) {
      suppressClickRef.current = true;
      if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      if (d.kind === "move") {
        if (d.pitch !== d.origPitch || Math.abs(d.start - d.origStart) > 1e-6) {
          actions.updateMelodyNote(d.id, { pitch: d.pitch, start: d.start });
        }
        actions.selectMelodyNote(d.id);
      } else if (Math.abs(d.duration - d.origDuration) > 1e-6) {
        actions.updateMelodyNote(d.id, { duration: d.duration });
      }
    } else if (d.kind === "move") {
      actions.selectMelodyNote(d.id);
    }
  };

  const attachEsc = () => {
    stopEscRef.current?.();
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finishDrag(false);
    };
    window.addEventListener("keydown", onEsc, true);
    stopEscRef.current = () => window.removeEventListener("keydown", onEsc, true);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if ((e.target as HTMLElement).closest(".melody-note")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !rows.length) return;
    const rawBeat = (e.clientX - rect.left) / pxPerBeat;
    const rawRow = Math.floor((e.clientY - rect.top) / rowH);
    const rowIdx = Math.max(0, Math.min(rows.length - 1, rawRow));
    const pitch = rows[rowIdx];
    if (pitch === undefined) return;
    const start = snapStartBeat(rawBeat, melodyUnit);
    const created = actions.upsertMelodyNote({ pitch, start, duration: melodyUnit });
    if (created && soundOnClick) {
      void previewNotes([created.pitch], effectiveInst, { seconds: 0.35, track: "melody" });
    }
  };

  return (
    <section className={`melody-track ${melodyCompact ? "melody-compact" : ""} ${editEnding ? "ending-lane" : ""}`} aria-label="Melodia">
      <div className="section-head melody-head wrap">
        <button
          type="button"
          className="icon-btn tiny panel-collapse-btn"
          aria-expanded={true}
          aria-label="Recolher Melodia"
          title="Recolher painel de Melodia"
          onClick={toggleCollapse}
        >
          ▾
        </button>
        <h2>
          Melodia <span className="muted">— bloco</span> <span style={{ color: block.color }}>“{block.name}”</span>
        </h2>
        {editEnding && <span className="mini-tag small">Casa 2</span>}
        <InstrumentPicker
          value={block.melodyInstrument}
          inheritGlobalId={globalMelodyInst}
          inheritLabel={`${getInstrumentDef(globalMelodyInst).name} (herdado)`}
          previewTrack="melody"
          onChange={(id) => actions.setBlockProps(block.id, { melodyInstrument: id })}
        />
        {block.melodyInstrument && block.melodyInstrument !== globalMelodyInst && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              actions.setMelodyInstrument(block.melodyInstrument!);
              actions.setBlockProps(block.id, { melodyInstrument: undefined });
            }}
            title="Definir este timbre como padrão global da melodia"
          >
            ★ Padrão
          </button>
        )}
        {midiEnabled && (
          <select
            value={block.melodyMidiChannel ?? ""}
            onChange={(e) => actions.setBlockProps(block.id, { melodyMidiChannel: e.target.value ? Number(e.target.value) : undefined })}
            aria-label="Canal MIDI da melodia"
            title="Canal MIDI da melodia deste bloco"
          >
            <option value="">MIDI mel. ch {midiMelodyChannel} (herdado)</option>
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                MIDI ch {i + 1}
              </option>
            ))}
          </select>
        )}
        <label className="field small" title="Unidade de quantização e duração padrão ao clicar na melodia">
          Grade
          <select
            value={String(melodyGrid)}
            onChange={(e) => actions.setMelodyGrid((e.target.value === "bar" ? "bar" : Number(e.target.value)) as Grid)}
            aria-label="Grade da melodia"
          >
            {GRIDS.map((g) => (
              <option key={g} value={String(g)}>
                {GRID_LABEL[String(g)]}
              </option>
            ))}
          </select>
        </label>
        <TrackMixControls track="melody" label="Melodia" />
        {(onZoomOut || onZoomIn) && (
          <div className="zoom-controls" role="group" aria-label="Zoom horizontal">
            <button
              type="button"
              className="icon-btn tiny"
              onClick={onZoomOut}
              disabled={!onZoomOut}
              aria-label="Diminuir zoom da linha do tempo"
              title="Diminuir zoom horizontal"
            >
              −
            </button>
            <span className="mono muted small" title="Escala horizontal em pixels por tempo">
              {Math.round(pxPerBeat)}px
            </span>
            <button
              type="button"
              className="icon-btn tiny"
              onClick={onZoomIn}
              disabled={!onZoomIn}
              aria-label="Aumentar zoom da linha do tempo"
              title="Aumentar zoom horizontal"
            >
              +
            </button>
          </div>
        )}
        {ctx && outOfScaleCount > 0 && (
          <button
            type="button"
            className="btn small warn-btn"
            onClick={actions.snapBlockMelodyToScale}
            title="Move notas fora da escala atual para a nota vizinha pertencente à escala"
          >
            ⚠ Ajustar à escala ({outOfScaleCount})
          </button>
        )}
        {ctx && notes.length > 0 && (
          editChords.length > 0 && harmonizeConfirm ? (
            <span className="harmonize-confirm">
              <button type="button" className="btn small primary" onClick={() => runAutoHarmonize("fill")}>
                Preencher vazios
              </button>
              <button type="button" className="btn small" onClick={() => runAutoHarmonize("replace")}>
                Substituir tudo
              </button>
              <button type="button" className="btn small" onClick={() => setHarmonizeConfirm(false)}>
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn small"
              onClick={() => (editChords.length > 0 ? setHarmonizeConfirm(true) : runAutoHarmonize("replace"))}
              title="Sugere e cria acordes compatíveis com a melodia na grade harmônica atual"
            >
              ✨ Auto-harmonizar
            </button>
          )
        )}
        {midi.inputEnabled && (
          <button
            type="button"
            className={`btn small ${liveRecActive ? "rec-active" : ""}`}
            aria-pressed={liveRecActive}
            onClick={toggleLiveRecord}
            title="Grava a melodia ao vivo pelo teclado MIDI com contagem e metrônomo"
          >
            ● Gravar
          </button>
        )}
        <div className="spacer" />
        <button
          type="button"
          className={`btn small ${melodyCompact ? "primary" : ""}`}
          aria-pressed={melodyCompact}
          aria-label={melodyCompact ? "Sair do modo compacto da melodia" : "Modo compacto da melodia"}
          onClick={() => {
            const next = !melodyCompact;
            actions.setMelodyCompact(next);
            if (next && focusMelody && onToggleFocusMelody) onToggleFocusMelody();
          }}
          title={melodyCompact ? "Voltar ao piano roll completo da melodia" : "Modo compacto: reduz altura e ajusta a faixa às notas da melodia"}
        >
          {melodyCompact ? "↕ Normal" : "↕ Compacto"}
        </button>
        {onToggleFocusMelody && (
          <button
            type="button"
            className="btn small"
            aria-pressed={focusMelody}
            onClick={() => {
              if (!focusMelody && melodyCompact) actions.setMelodyCompact(false);
              onToggleFocusMelody();
            }}
            title={focusMelody ? "Restaurar visualização das 3 camadas" : "Ampliar melodia ocultando a barra do arranjo"}
          >
            {focusMelody ? "⤡ Restaurar" : "⤢ Focar"}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={actions.clearMelody}
          disabled={!notes.length}
          title="Limpar melodia"
          aria-label="Limpar melodia"
        >
          🗑
        </button>
      </div>

      <div
        className="melody-scroll"
        ref={localScrollRef}
        onScroll={(e) => onScrollSync?.(e.currentTarget.scrollLeft)}
      >
        <div className="melody-grid-inner" style={{ width: `${LANE_GUTTER_PX + canvasWidth}px` }}>
          <div className="melody-ruler-row">
            <div className="melody-corner mono small muted" style={{ width: `${LANE_GUTTER_PX}px` }} aria-hidden="true">
              ♩
            </div>
            <div
              className="melody-ruler"
              aria-hidden="true"
              style={
                {
                  width: `${canvasWidth}px`,
                  "--px-beat": `${pxPerBeat}px`,
                  "--px-bar": `${bpb * pxPerBeat}px`,
                } as React.CSSProperties
              }
            >
              {barMarks.map((m) => (
                <span key={m.bar} className="melody-bar-mark mono" style={{ left: `${m.left}px` }}>
                  {m.bar}
                </span>
              ))}
            </div>
          </div>

          <div className="melody-body-row">
            <div className="melody-axis" style={{ width: `${LANE_GUTTER_PX}px` }} aria-hidden="true">
              {rows.map((m) => {
                const isTonic = ctx !== null && mod12(m) === ctx.tonic;
                const out = ctx !== null && !isPitchInScale(m, ctx);
                const isBlack = BLACK_PCS.has(mod12(m));
                return (
                  <div
                    key={m}
                    data-pitch={m}
                    className={`melody-axis-row mono ${isTonic ? "is-tonic" : ""} ${out ? "out-of-scale" : ""} ${isBlack ? "is-black" : ""}`}
                    style={{ height: `${rowH}px` }}
                    title={out ? "Fora da escala atual" : undefined}
                    onClick={() => soundOnClick && void previewNotes([m], effectiveInst, { seconds: 0.35, track: "melody" })}
                  >
                    <span>{midiNoteLabel(m, spell)}</span>
                    {out && <span className="warn">⚠</span>}
                  </div>
                );
              })}
            </div>

            <div
              ref={canvasRef}
              data-testid="melody-canvas"
              className="melody-canvas"
              style={
                {
                  width: `${canvasWidth}px`,
                  height: `${rows.length * rowH}px`,
                  "--px-beat": `${pxPerBeat}px`,
                  "--px-bar": `${bpb * pxPerBeat}px`,
                  "--row-h": `${rowH}px`,
                } as React.CSSProperties
              }
              onClick={handleCanvasClick}
            >
              {rows.map((m) => {
                const isTonic = ctx !== null && mod12(m) === ctx.tonic;
                const out = ctx !== null && !isPitchInScale(m, ctx);
                const isBlack = BLACK_PCS.has(mod12(m));
                return (
                  <div
                    key={m}
                    aria-hidden="true"
                    className={`melody-row ${isTonic ? "is-tonic" : ""} ${out ? "out-of-scale" : "in-scale"} ${isBlack ? "is-black" : ""}`}
                    style={{ height: `${rowH}px` }}
                  />
                );
              })}

              {notes.map((n, noteIdx) => {
                const dragging = liveDrag?.id === n.id ? liveDrag : null;
                const pitch = dragging ? dragging.pitch : n.pitch;
                const start = dragging ? dragging.start : n.start;
                const duration = dragging ? dragging.duration : n.duration;
                const rowIdx = rows.indexOf(pitch);
                if (rowIdx < 0) return null;
                const out = ctx !== null && !isPitchInScale(pitch, ctx);
                const activeChord = chordAtBeat(editChords, start);
                const rel = melodyNoteRelation(pitch, activeChord?.chord ?? null, ctx);
                const label = midiNoteLabel(pitch, spell);
                const selected = selectedMelodyNote === n.id;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    data-melody-id={n.id}
                    aria-pressed={selected}
                    aria-label={`Nota ${label}, tempo ${start + 1}, duração ${duration}${out ? ", fora da escala" : ""}`}
                    className={`melody-note ${out ? "out-of-scale" : `rel-${rel}`} ${selected ? "selected" : ""}`}
                    style={{
                      left: `${start * pxPerBeat}px`,
                      width: `${Math.max(10, duration * pxPerBeat - 1)}px`,
                      top: `${rowIdx * rowH + 1}px`,
                      height: `${rowH - 2}px`,
                    }}
                    title={`${label} · ${out ? "fora da escala" : REL_LABEL[rel]} · início ${start + 1} · ${duration} tempos (clique direito ou Delete remove; arraste para mover)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      actions.selectMelodyNote(n.id);
                      if (soundOnClick) void previewNotes([pitch], effectiveInst, { seconds: 0.35, track: "melody" });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      actions.removeMelodyNote(n.id);
                    }}
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse" && e.button !== 0) return;
                      if ((e.target as HTMLElement).closest(".melody-note-resize")) return;
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                      dragRef.current = {
                        id: n.id,
                        kind: "move",
                        pointerId: e.pointerId,
                        el: e.currentTarget,
                        startX: e.clientX,
                        startY: e.clientY,
                        origPitch: n.pitch,
                        origStart: n.start,
                        origDuration: n.duration,
                        pitch: n.pitch,
                        start: n.start,
                        duration: n.duration,
                        moved: false,
                      };
                      attachEsc();
                    }}
                    onPointerMove={(e) => {
                      const d = dragRef.current;
                      if (!d || d.id !== n.id || d.kind !== "move") return;
                      const dx = e.clientX - d.startX;
                      const dy = e.clientY - d.startY;
                      if (!d.moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
                      d.moved = true;
                      const deltaBeats = dx / pxPerBeat;
                      const nextStart = Math.max(0, Math.round(Math.round((d.origStart + deltaBeats) / melodyUnit) * melodyUnit * 64) / 64);
                      const origRowIdx = rows.indexOf(d.origPitch);
                      const nextRowIdx = Math.max(0, Math.min(rows.length - 1, origRowIdx + Math.round(dy / rowH)));
                      const nextPitch = rows[nextRowIdx] ?? d.origPitch;
                      if (nextPitch !== d.pitch && soundOnClick) {
                        void previewNotes([nextPitch], effectiveInst, { seconds: 0.25, track: "melody" });
                      }
                      d.pitch = nextPitch;
                      d.start = nextStart;
                      setLiveDrag({ id: n.id, pitch: nextPitch, start: nextStart, duration: d.origDuration });
                    }}
                    onPointerUp={() => finishDrag(true)}
                    onPointerCancel={() => finishDrag(false)}
                    onLostPointerCapture={() => finishDrag(false)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey || e.metaKey || e.altKey) return;
                      const k = e.key;
                      if (k === "ArrowUp" || k === "ArrowDown") {
                        e.preventDefault();
                        const dir = k === "ArrowUp" ? -1 : 1;
                        const nextIdx = Math.max(0, Math.min(rows.length - 1, rowIdx + dir));
                        const nextPitch = rows[nextIdx];
                        if (nextPitch !== undefined && nextPitch !== n.pitch) {
                          actions.updateMelodyNote(n.id, { pitch: nextPitch });
                          if (soundOnClick) void previewNotes([nextPitch], effectiveInst, { seconds: 0.35, track: "melody" });
                        }
                      } else if (k === "ArrowLeft" || k === "ArrowRight") {
                        e.preventDefault();
                        const dir = k === "ArrowLeft" ? -1 : 1;
                        if (e.shiftKey) {
                          const nextDur = Math.max(MELODY_MIN_DURATION, stepDuration(n.duration, dir, melodyUnit));
                          if (nextDur !== n.duration) actions.updateMelodyNote(n.id, { duration: nextDur });
                        } else {
                          const nextStart = Math.max(0, Math.round((n.start + dir * melodyUnit) * 64) / 64);
                          if (nextStart !== n.start) actions.updateMelodyNote(n.id, { start: nextStart });
                        }
                      } else if (k === "Delete" || k === "Backspace") {
                        e.preventDefault();
                        const nb = notes[noteIdx + 1] ?? notes[noteIdx - 1];
                        pendingFocusRef.current = nb?.id ?? null;
                        actions.removeMelodyNote(n.id);
                      } else if (k === "Enter") {
                        e.preventDefault();
                        actions.selectMelodyNote(n.id);
                        if (soundOnClick) void previewNotes([pitch], effectiveInst, { seconds: 0.35, track: "melody" });
                      } else if (k === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        actions.selectMelodyNote(n.id);
                        void previewNotes([pitch], effectiveInst, { seconds: 0.35, track: "melody" });
                      }
                    }}
                  >
                    <span className="melody-note-label mono">
                      {label}
                      {out ? " ⚠" : ""}
                    </span>
                    <span
                      className="melody-note-resize"
                      aria-hidden="true"
                      onPointerDown={(e) => {
                        if (e.pointerType === "mouse" && e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        e.currentTarget.setPointerCapture?.(e.pointerId);
                        dragRef.current = {
                          id: n.id,
                          kind: "resize",
                          pointerId: e.pointerId,
                          el: e.currentTarget,
                          startX: e.clientX,
                          startY: e.clientY,
                          origPitch: n.pitch,
                          origStart: n.start,
                          origDuration: n.duration,
                          pitch: n.pitch,
                          start: n.start,
                          duration: n.duration,
                          moved: false,
                        };
                        attachEsc();
                      }}
                      onPointerMove={(e) => {
                        const d = dragRef.current;
                        if (!d || d.id !== n.id || d.kind !== "resize") return;
                        const dx = e.clientX - d.startX;
                        if (!d.moved && Math.abs(dx) <= 2) return;
                        d.moved = true;
                        const nextDur = Math.max(
                          MELODY_MIN_DURATION,
                          Math.min(MELODY_MAX_DURATION, snapDuration(d.origDuration + dx / pxPerBeat, melodyUnit)),
                        );
                        if (nextDur !== d.duration) {
                          d.duration = nextDur;
                          setLiveDrag({ id: n.id, pitch: d.origPitch, start: d.origStart, duration: nextDur });
                        }
                      }}
                      onPointerUp={() => finishDrag(true)}
                      onPointerCancel={() => finishDrag(false)}
                      onLostPointerCapture={() => finishDrag(false)}
                    />
                  </div>
                );
              })}

              <div ref={needleRef} className="playhead-needle" aria-hidden="true" style={{ display: "none" }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
