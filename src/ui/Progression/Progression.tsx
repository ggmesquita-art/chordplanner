import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getInstrumentDef } from "../../audio/instruments";
import { FUNCTION_NAME, harmonicFunction } from "../../core/analysis";
import { isRest, type Chord } from "../../core/chords";
import { chordSymbol } from "../../core/modifiers";
import { blockBpm, blockChordBeats, blockMeter, endingCut, expandArrangement, type PlaybackPattern } from "../../core/song";
import { GRIDS, METERS, barLinesWithin, formatPosition, gridBeats, meterLabel, missingBeats, stepDuration, type Grid, type Meter } from "../../core/timeline";
import { chordRole, chordStarts, chromaticTitle, droppedByChord, rulerMarks } from "../../core/view";
import { selectBlock, selectRegion, useStore } from "../../state/store";
import { NumberField } from "../NumberField";
import { previewChord, useBlock, useCtx, useSpeller } from "../hooks";
import { InstrumentPicker } from "../InstrumentPicker/InstrumentPicker";
import { TrackMixControls } from "../Melody/TrackMixControls";
import { DEFAULT_PX_PER_BEAT, GRID_LABEL, LANE_GUTTER_PX, laneTotalBeats } from "../Melody/timelineLayout";
import { PATTERNS } from "../patterns";
import { BlockKey } from "./BlockKey";
import { BlockPlayback } from "./BlockPlayback";
import { ResizeHandle } from "./ResizeHandle";

const EMPTY: Chord[] = [];

type Props = {
  pxPerBeat?: number;
  totalBeats?: number;
  leftGutter?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScrollSync?: (scrollLeft: number) => void;
  needleRef?: React.RefObject<HTMLDivElement | null>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

/** Régua do card: marca a cada tempo, marca forte + número nos compassos e ligadura nas barras internas. */
function Ruler({ start, duration, meter }: { start: number; duration: number; meter: Meter }) {
  const bpb = meter[0];
  const marks = rulerMarks(start, duration, bpb);
  const ties = barLinesWithin(start, duration, meter);
  return (
    <>
      <div className="chord-ruler" aria-hidden="true">
        {marks.map((m) => (
          <span key={m.at} className={`tick ${m.bar !== null ? "bar" : ""}`} style={{ left: `${(m.at / duration) * 100}%` }}>
            {m.bar !== null && <span className="bar-num">{m.bar}</span>}
          </span>
        ))}
        {ties.map((t) => (
          <span key={`t${t}`} className="tie" style={{ left: `${(t / duration) * 100}%` }}>
            ‿
          </span>
        ))}
      </div>
      <div className="chord-pos mono">{formatPosition(start, meter)}</div>
    </>
  );
}

/** Rola só a linha do tempo (horizontal) para manter o acorde tocando visível, sem mexer na página. */
function keepVisible(el: HTMLElement | null) {
  const scroller = (el?.closest(".timeline-scroll") as HTMLElement | null) ?? el?.parentElement;
  if (!el || !scroller) return;
  const left = el.offsetLeft;
  if (left < scroller.scrollLeft || left + el.offsetWidth > scroller.scrollLeft + scroller.clientWidth) {
    scroller.scrollTo?.({ left: Math.max(0, left - 16), behavior: "smooth" });
  }
}

export function Progression({
  pxPerBeat = DEFAULT_PX_PER_BEAT,
  totalBeats,
  leftGutter = false,
  scrollRef,
  onScrollSync,
  needleRef,
  collapsed,
  onToggleCollapse,
}: Props = {}) {
  const block = useBlock();
  const song = useStore((s) => s.song);
  const selectedItem = useStore((s) => s.selectedItem);
  const selectedChord = useStore((s) => s.selectedChord);
  const startWithSelected = useStore((s) => s.startWithSelected);
  const playhead = useStore((s) => s.playhead);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const tonic = useStore((s) => s.tonic);
  const midiEnabled = useStore((s) => s.midi.enabled);
  const midiChannel = useStore((s) => s.midi.channel);
  const expandedInStore = useStore((s) => s.dockPanels.progression);
  const isCollapsed = collapsed ?? !expandedInStore;
  const actions = useStore.getState();
  const toggleCollapse = onToggleCollapse ?? (() => actions.toggleDockPanel("progression"));
  const ctx = useCtx();
  const spell = useSpeller();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [live, setLive] = useState<{ id: string; beats: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const grid = useStore((s) => s.grid);
  const editEnding = useStore((s) => s.editEnding);
  const playScope = useStore((s) => s.playScope);
  // `selectEditChords` devolve [] novo sem casa 2: seleciona as listas estáveis e escolhe aqui.
  const rawEnding = useStore((s) => selectBlock(s)?.ending);
  const region = useStore(useShallow((s) => selectRegion(s)));

  const instrumentId = block?.instrument ?? song.instrument;
  const list = useMemo(() => (editEnding ? (rawEnding ?? EMPTY) : (block?.chords ?? EMPTY)), [editEnding, rawEnding, block?.chords]);
  const dropped = useMemo(() => {
    const def = getInstrumentDef(instrumentId);
    return droppedByChord(list, def.range);
  }, [list, instrumentId]);

  // O `playhead` guarda só `chordIndex`; se o evento tocando é da casa 2 (`inEnding`) vem da expansão que o
  // togglePlay tocou (mesma regra de escopo; escopo "região" nunca tem casa 2).
  const playingInEnding = useMemo(() => {
    if (!playhead || playScope === "region") return false;
    const events = expandArrangement(song, playScope === "block" ? [selectedItem] : undefined).events;
    return !!events[playhead.eventIndex]?.inEnding;
  }, [playhead, playScope, song, selectedItem]);

  // Refoca o card (pelo id) depois que mover/remover re-renderizou a lista.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = Array.from(timelineRef.current?.children ?? []).find((n) => (n as HTMLElement).dataset.chordId === id);
    (el as HTMLElement | undefined)?.focus();
  });

  if (!block) return null;
  const meter = blockMeter(song, block);
  const unit = gridBeats(grid, meter);
  const instrumentName = getInstrumentDef(instrumentId).name;
  const missing = missingBeats(blockChordBeats(block), meter);
  const isPlayingBlock = playhead && song.arrangement[playhead.itemIndex]?.blockId === block.id;
  const beats = totalBeats ?? laneTotalBeats(block, meter, editEnding);
  const chordEnd = list.reduce((sum, c) => sum + (live?.id === c.id ? live.beats : c.duration), 0);
  const trackBeats = Math.max(beats, chordEnd);
  const canvasWidth = trackBeats * pxPerBeat;
  const remainingBeats = Math.max(0, trackBeats - chordEnd);
  const hasMelody = editEnding ? !!block.melodyEnding?.length : !!block.melody?.length;

  const activate = (c: (typeof list)[number], shift: boolean) => {
    if (shift && useStore.getState().selectedChord) {
      actions.setRegionEnd(c.id);
      return;
    }
    actions.selectChord(c.id);
    if (!isRest(c)) previewChord(c);
  };

  // Em modo casa 2 a régua começa no último compasso do bloco.
  const cut = editEnding ? endingCut(block, meter) : 0;
  const starts = chordStarts(list).map((x) => x + cut);
  const endingAvailable = editEnding || !!block.ending?.length || song.arrangement.some((it) => it.blockId === block.id && it.repeat >= 2);

  const handleEmptyBeatClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetPx = Math.max(0, e.clientX - rect.left);
    const offsetBeats = offsetPx / pxPerBeat;
    const relStep = Math.floor((offsetBeats + 1e-9) / unit) * unit;
    const slotStart = chordEnd + relStep;
    if (slotStart > chordEnd + 1e-6) {
      actions.insertChordAtBeat(chordEnd, { rest: true, duration: Math.round((slotStart - chordEnd) * 64) / 64 });
    } else {
      actions.insertChordAtBeat(chordEnd, { rest: true, duration: unit });
    }
  };

  return (
    <section className={`progression ${isCollapsed ? "panel-collapsed" : ""}`} aria-label="Progressão">
      <div className="section-head wrap">
        <button
          type="button"
          className="icon-btn tiny panel-collapse-btn"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expandir Progressão" : "Recolher Progressão"}
          title={isCollapsed ? "Expandir painel de Progressão" : "Recolher painel de Progressão"}
          onClick={toggleCollapse}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
        <h2>
          Progressão <span className="muted">— bloco</span> <span style={{ color: block.color }}>“{block.name}”</span>
        </h2>
        {isCollapsed ? (
          <>
            {editEnding && <span className="mini-tag small">Casa 2</span>}
            <span className="muted small">
              {list.length} ac. · {blockBpm(song, block)} bpm · {meterLabel(meter)}
            </span>
            <div className="spacer" />
            <TrackMixControls track="chords" label="Acordes" />
          </>
        ) : (
          <div className="block-overrides small">
          <label className="field" title="BPM deste bloco (vazio = herda)">
            ♩
            <NumberField
              key={block.id}
              allowEmpty
              value={block.bpm}
              min={30}
              max={300}
              placeholder={String(song.bpm)}
              onCommit={(v) => actions.setBlockProps(block.id, { bpm: v })}
              aria-label="BPM do bloco"
            />
          </label>
          <select
            value={block.meter ? meterLabel(block.meter) : ""}
            onChange={(e) => actions.setBlockProps(block.id, { meter: e.target.value ? (METERS.find((m) => meterLabel(m) === e.target.value) as Meter) : undefined })}
            aria-label="Compasso do bloco"
          >
            <option value="">{meterLabel(song.meter)} (herdado)</option>
            {METERS.map((m) => (
              <option key={meterLabel(m)} value={meterLabel(m)}>
                {meterLabel(m)}
              </option>
            ))}
          </select>
          <select
            value={block.pattern ?? ""}
            onChange={(e) => actions.setBlockProps(block.id, { pattern: (e.target.value || undefined) as PlaybackPattern | undefined })}
            aria-label="Padrão de execução do bloco"
          >
            <option value="">{PATTERNS.find(([v]) => v === song.pattern)?.[1]} (herdado)</option>
            {PATTERNS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <InstrumentPicker
            value={block.instrument}
            onChange={(id) => actions.setBlockProps(block.id, { instrument: id })}
            inheritLabel={`${getInstrumentDef(song.instrument).name} (herdado)`}
          />
          {midiEnabled && (
            <select
              value={block.midiChannel ?? ""}
              onChange={(e) => actions.setBlockProps(block.id, { midiChannel: e.target.value ? Number(e.target.value) : undefined })}
              aria-label="Canal MIDI do bloco"
              title="Canal MIDI deste bloco"
            >
              <option value="">MIDI ch {midiChannel} (herdado)</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  MIDI ch {i + 1}
                </option>
              ))}
            </select>
          )}
          <span className="muted">
            {blockBpm(song, block)} bpm · {meterLabel(meter)}
          </span>
          <BlockPlayback key={block.id} blockId={block.id} />
          <BlockKey key={`k${block.id}`} blockId={block.id} />
        </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          <div className="prog-toolbar small">
        <label className="check" title="Marcado: ao definir a tônica, limpar ou criar um novo bloco, inicia automaticamente com o acorde da tônica. Desmarcado: começa vazio.">
          <input type="checkbox" checked={startWithSelected} onChange={(e) => actions.setStartWithSelected(e.target.checked)} />
          Iniciar com o acorde selecionado <span className="muted">(padrão: começa vazio)</span>
        </label>
        <label className="field" title="Unidade dos botões − / + e do arraste da borda do card">
          Grade
          <select
            value={String(grid)}
            onChange={(e) => actions.setGrid((e.target.value === "bar" ? "bar" : Number(e.target.value)) as Grid)}
            aria-label="Grade de edição"
          >
            {GRIDS.map((g) => (
              <option key={g} value={String(g)}>
                {GRID_LABEL[String(g)]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn small" onClick={() => actions.addRest()} title="Inserir respiro / silêncio harmônico (N.C.) — atalho: R">
          + Respiro (N.C.)
        </button>
        <TrackMixControls track="chords" label="Acordes" />
        {region && (
          <span className="region-chip">
            Região: acordes {region.from + 1}–{region.to + 1}
            <button className="icon-btn tiny" onClick={() => actions.setRegionEnd(null)} aria-label="Desfazer região" title="Desfazer região">
              ✕
            </button>
          </span>
        )}
        {endingAvailable ? (
          <div className="ending-toggle" role="group" aria-label="Lista em edição">
            <button className={`btn ${!editEnding ? "primary" : ""}`} aria-pressed={!editEnding} onClick={() => actions.setEditEnding(false)}>
              Acordes
            </button>
            <button className={`btn ${editEnding ? "primary" : ""}`} aria-pressed={editEnding} onClick={() => actions.setEditEnding(true)}>
              Casa 2
            </button>
          </div>
        ) : (
          <button className="btn ghost" title="Último compasso diferente na repetição (casa 1 / casa 2)" onClick={() => actions.setEditEnding(true)}>
            + Casa 2
          </button>
        )}
        <div className="spacer" />
        <button className="icon-btn" onClick={actions.undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
          ⟲
        </button>
        <button className="icon-btn" onClick={actions.redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
          ⟳
        </button>
        <button className="icon-btn" onClick={actions.clearBlock} title="Limpar bloco" aria-label="Limpar bloco">
          🗑
        </button>
      </div>

      {editEnding && (
        <div className="ending-bar small">
          <span>Casa 2 — substitui o último compasso na última repetição</span>
          {block.ending && (
            <button className="btn" onClick={actions.clearEnding}>
              Remover casa 2
            </button>
          )}
        </div>
      )}

      <div
        className="timeline-scroll"
        ref={scrollRef}
        onScroll={(e) => onScrollSync?.(e.currentTarget.scrollLeft)}
      >
        <div className="timeline-inner" style={{ width: `${(leftGutter ? LANE_GUTTER_PX : 0) + canvasWidth}px` }}>
          {leftGutter && (
            <div className="timeline-gutter small muted" style={{ width: `${LANE_GUTTER_PX}px` }} aria-hidden="true">
              Acordes
            </div>
          )}
          <div className="timeline-track" style={{ width: `${canvasWidth}px` }}>
            <div className="timeline-row">
              <div className={`timeline ${editEnding ? "ending-lane" : ""}`} role="list" ref={timelineRef}>
                {list.map((c, i) => {
                  const rest = isRest(c);
                  const start = starts[i];
                  const { inScale, chromatic, roman } = chordRole(ctx, c);
                  const fn = !rest && ctx ? harmonicFunction(ctx, c) : null;
                  const shown = live?.id === c.id ? live.beats : c.duration;
                  const pxWidth = shown * pxPerBeat;
                  const crosses = barLinesWithin(start, shown, meter).length > 0;
                  const inRegion = !!region && i >= region.from && i <= region.to;
                  const lost = rest ? 0 : (dropped.get(c.id) ?? 0);
                  const playing = isPlayingBlock && playhead?.chordIndex === i && playhead.itemIndex === selectedItem && playingInEnding === editEnding;
                  const sym = rest ? "N.C." : chordSymbol(c, spell);
                  return (
                    <div
                      key={c.id}
                      role="listitem"
                      data-chord-id={c.id}
                      aria-current={c.id === selectedChord ? "true" : undefined}
                      aria-keyshortcuts="Enter Space Shift+Enter ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Delete"
                      ref={playing ? keepVisible : undefined}
                      className={`chord-card ${c.id === selectedChord ? "selected" : ""} ${playing ? "playing" : ""} ${rest ? "rest" : !inScale ? (chromatic ? "chromatic" : "out") : ""} ${dragFrom === i ? "dragging" : ""} ${inRegion ? "in-region" : ""} ${crosses ? "crosses-bar" : ""} ${pxWidth < 96 ? "compact" : ""} ${pxWidth < 48 ? "micro" : ""}`}
                      style={{ width: `${pxWidth}px` }}
                      title={
                        rest
                          ? `Respiro harmônico (N.C.) · ${shown} tempos. Alt+←/→ move; arraste a borda para mudar a duração`
                          : `Shift+clique estende a seleção (região). Alt+←/→ move o acorde${crosses ? ". Atravessa a barra de compasso" : ""}`
                      }
                      draggable={live?.id !== c.id}
                      onDragStart={() => live?.id !== c.id && setDragFrom(i)}
                      onDragEnd={() => setDragFrom(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragFrom !== null) actions.moveChord(dragFrom, i);
                        setDragFrom(null);
                      }}
                      onClick={(e) => activate(c, e.shiftKey)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey) return;
                        const k = e.key;
                        const n = list.length;
                        const sibling = (d: number) => list[i + d];
                        if (k === "Enter" || k === " ") {
                          e.preventDefault();
                          e.stopPropagation(); // Espaço não aciona o play global
                          activate(c, e.shiftKey && k === "Enter");
                        } else if (k === "ArrowLeft" || k === "ArrowRight") {
                          e.preventDefault();
                          const d = k === "ArrowLeft" ? -1 : 1;
                          if (e.altKey) {
                            if (!sibling(d)) return;
                            pendingFocus.current = c.id;
                            actions.moveChord(i, i + d);
                            setAnnounce(`${sym} movido para a posição ${i + d + 1} de ${n}`);
                          } else {
                            const next = e.currentTarget[d < 0 ? "previousElementSibling" : "nextElementSibling"] as HTMLElement | null;
                            if (next?.classList.contains("chord-card")) next.focus();
                          }
                        } else if (k === "Delete" || k === "Backspace") {
                          e.preventDefault();
                          const nb = sibling(1) ?? sibling(-1);
                          pendingFocus.current = nb?.id ?? null;
                          actions.removeChord(c.id);
                        }
                      }}
                      aria-label={rest ? `Respiro (N.C.), ${shown} tempos` : `${sym}, ${roman}${fn ? `, ${FUNCTION_NAME[fn].toLowerCase()}` : ""}, ${shown} tempos`}
                    >
                      <div className="chord-top">
                        <span className="chord-symbol">{sym}</span>
                        {!rest &&
                          !inScale &&
                          (chromatic ? (
                            <span className="chromatic-mark" title={chromaticTitle(chromatic, false)}>
                              ◐
                            </span>
                          ) : (
                            <span className="warn" title="Fora da escala atual">
                              ⚠
                            </span>
                          ))}
                        {!rest && lost > 0 && (
                          <span
                            className="range-warn"
                            title={`${lost} nota${lost > 1 ? "s" : ""} fora da tessitura de ${instrumentName}: omitida${lost > 1 ? "s" : ""} na reprodução`}
                            aria-label={`${lost} nota${lost > 1 ? "s" : ""} fora da tessitura de ${instrumentName}: omitida${lost > 1 ? "s" : ""} na reprodução`}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      <div className="chord-roman">
                        {rest ? <span className="muted">pausa</span> : roman}
                        {fn && (
                          <span className="fn-badge" title={FUNCTION_NAME[fn]} aria-hidden="true">
                            {fn}
                          </span>
                        )}
                      </div>
                      <div className="chord-bottom" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn tiny"
                          disabled={stepDuration(c.duration, -1, unit) === c.duration}
                          onClick={() => actions.setDuration(c.id, stepDuration(c.duration, -1, unit))}
                          aria-label="Diminuir duração"
                        >
                          −
                        </button>
                        <span className="mono" title="Duração em tempos">
                          {shown}
                        </span>
                        <button className="icon-btn tiny" onClick={() => actions.setDuration(c.id, stepDuration(c.duration, 1, unit))} aria-label="Aumentar duração">
                          +
                        </button>
                        <span className="spacer" />
                        <button className="icon-btn tiny" onClick={() => actions.duplicateChord(c.id)} title="Duplicar" aria-label="Duplicar">
                          ⧉
                        </button>
                        <button className="icon-btn tiny danger" onClick={() => actions.removeChord(c.id)} title="Remover" aria-label="Remover">
                          ✕
                        </button>
                      </div>
                      <Ruler start={start} duration={shown} meter={meter} />
                      <ResizeHandle
                        label={sym}
                        duration={c.duration}
                        unit={unit}
                        onLive={(beatsVal) => setLive(beatsVal === null ? null : { id: c.id, beats: beatsVal })}
                        onCommit={(beatsVal) => actions.setDuration(c.id, beatsVal)}
                      />
                    </div>
                  );
                })}
              </div>

              {remainingBeats > 1e-6 && (
                <div
                  data-testid="empty-beats-lane"
                  className="empty-beats-lane"
                  style={
                    {
                      width: `${remainingBeats * pxPerBeat}px`,
                      "--px-beat": `${pxPerBeat}px`,
                      "--px-bar": `${meter[0] * pxPerBeat}px`,
                    } as React.CSSProperties
                  }
                  title="Clique num tempo vazio para preencher o vão com N.C. e posicionar o próximo acorde"
                  onClick={handleEmptyBeatClick}
                >
                  {!list.length && (
                    <div className="empty-hint muted">
                      {hasMelody
                        ? "Só melodia — clique na roda ou na faixa vazia para adicionar acordes / N.C."
                        : editEnding
                          ? "Clique nos acordes da roda para montar a casa 2."
                          : tonic === null
                            ? "Escolha a tônica (no topo ou clicando na roda) para começar."
                            : "Clique nos acordes liberados da roda para montar a progressão."}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div ref={needleRef} className="playhead-needle" aria-hidden="true" style={{ display: "none" }} />
          </div>
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      {!editEnding && missing > 0 && block.chords.length > 0 && (
        <div className="warn-bar small">
          ⚠ Compasso incompleto — faltam {missing} tempo{missing > 1 ? "s" : ""} para fechar o compasso em {meterLabel(meter)}.
          <button className="btn" onClick={actions.completeBar}>
            Completar
          </button>
        </div>
      )}
        </>
      )}
    </section>
  );
}
