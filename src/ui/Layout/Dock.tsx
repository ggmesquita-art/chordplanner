import { useMemo } from "react";
import { chordSymbol } from "../../core/modifiers";
import { expandArrangement } from "../../core/song";
import { arrangementLayout } from "../../core/view";
import { useStore } from "../../state/store";
import { Arrangement } from "../Arrangement/Arrangement";
import { useSpeller } from "../hooks";
import { Progression } from "../Progression/Progression";

/** Painel inferior completo: arranjo + progressão, com botão para compactar. */
export function Dock() {
  const setDock = useStore((s) => s.setDock);
  return (
    <div className="dock" role="region" aria-label="Arranjo e progressão">
      <Arrangement
        extra={
          <button className="btn small dock-toggle" onClick={() => setDock("compact")} title="Compactar: mostra só o acompanhamento, por cima da roda">
            ▾ Compactar
          </button>
        }
      />
      <Progression />
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
        {chords.map((c, i) => (
          <button
            key={c.id}
            className={`mini-chord ${i === playingChord ? "playing" : ""} ${c.id === selectedChord && focusIdx === selectedItem ? "selected" : ""}`}
            style={{ flexGrow: c.duration }}
            aria-current={i === playingChord ? "true" : undefined}
            onClick={() => {
              if (focusIdx !== selectedItem) selectItem(focusIdx);
              // Acorde da casa 2: a progressão passa a editar a casa 2 (senão o id não estaria na lista editada).
              if (useStore.getState().editEnding !== inEnding) setEditEnding(inEnding);
              selectChord(c.id);
            }}
          >
            {chordSymbol(c, spell)}
          </button>
        ))}
        {!chords.length && <span className="muted small">Bloco vazio — clique na roda para adicionar acordes.</span>}
      </div>
    </div>
  );
}
