import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getPlaybackTime } from "../../audio/status";
import { isRest } from "../../core/chords";
import { chordSymbol } from "../../core/modifiers";
import { blockMeter, endingCut, expandArrangement, expandRegion, playbackBeatAtSec } from "../../core/song";
import { arrangementLayout } from "../../core/view";
import { selectBlock, selectRegion, useStore } from "../../state/store";
import { Arrangement } from "../Arrangement/Arrangement";
import { MelodyTrack } from "../Melody/MelodyTrack";
import { DEFAULT_PX_PER_BEAT, LANE_GUTTER_PX, fitPxPerBeat, laneTotalBeats, nextZoom } from "../Melody/timelineLayout";
import { Progression } from "../Progression/Progression";
import { useSpeller } from "../hooks";

/** Painel inferior de 3 camadas: Arranjo → Melodia → Acordes, com divisor arrastável e agulha contínua. */
export function Dock() {
  const song = useStore((s) => s.song);
  const selectedItem = useStore((s) => s.selectedItem);
  const block = useStore((s) => selectBlock(s));
  const melodyVisible = useStore((s) => s.melodyVisible);
  const timelineFit = useStore((s) => s.timelineFit);
  const dockPanels = useStore((s) => s.dockPanels);
  const editEnding = useStore((s) => s.editEnding);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const playScope = useStore((s) => s.playScope);
  const region = useStore(useShallow((s) => (s.playScope === "region" ? selectRegion(s) : null)));
  const { setDock, setMelodyVisible, setTimelineFit, setDockPanel, toggleDockPanel } = useStore.getState();

  const [pxPerBeat, setPxPerBeat] = useState(DEFAULT_PX_PER_BEAT);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [dockHeight, setDockHeight] = useState<number | null>(null);
  const [focusMelody, setFocusMelody] = useState(false);

  const anyExpanded = dockPanels.arrangement || (melodyVisible && dockPanels.melody) || dockPanels.progression;
  const appliedHeight = anyExpanded ? dockHeight : null;

  const dockRef = useRef<HTMLDivElement>(null);
  const melodyScrollRef = useRef<HTMLDivElement | null>(null);
  const chordScrollRef = useRef<HTMLDivElement | null>(null);
  const melodyNeedleRef = useRef<HTMLDivElement | null>(null);
  const chordNeedleRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ y0: number; h0: number; pointerId: number; el: HTMLElement } | null>(null);

  const meter = block ? blockMeter(song, block) : song.meter;
  const totalBeats = block ? laneTotalBeats(block, meter, editEnding) : meter[0] * 4;
  const cut = block && editEnding ? endingCut(block, meter) : 0;
  const hasGutter = melodyVisible && dockPanels.melody;
  const gutterPx = hasGutter ? LANE_GUTTER_PX : 0;
  const effectivePxPerBeat = fitPxPerBeat(pxPerBeat, totalBeats, viewportWidth, gutterPx, timelineFit);
  const isFitted = timelineFit && effectivePxPerBeat < pxPerBeat;

  useLayoutEffect(() => {
    const measure = () => {
      const melW = hasGutter ? (melodyScrollRef.current?.clientWidth ?? 0) : 0;
      const chW = dockPanels.progression ? (chordScrollRef.current?.clientWidth ?? 0) : 0;
      const next = melW || chW;
      if (next > 0) setViewportWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) {
      if (melodyScrollRef.current) ro.observe(melodyScrollRef.current);
      if (chordScrollRef.current) ro.observe(chordScrollRef.current);
      if (dockRef.current) ro.observe(dockRef.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hasGutter, dockPanels.progression, melodyVisible, focusMelody, timelineFit]);

  useEffect(() => {
    if (!isFitted) return;
    if (melodyScrollRef.current) melodyScrollRef.current.scrollLeft = 0;
    if (chordScrollRef.current) chordScrollRef.current.scrollLeft = 0;
  }, [isFitted, effectivePxPerBeat, totalBeats]);

  const syncScroll = (source: "melody" | "chords", scrollLeft: number) => {
    const target = source === "melody" ? chordScrollRef.current : melodyScrollRef.current;
    if (!target || Math.abs(target.scrollLeft - scrollLeft) < 2) return;
    target.scrollLeft = scrollLeft;
  };

  const expanded = useMemo(() => {
    if (!playing) return null;
    if (region) return expandRegion(song, selectedItem, region.from, region.to);
    const only = playScope === "block" ? [selectedItem] : undefined;
    return expandArrangement(song, only);
  }, [playing, region, song, selectedItem, playScope]);

  // Agulha vertical contínua em 60fps cruzando Melodia e Acordes.
  useEffect(() => {
    const hideNeedles = () => {
      for (const el of [melodyNeedleRef.current, chordNeedleRef.current]) {
        if (el) el.style.display = "none";
      }
    };
    if (!playing || !expanded || !block || expanded.totalSec <= 0) {
      hideNeedles();
      return;
    }
    let raf = 0;
    const tick = () => {
      const snap = getPlaybackTime();
      let show = false;
      let x = 0;
      if (snap) {
        let elapsed = snap.seconds - snap.offset;
        if (loop && elapsed >= 0) elapsed = elapsed % expanded.totalSec;
        if (elapsed >= 0) {
          const pos = playbackBeatAtSec(expanded, elapsed);
          const matchEnding = editEnding ? !!(pos?.inEnding || pos?.melodyInEnding) : !pos?.inEnding;
          if (pos && (pos.itemIndex === selectedItem || pos.blockId === block.id) && matchEnding) {
            const relBeat = editEnding ? pos.blockBeat - cut : pos.blockBeat;
            if (relBeat >= -1e-6) {
              show = true;
              x = Math.max(0, relBeat) * effectivePxPerBeat;
            }
          }
        }
      }
      for (const el of [melodyNeedleRef.current, chordNeedleRef.current]) {
        if (!el) continue;
        if (show) {
          el.style.display = "block";
          el.style.transform = `translateX(${x}px)`;
        } else {
          el.style.display = "none";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hideNeedles();
    };
  }, [playing, expanded, block, loop, selectedItem, editEnding, cut, effectivePxPerBeat]);

  const finishResize = () => {
    const r = resizeRef.current;
    if (!r) return;
    resizeRef.current = null;
    if (r.el.hasPointerCapture?.(r.pointerId)) r.el.releasePointerCapture(r.pointerId);
  };

  return (
    <div
      ref={dockRef}
      className={`dock ${appliedHeight !== null ? "resized" : ""} ${focusMelody ? "focus-melody" : ""} ${isFitted ? "timeline-fit" : ""}`}
      style={appliedHeight !== null ? { height: `${appliedHeight}px` } : undefined}
      role="region"
      aria-label="Arranjo, melodia e progressão"
    >
      <div
        className="dock-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionar painel inferior"
        title="Arraste para ajustar a altura do painel inferior (duplo clique restaura)"
        onDoubleClick={() => setDockHeight(null)}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          const h0 = dockRef.current?.getBoundingClientRect().height ?? 320;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          resizeRef.current = { y0: e.clientY, h0, pointerId: e.pointerId, el: e.currentTarget };
        }}
        onPointerMove={(e) => {
          const r = resizeRef.current;
          if (!r) return;
          const maxH = Math.max(260, (typeof window !== "undefined" ? window.innerHeight : 900) - 240);
          const next = Math.max(220, Math.min(maxH, Math.round(r.h0 + (r.y0 - e.clientY))));
          setDockHeight(next);
        }}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
      />

      {!focusMelody ? (
        <Arrangement
          collapsed={!dockPanels.arrangement}
          onToggleCollapse={() => toggleDockPanel("arrangement")}
          extra={
            <div className="dock-controls">
              <label
                className="check small"
                title="Ajusta automaticamente a melodia e os acordes à área visível quando excederem o tamanho do painel, sem rolagem horizontal"
              >
                <input
                  type="checkbox"
                  checked={timelineFit}
                  onChange={(e) => setTimelineFit(e.target.checked)}
                />
                Ajustar na área visível
              </label>
              <button
                type="button"
                className={`btn small ${melodyVisible ? "primary" : ""}`}
                aria-pressed={melodyVisible}
                onClick={() => {
                  const next = !melodyVisible;
                  setMelodyVisible(next);
                  if (next) setDockPanel("melody", true);
                  else setFocusMelody(false);
                }}
                title="Mostrar ou ocultar a camada de melodia"
              >
                🎵 Melodia
              </button>
              <button className="btn small dock-toggle" onClick={() => setDock("compact")} title="Compactar: mostra só o acompanhamento, por cima da roda">
                ▾ Compactar
              </button>
            </div>
          }
        />
      ) : (
        <div className="dock-focus-bar small">
          <span className="muted">Arranjo oculto (foco na melodia)</span>
          <label
            className="check small"
            title="Ajusta automaticamente a melodia e os acordes à área visível quando excederem o tamanho do painel, sem rolagem horizontal"
          >
            <input
              type="checkbox"
              checked={timelineFit}
              onChange={(e) => setTimelineFit(e.target.checked)}
            />
            Ajustar na área visível
          </label>
          <button type="button" className="btn small" onClick={() => setFocusMelody(false)}>
            ⤡ Mostrar Arranjo
          </button>
          <button className="btn small dock-toggle" onClick={() => setDock("compact")} title="Compactar: mostra só o acompanhamento, por cima da roda">
            ▾ Compactar
          </button>
        </div>
      )}

      {melodyVisible && (
        <MelodyTrack
          pxPerBeat={effectivePxPerBeat}
          totalBeats={totalBeats}
          scrollRef={melodyScrollRef}
          onScrollSync={(x) => syncScroll("melody", x)}
          needleRef={melodyNeedleRef}
          onZoomOut={() => setPxPerBeat((z) => nextZoom(z, -1))}
          onZoomIn={() => setPxPerBeat((z) => nextZoom(z, 1))}
          focusMelody={focusMelody}
          onToggleFocusMelody={() =>
            setFocusMelody((f) => {
              const next = !f;
              if (next) setDockPanel("melody", true);
              return next;
            })
          }
          collapsed={!dockPanels.melody}
          onToggleCollapse={() => {
            if (focusMelody) setFocusMelody(false);
            toggleDockPanel("melody");
          }}
        />
      )}

      <Progression
        pxPerBeat={effectivePxPerBeat}
        totalBeats={totalBeats}
        leftGutter={melodyVisible && dockPanels.melody}
        scrollRef={chordScrollRef}
        onScrollSync={(x) => syncScroll("chords", x)}
        needleRef={chordNeedleRef}
        collapsed={!dockPanels.progression}
        onToggleCollapse={() => toggleDockPanel("progression")}
      />
    </div>
  );
}

/**
 * Painel inferior compacto, sobreposto à roda: blocos do arranjo e acordes do bloco em foco
 * (o que está tocando; parado, o selecionado), para acompanhar a reprodução.
 */
export function MiniDock() {
  const song = useStore((s) => s.song);
  const playhead = useStore((s) => s.playhead);
  const selectedItem = useStore((s) => s.selectedItem);
  const selectedChord = useStore((s) => s.selectedChord);
  const playScope = useStore((s) => s.playScope);
  const { setDock, selectItem, selectChord, setEditEnding } = useStore.getState();
  const spell = useSpeller();
  const { entries } = arrangementLayout(song);

  const focusIdx = playhead?.itemIndex ?? selectedItem;
  const focusItem = song.arrangement[focusIdx];
  const block = focusItem && song.blocks[focusItem.blockId];
  // Mesma regra da progressão: o índice do acorde tocando refere-se à casa 2 quando o evento é dela.
  const inEnding = useMemo(() => {
    if (!playhead || playScope === "region") return false;
    return !!expandArrangement(song, playScope === "block" ? [selectedItem] : undefined).events[playhead.eventIndex]?.inEnding;
  }, [playhead, playScope, song, selectedItem]);
  const chords = (inEnding ? block?.ending : block?.chords) ?? [];
  const playingChord = playhead && playhead.itemIndex === focusIdx ? playhead.chordIndex : -1;

  return (
    <div className="mini-dock" role="region" aria-label="Acompanhamento">
      <div className="mini-row mini-blocks" role="group" aria-label="Blocos do arranjo">
        {entries.map(({ item, i, block: b, bars }) =>
          b ? (
            <button
              key={item.id}
              className={`mini-block ${i === selectedItem ? "selected" : ""} ${playhead?.itemIndex === i ? "playing" : ""}`}
              style={{ "--block": b.color, flexGrow: Math.max(1, bars) } as React.CSSProperties}
              onClick={() => selectItem(i)}
              aria-current={playhead?.itemIndex === i ? "true" : undefined}
              title={`${b.name} ×${item.repeat}`}
            >
              {b.name}
              {item.repeat > 1 && <span className="mono"> ×{item.repeat}</span>}
            </button>
          ) : null,
        )}
        <button className="btn small dock-toggle" onClick={() => setDock("full")} title="Mostrar arranjo e progressão completos">
          ▴ Expandir
        </button>
      </div>
      <div className="mini-row mini-chords" role="group" aria-label={block ? `Acordes de “${block.name}”${inEnding ? " (casa 2)" : ""}` : "Acordes"}>
        {block && inEnding && <span className="mini-tag small">casa 2</span>}
        {chords.map((c, i) => {
          const rest = isRest(c);
          return (
            <button
              key={c.id}
              className={`mini-chord ${rest ? "rest" : ""} ${i === playingChord ? "playing" : ""} ${c.id === selectedChord && focusIdx === selectedItem ? "selected" : ""}`}
              style={{ flexGrow: c.duration }}
              aria-current={i === playingChord ? "true" : undefined}
              onClick={() => {
                if (focusIdx !== selectedItem) selectItem(focusIdx);
                // Acorde da casa 2: a progressão passa a editar a casa 2 (senão o id não estaria na lista editada).
                if (useStore.getState().editEnding !== inEnding) setEditEnding(inEnding);
                selectChord(c.id);
              }}
            >
              {rest ? "N.C." : chordSymbol(c, spell)}
            </button>
          );
        })}
        {!chords.length && (
          <span className="muted small">
            {block?.melody?.length ? "Só melodia neste bloco — clique na roda para adicionar acordes." : "Bloco vazio — clique na roda para adicionar acordes."}
          </span>
        )}
      </div>
    </div>
  );
}
