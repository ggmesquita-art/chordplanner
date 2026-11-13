import { useEffect, useState } from "react";
import { makeSpeller } from "../../core/pitch";
import { getScale, pitchSet } from "../../core/scales";
import { selectDirty, useStore } from "../../state/store";
import { stopPlayback } from "../hooks";
import { usePopover } from "../usePopover";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function keyLabel(scaleId: string, tonic: number | null): string {
  const scale = getScale(scaleId);
  if (tonic === null) return scale.name;
  const spell = makeSpeller(tonic, pitchSet(tonic, scale), "auto");
  return `${spell(tonic)} ${scale.name.replace(/ \(.*\)/, "")}`;
}

/** Pede confirmação antes de descartar alterações não salvas. */
type Pending = { kind: "new" } | { kind: "open"; id: string; name: string } | null;

export function FileMenu() {
  const songName = useStore((s) => s.songName);
  const songId = useStore((s) => s.songId);
  const dirty = useStore(selectDirty);
  const savedSongs = useStore((s) => s.savedSongs);
  const { saveSong, saveCopy, renameSong, newSong, openSong, deleteSong } = useStore.getState();
  const { open: menuOpen, setOpen: setMenuOpen, ref: menuRef } = usePopover();
  const { open: confirmOpen, setOpen: setConfirmOpen, ref: confirmRef } = usePopover();
  const [pending, setPending] = useState<Pending>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const save = () => {
    saveSong();
    setFlash(true);
  };

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [flash]);

  // Ctrl/Cmd+S salva.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        useStore.getState().saveSong();
        setFlash(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (p: NonNullable<Pending>) => {
    stopPlayback();
    if (p.kind === "new") newSong();
    else openSong(p.id);
    setPending(null);
    setConfirmOpen(false);
    setMenuOpen(false);
  };

  const request = (p: NonNullable<Pending>) => {
    if (!dirty) return run(p);
    setPending(p);
    setMenuOpen(false);
    setConfirmOpen(true);
  };

  return (
    <div className="file-menu">
      <div className="song-name">
        <input
          value={songName}
          onChange={(e) => renameSong(e.target.value)}
          onBlur={(e) => !e.target.value.trim() && renameSong("Sem título")}
          aria-label="Nome da música"
          size={Math.max(8, Math.min(26, songName.length + 1))}
        />
        <span className={`dirty ${dirty ? "on" : ""}`} title={dirty ? "Alterações não salvas" : songId ? "Salvo" : "Ainda não salvo"}>
          {flash ? "✓" : dirty ? "●" : ""}
        </span>
      </div>

      <div className="picker" ref={confirmRef}>
        <button className="btn" onClick={() => request({ kind: "new" })} title="Nova música">
          ＋ Novo
        </button>
        {confirmOpen && pending && (
          <div className="popover confirm-pop" role="alertdialog" aria-label="Alterações não salvas">
            <p>
              <b>“{songName}”</b> tem alterações não salvas.
            </p>
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  saveSong();
                  run(pending);
                }}
              >
                Salvar e continuar
              </button>
              <button className="btn danger" onClick={() => run(pending)}>
                Descartar
              </button>
              <button className="btn" onClick={() => (setPending(null), setConfirmOpen(false))}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <button className={`btn ${dirty ? "primary" : ""}`} onClick={save} title="Salvar (Ctrl+S)">
        {flash ? "✓ Salvo" : "💾 Salvar"}
      </button>

      <div className="picker" ref={menuRef}>
        <button className="btn" onClick={() => setMenuOpen(!menuOpen)} aria-haspopup="listbox" aria-expanded={menuOpen}>
          Abrir ▾
        </button>
        {menuOpen && (
          <div className="popover songs-pop">
            <div className="group-title">Músicas salvas</div>
            <div className="songs-list" role="listbox">
              {!savedSongs.length && <div className="muted pad">Nenhuma música salva ainda. Use 💾 Salvar.</div>}
              {savedSongs.map((m) => (
                <div key={m.id} className={`song-row ${m.id === songId ? "active" : ""}`} role="option" aria-selected={m.id === songId}>
                  <button className="song-open" onClick={() => m.id !== songId && request({ kind: "open", id: m.id, name: m.name })}>
                    <span className="song-title">{m.name}</span>
                    <span className="muted small">
                      {keyLabel(m.scaleId, m.tonic)} · {dateFmt.format(m.updatedAt)}
                    </span>
                  </button>
                  {confirmDelete === m.id ? (
                    <span className="confirm small">
                      <button className="btn danger" onClick={() => (deleteSong(m.id), setConfirmDelete(null))}>
                        Excluir
                      </button>
                      <button className="btn" onClick={() => setConfirmDelete(null)}>
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button className="icon-btn danger" onClick={() => setConfirmDelete(m.id)} aria-label={`Excluir ${m.name}`} title="Excluir">
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="songs-foot">
              <button className="btn" onClick={() => (saveCopy(`${songName} (cópia)`), setMenuOpen(false), setFlash(true))}>
                Salvar como cópia
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
