import { useEffect, useRef, useState } from "react";
import { BLOCK_COLORS } from "../../core/song";
import { TEMPLATES, type TemplateId } from "../../core/templates";
import { arrangementLayout, blockUsage, keyLabel } from "../../core/view";
import { useStore } from "../../state/store";
import { barTicks } from "./barTicks";

export function Arrangement() {
  const song = useStore((s) => s.song);
  const selected = useStore((s) => s.selectedItem);
  const playhead = useStore((s) => s.playhead);
  const { selectItem, addBlock, addLinkedInstance, makeUnique, removeItem, moveItem, setRepeat, renameBlock, applyTemplate, setBlockProps } = useStore.getState();
  const [editing, setEditing] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<TemplateId | null>(null);
  const [announce, setAnnounce] = useState("");
  const laneRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // Refoca o card (pelo id da instância) depois que mover re-renderizou a lista.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = Array.from(laneRef.current?.children ?? []).find((n) => (n as HTMLElement).dataset.itemId === id);
    (el as HTMLElement | undefined)?.focus();
  });

  // A confirmação só vale enquanto o mesmo bloco estiver selecionado.
  const pendingRemove = confirmRemove !== null && song.arrangement[selected]?.id === confirmRemove ? confirmRemove : null;
  const removeTitle = (n: number) => (n > 1 ? "Remove só esta instância; o bloco continua nas outras" : "Remover do arranjo");
  const accidentals = useStore((s) => s.accidentals);
  const usage = blockUsage(song);
  const { entries: items, end: bar } = arrangementLayout(song);

  return (
    <section className="arrangement" aria-label="Arranjo">
      <div className="section-head">
        <h2>Arranjo</h2>
        <span className="muted small">{Math.round((bar - 1) * 100) / 100} compassos</span>
        <div className="spacer" />
        <label className="field small">
          Template
          <select
            value=""
            onChange={(e) => e.target.value && setConfirmTemplate(e.target.value as TemplateId)}
            aria-label="Aplicar template de forma"
          >
            <option value="">—</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {confirmTemplate && (
          <span className="confirm small">
            Substituir o arranjo atual?
            <button className="btn danger" onClick={() => (applyTemplate(confirmTemplate), setConfirmTemplate(null))}>
              Substituir
            </button>
            <button className="btn" onClick={() => setConfirmTemplate(null)}>
              Cancelar
            </button>
          </span>
        )}
      </div>
      <div className="lane" role="list" ref={laneRef}>
        {items.map(({ item, i, block, bars, start }) =>
          block ? (
            <div
              key={item.id}
              role="listitem"
              data-item-id={item.id}
              tabIndex={0}
              aria-current={i === selected ? "true" : undefined}
              aria-label={`Bloco “${block.name}”, ×${item.repeat}, compassos ${Math.floor(start)}–${Math.max(Math.floor(start), Math.ceil(start + bars - 1))}${block.key ? `, em ${keyLabel(block.key.tonic, block.key.scaleId, accidentals)}` : ""}`}
              aria-keyshortcuts="Enter Space ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight"
              title="Alt+←/→ move o bloco"
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey) return;
                const k = e.key;
                if (k === "Enter" || k === " ") {
                  e.preventDefault();
                  e.stopPropagation(); // Espaço não aciona o play global
                  selectItem(i);
                  setConfirmRemove(null);
                } else if (k === "ArrowLeft" || k === "ArrowRight") {
                  e.preventDefault();
                  const d = k === "ArrowLeft" ? -1 : 1;
                  if (e.altKey) {
                    if (i + d < 0 || i + d >= items.length) return;
                    pendingFocus.current = item.id;
                    moveItem(i, i + d);
                    setAnnounce(`${block.name} movido para a posição ${i + d + 1} de ${items.length}`);
                  } else {
                    const next = e.currentTarget[d < 0 ? "previousElementSibling" : "nextElementSibling"] as HTMLElement | null;
                    if (next?.classList.contains("block-card")) next.focus();
                  }
                }
              }}
              className={`block-card ${i === selected ? "selected" : ""} ${playhead?.itemIndex === i ? "playing" : ""} ${dragFrom === i ? "dragging" : ""}`}
              style={{ "--block": block.color, flexGrow: Math.max(1, bars), minWidth: `${Math.max(110, Math.min(260, bars * 34))}px` } as React.CSSProperties}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = e.altKey ? "copy" : "move";
              }}
              onDragEnd={() => setDragFrom(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom === null) return;
                if (e.altKey) addLinkedInstance(dragFrom);
                else moveItem(dragFrom, i);
                setDragFrom(null);
              }}
              onClick={() => (selectItem(i), setConfirmRemove(null))}
            >
              <div className="block-top">
                {editing === i ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={block.name}
                    onBlur={(e) => (renameBlock(block.id, e.target.value.trim()), setEditing(null))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span className="block-name" onDoubleClick={() => setEditing(i)} title="Duplo clique para renomear">
                    {block.name}
                  </span>
                )}
                {(usage.get(block.id) ?? 0) > 1 && (
                  <span className="linked" title="Bloco vinculado: editar muda todas as instâncias">
                    🔗
                  </span>
                )}
                {block.key && (
                  <span className="key-badge" title={`Modulação: ${keyLabel(block.key.tonic, block.key.scaleId, accidentals)}`}>
                    {keyLabel(block.key.tonic, block.key.scaleId, accidentals)}
                  </span>
                )}
                <span className="repeat">×{item.repeat}</span>
              </div>
              <div className="block-meta small">
                <span>|{Math.floor(start)}</span>
                <span className="muted">
                  {block.chords.length} ac. · {Math.round(bars * 100) / 100} comp.
                </span>
              </div>
              <div className="bar-ticks" aria-hidden>
                {barTicks(start, bars).map((t) => (
                  <span key={t.bar} style={{ left: `${t.at * 100}%` }}>
                    {t.bar}
                  </span>
                ))}
              </div>
              {i === selected && (
                <div className="block-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" onClick={() => setRepeat(i, item.repeat - 1)} aria-label="Menos repetições">
                    −
                  </button>
                  <button className="icon-btn" onClick={() => setRepeat(i, item.repeat + 1)} aria-label="Mais repetições">
                    +
                  </button>
                  <button className="icon-btn" onClick={() => addLinkedInstance(i)} title="Nova instância vinculada (Alt+arrastar)">
                    🔗+
                  </button>
                  {(usage.get(block.id) ?? 0) > 1 && (
                    <button className="icon-btn" onClick={() => makeUnique(i)} title="Tornar único (cópia independente)">
                      ✂
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => setEditing(i)} title="Renomear">
                    ✎
                  </button>
                  <div className="color-swatches" role="radiogroup" aria-label="Cor do bloco">
                    {BLOCK_COLORS.map((c, n) => (
                      <button
                        key={c}
                        className="swatch"
                        role="radio"
                        aria-checked={block.color === c}
                        aria-label={`Cor ${n + 1}`}
                        style={{ "--sw": c } as React.CSSProperties}
                        onClick={() => setBlockProps(block.id, { color: c })}
                      />
                    ))}
                  </div>
                  {song.arrangement.length > 1 &&
                    (pendingRemove === item.id ? (
                      <span className="confirm small">
                        <button className="btn danger" onClick={() => (removeItem(i), setConfirmRemove(null))} title={removeTitle(usage.get(block.id) ?? 0)}>
                          Excluir
                        </button>
                        <button className="btn" onClick={() => setConfirmRemove(null)} aria-label="Cancelar exclusão">
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button className="icon-btn danger" onClick={() => setConfirmRemove(item.id)} title={removeTitle(usage.get(block.id) ?? 0)} aria-label="Remover do arranjo">
                        🗑
                      </button>
                    ))}
                </div>
              )}
            </div>
          ) : null,
        )}
        <button className="add-block" onClick={addBlock} aria-label="Novo bloco">
          +
        </button>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}
