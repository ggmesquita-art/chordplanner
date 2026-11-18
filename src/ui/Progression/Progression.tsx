import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getInstrumentDef } from "../../audio/instruments";
import { chordFits, chromaticFunction, romanFor } from "../../core/diatonic";
import { chordSymbol } from "../../core/modifiers";
import { blockBeats, blockBpm, blockMeter, type PlaybackPattern } from "../../core/song";
import { GRIDS, METERS, barLinesWithin, formatPosition, gridBeats, meterLabel, missingBeats, stepDuration, type Grid, type Meter } from "../../core/timeline";
import { fitToRange, voiceChord } from "../../core/voicing";
import { selectRegion, useStore } from "../../state/store";
import { songToText } from "../../export/text";
import { downloadMidi, songToMidi } from "../../export/midi";
import { exportJson, shareUrl } from "../fileActions";
import { NumberField } from "../NumberField";
import { previewChord, useBlock, useCtx, useSpeller } from "../hooks";
import { InstrumentPicker } from "../InstrumentPicker/InstrumentPicker";
import { PATTERNS } from "../patterns";
import { ResizeHandle } from "./ResizeHandle";

const GRID_LABEL: Record<string, string> = { "0.5": "½ tempo", "1": "1 tempo", "2": "2 tempos", "4": "4 tempos", bar: "compasso" };

/** Régua do card: marca a cada tempo, marca forte + número nos compassos e ligadura nas barras internas. */
function Ruler({ start, duration, meter }: { start: number; duration: number; meter: Meter }) {
  const bpb = meter[0];
  const marks: { at: number; bar: number | null }[] = [];
  const first = Math.ceil(start - 1e-9);
  for (let beat = first; beat < start + duration - 1e-9; beat++) {
    const at = beat - start;
    const isBar = beat % bpb === 0;
    if (duration > 16 && !isBar) continue;
    marks.push({ at, bar: isBar ? beat / bpb + 1 : null });
  }
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
          <span key={`t${t}`} className="tie" style={{ left: `${(t / duration) * 100}%` }} title="Atravessa a barra de compasso">
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
  const lane = el?.parentElement;
  if (!el || !lane) return;
  const left = el.offsetLeft - lane.offsetLeft;
  if (left < lane.scrollLeft || left + el.offsetWidth > lane.scrollLeft + lane.clientWidth) {
    lane.scrollTo?.({ left: Math.max(0, left - 16), behavior: "smooth" });
  }
}

type TextModalData = { title: string; text: string; hint?: string };

function TextModal({ data, onClose }: { data: TextModalData; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  const copyBtn = useRef<HTMLButtonElement>(null);

  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    copyBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(data.text);
      setStatus("copied");
    } catch {
      area.current?.focus();
      area.current?.select();
      setStatus("manual");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={data.title} onClick={(e) => e.stopPropagation()}>
        <h3>{data.title}</h3>
        <textarea ref={area} readOnly value={data.text} rows={Math.min(16, data.text.split("\n").length + 1)} />
        {data.hint && <p className="muted small">{data.hint}</p>}
        {status === "manual" && (
          <p className="small" role="status">
            Selecione e copie (Ctrl+C)
          </p>
        )}
        <div className="modal-actions">
          <button ref={copyBtn} className="btn primary" onClick={() => void copy()}>
            {status === "copied" ? "✓ Copiado" : "Copiar"}
          </button>
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export function Progression() {
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
  const actions = useStore.getState();
  const ctx = useCtx();
  const spell = useSpeller();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [modal, setModal] = useState<TextModalData | null>(null);
  const [live, setLive] = useState<{ id: string; beats: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const grid = useStore((s) => s.grid);
  const region = useStore(useShallow((s) => selectRegion(s)));

  const instrumentId = block?.instrument ?? song.instrument;
  const chords = block?.chords;
  const dropped = useMemo(() => {
    const def = getInstrumentDef(instrumentId);
    return new Map((chords ?? []).map((c) => [c.id, fitToRange(voiceChord(c), def.range).dropped]));
  }, [chords, instrumentId]);

  // Refoca o card (pelo id) depois que mover/remover re-renderizou a lista.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = Array.from(timelineRef.current?.children ?? []).find((n) => (n as HTMLElement).dataset.chordId === id);
    (el as HTMLElement | undefined)?.focus();
  });

  if (!block) return null;
  const unit = gridBeats(grid, blockMeter(song, block));
  const instrumentName = getInstrumentDef(instrumentId).name;
  const meter = blockMeter(song, block);
  const total = blockBeats(block);
  const missing = missingBeats(total, meter);
  const isPlayingBlock = playhead && song.arrangement[playhead.itemIndex]?.blockId === block.id;

  const activate = (c: (typeof block.chords)[number], shift: boolean) => {
    if (shift && useStore.getState().selectedChord) {
      actions.setRegionEnd(c.id);
      return;
    }
    actions.selectChord(c.id);
    previewChord(c);
  };

  const starts = block.chords.map((_, i) => block.chords.slice(0, i).reduce((n, c) => n + c.duration, 0));

  return (
    <section className="progression" aria-label="Progressão">
      <div className="section-head wrap">
        <h2>
          Progressão <span className="muted">— bloco</span> <span style={{ color: block.color }}>“{block.name}”</span>
        </h2>
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
        </div>
      </div>

      <div className="prog-toolbar small">
        <label className="check" title="Desmarcado: a progressão começa com o acorde da tônica. Marcado: começa pelo primeiro acorde clicado.">
          <input type="checkbox" checked={startWithSelected} onChange={(e) => actions.setStartWithSelected(e.target.checked)} />
          Iniciar com o acorde selecionado <span className="muted">(padrão: começa na tônica)</span>
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
        {region && (
          <span className="region-chip">
            Região: acordes {region.from + 1}–{region.to + 1}
            <button className="icon-btn tiny" onClick={() => actions.setRegionEnd(null)} aria-label="Desfazer região" title="Desfazer região">
              ✕
            </button>
          </span>
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
        <button className="btn" onClick={() => setModal({ title: "Cifra por seção", text: songToText(song, spell) })}>
          ⤓ Exportar cifra
        </button>
        <button
          className="btn"
          title="Arquivo MIDI com trilhas de acordes e baixo, tempo, compassos e marcadores — arraste para o Ableton"
          onClick={() => {
            const st = useStore.getState();
            downloadMidi(songToMidi(st.song, { channel: st.midi.channel, splitBass: true }), st.songName);
          }}
        >
          ⤓ MIDI (.mid)
        </button>
        <button className="btn" title="Arquivo JSON da música (para guardar ou enviar)" onClick={() => exportJson()}>
          ⤓ JSON
        </button>
        <button
          className="btn"
          title="Link que contém a música inteira"
          onClick={() =>
            void shareUrl().then((url) =>
              setModal({
                title: "Link de compartilhamento",
                text: url,
                hint: url.length > 8000 ? "Link longo: alguns aplicativos podem cortá-lo. Para músicas grandes, prefira exportar o JSON." : undefined,
              }),
            )
          }
        >
          🔗 Link
        </button>
      </div>

      <div className="timeline" role="list" ref={timelineRef}>
        {block.chords.map((c, i) => {
          const start = starts[i];
          const inScale = !ctx || chordFits(c.root, c.quality, ctx.pcSet);
          const chromatic = ctx && !inScale ? chromaticFunction(ctx, c.root, c.quality) : null;
          const roman = ctx ? chromatic?.label ?? romanFor(ctx, c.root, c.quality) : "";
          const shown = live?.id === c.id ? live.beats : c.duration;
          const crosses = barLinesWithin(start, shown, meter).length > 0;
          const inRegion = !!region && i >= region.from && i <= region.to;
          const lost = dropped.get(c.id) ?? 0;
          const playing = isPlayingBlock && playhead?.chordIndex === i && playhead.itemIndex === selectedItem;
          return (
            <div
              key={c.id}
              role="listitem"
              data-chord-id={c.id}
              aria-current={c.id === selectedChord ? "true" : undefined}
              aria-keyshortcuts="Enter Space Shift+Enter ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Delete"
              ref={playing ? keepVisible : undefined}
              className={`chord-card ${c.id === selectedChord ? "selected" : ""} ${playing ? "playing" : ""} ${!inScale ? (chromatic ? "chromatic" : "out") : ""} ${dragFrom === i ? "dragging" : ""} ${inRegion ? "in-region" : ""} ${crosses ? "crosses-bar" : ""}`}
              style={{ flexGrow: shown, minWidth: `${Math.max(88, shown * 26)}px` }}
              title="Shift+clique estende a seleção (região). Alt+←/→ move o acorde"
              draggable={!live}
              onDragStart={() => !live && setDragFrom(i)}
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
                const n = block.chords.length;
                const sibling = (d: number) => block.chords[i + d];
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
                    setAnnounce(`${chordSymbol(c, spell)} movido para a posição ${i + d + 1} de ${n}`);
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
              aria-label={`${chordSymbol(c, spell)}, ${roman}, ${shown} tempos`}
            >
              <div className="chord-top">
                <span className="chord-symbol">{chordSymbol(c, spell)}</span>
                {!inScale &&
                  (chromatic ? (
                    <span className="chromatic-mark" title={chromatic.kind === "secondary" ? `Dominante secundária (resolve em ${chromatic.target})` : `Empréstimo modal de ${chromatic.from}`}>
                      ◐
                    </span>
                  ) : (
                    <span className="warn" title="Fora da escala atual">
                      ⚠
                    </span>
                  ))}
                {lost > 0 && (
                  <span
                    className="range-warn"
                    title={`${lost} nota${lost > 1 ? "s" : ""} fora da tessitura de ${instrumentName}: omitida${lost > 1 ? "s" : ""} na reprodução`}
                    aria-label={`${lost} nota${lost > 1 ? "s" : ""} fora da tessitura de ${instrumentName}: omitida${lost > 1 ? "s" : ""} na reprodução`}
                  >
                    ⚠
                  </span>
                )}
              </div>
              <div className="chord-roman">{roman}</div>
              <div className="chord-bottom" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn tiny" onClick={() => actions.setDuration(c.id, stepDuration(c.duration, -1, unit))} aria-label="Diminuir duração">
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
                label={chordSymbol(c, spell)}
                duration={c.duration}
                unit={unit}
                onLive={(beats) => setLive(beats === null ? null : { id: c.id, beats })}
                onCommit={(beats) => actions.setDuration(c.id, beats)}
              />
            </div>
          );
        })}
        {!block.chords.length && (
          <div className="empty-hint muted">
            {tonic === null ? "Escolha a tônica (no topo ou clicando na roda) para começar." : "Clique nos acordes liberados da roda para montar a progressão."}
          </div>
        )}
      </div>

      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      {missing > 0 && block.chords.length > 0 && (
        <div className="warn-bar small">
          ⚠ Compasso incompleto — faltam {missing} tempo{missing > 1 ? "s" : ""} para fechar o compasso em {meterLabel(meter)}.
          <button className="btn" onClick={actions.completeBar}>
            Completar
          </button>
        </div>
      )}

      {modal && <TextModal data={modal} onClose={() => setModal(null)} />}
    </section>
  );
}
