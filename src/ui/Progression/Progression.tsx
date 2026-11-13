import { useState } from "react";
import { getInstrumentDef } from "../../audio/instruments";
import { chordFits, chromaticFunction, romanFor } from "../../core/diatonic";
import { chordSymbol } from "../../core/modifiers";
import { blockBeats, blockBpm, blockMeter, type PlaybackPattern } from "../../core/song";
import { DURATION_STEPS, METERS, formatPosition, meterLabel, missingBeats, type Meter } from "../../core/timeline";
import { useStore } from "../../state/store";
import { songToText } from "../../export/text";
import { downloadMidi, songToMidi } from "../../export/midi";
import { previewChord, useBlock, useCtx, useSpeller } from "../hooks";
import { InstrumentPicker } from "../InstrumentPicker/InstrumentPicker";
import { PATTERNS } from "../patterns";

const stepDuration = (d: number, dir: 1 | -1) => {
  const i = DURATION_STEPS.findIndex((x) => x >= d);
  const idx = i < 0 ? DURATION_STEPS.length - 1 : DURATION_STEPS[i] === d ? i + dir : dir > 0 ? i : i - 1;
  return DURATION_STEPS[Math.max(0, Math.min(DURATION_STEPS.length - 1, idx))];
};

/** Rola só a linha do tempo (horizontal) para manter o acorde tocando visível, sem mexer na página. */
function keepVisible(el: HTMLElement | null) {
  const lane = el?.parentElement;
  if (!el || !lane) return;
  const left = el.offsetLeft - lane.offsetLeft;
  if (left < lane.scrollLeft || left + el.offsetWidth > lane.scrollLeft + lane.clientWidth) {
    lane.scrollTo?.({ left: Math.max(0, left - 16), behavior: "smooth" });
  }
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
  const [exportText, setExportText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!block) return null;
  const meter = blockMeter(song, block);
  const total = blockBeats(block);
  const missing = missingBeats(total, meter);
  const isPlayingBlock = playhead && song.arrangement[playhead.itemIndex]?.blockId === block.id;

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
            <input
              type="number"
              placeholder={String(song.bpm)}
              value={block.bpm ?? ""}
              min={30}
              max={300}
              onChange={(e) => actions.setBlockProps(block.id, { bpm: e.target.value ? Number(e.target.value) : undefined })}
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
        <button className="btn" onClick={() => (setExportText(songToText(song, spell)), setCopied(false))}>
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
      </div>

      <div className="timeline" role="list">
        {block.chords.map((c, i) => {
          const start = starts[i];
          const inScale = !ctx || chordFits(c.root, c.quality, ctx.pcSet);
          const chromatic = ctx && !inScale ? chromaticFunction(ctx, c.root, c.quality) : null;
          const roman = ctx ? chromatic?.label ?? romanFor(ctx, c.root, c.quality) : "";
          const playing = isPlayingBlock && playhead?.chordIndex === i && playhead.itemIndex === selectedItem;
          return (
            <div
              key={c.id}
              role="listitem"
              ref={playing ? keepVisible : undefined}
              className={`chord-card ${c.id === selectedChord ? "selected" : ""} ${playing ? "playing" : ""} ${!inScale ? (chromatic ? "chromatic" : "out") : ""} ${dragFrom === i ? "dragging" : ""}`}
              style={{ flexGrow: c.duration, minWidth: `${Math.max(88, c.duration * 26)}px` }}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragEnd={() => setDragFrom(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) actions.moveChord(dragFrom, i);
                setDragFrom(null);
              }}
              onClick={() => {
                actions.selectChord(c.id);
                previewChord(c);
              }}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") actions.removeChord(c.id);
              }}
              aria-label={`${chordSymbol(c, spell)}, ${roman}, ${c.duration} tempos`}
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
              </div>
              <div className="chord-roman">{roman}</div>
              <div className="chord-bottom" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn tiny" onClick={() => actions.setDuration(c.id, stepDuration(c.duration, -1))} aria-label="Diminuir duração">
                  −
                </button>
                <span className="mono" title="Duração em tempos">
                  {c.duration}
                </span>
                <button className="icon-btn tiny" onClick={() => actions.setDuration(c.id, stepDuration(c.duration, 1))} aria-label="Aumentar duração">
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
              <div className="chord-pos mono">{formatPosition(start, meter)}</div>
            </div>
          );
        })}
        {!block.chords.length && (
          <div className="empty-hint muted">
            {tonic === null ? "Escolha a tônica (no topo ou clicando na roda) para começar." : "Clique nos acordes liberados da roda para montar a progressão."}
          </div>
        )}
      </div>

      {missing > 0 && block.chords.length > 0 && (
        <div className="warn-bar small">
          ⚠ Compasso incompleto — faltam {missing} tempo{missing > 1 ? "s" : ""} para fechar o compasso em {meterLabel(meter)}.
          <button className="btn" onClick={actions.completeBar}>
            Completar
          </button>
        </div>
      )}

      {exportText !== null && (
        <div className="modal-backdrop" onClick={() => setExportText(null)}>
          <div className="modal" role="dialog" aria-label="Exportar cifra" onClick={(e) => e.stopPropagation()}>
            <h3>Cifra por seção</h3>
            <textarea readOnly value={exportText} rows={Math.min(16, exportText.split("\n").length + 1)} />
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(exportText).then(() => setCopied(true));
                }}
              >
                {copied ? "✓ Copiado" : "Copiar"}
              </button>
              <button className="btn" onClick={() => setExportText(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
