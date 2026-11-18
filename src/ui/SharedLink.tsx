import { useEffect, useState } from "react";
import { decodeShare, SHARE_PREFIX } from "../export/url";
import type { SongFile } from "../export/json";
import { selectDirty, useStore } from "../state/store";
import { stopPlayback } from "./hooks";

export const SAVE_ERROR = "Não foi possível salvar: o armazenamento do navegador está cheio ou indisponível. Exporte a música em JSON para não perder.";

const clearHash = () => history.replaceState(null, "", location.pathname + location.search);

export function SharedLink() {
  const [invalid, setInvalid] = useState(false);
  const [asking, setAsking] = useState<SongFile | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let inFlight: string | null = null;
    let seq = 0;
    const process = async () => {
      const hash = location.hash;
      if (!hash.startsWith(SHARE_PREFIX) || hash === inFlight) return;
      inFlight = hash;
      const mine = ++seq;
      const file = await decodeShare(hash);
      // Efeito desmontado (StrictMode: o efeito seguinte processa o mesmo hash) ou link mais novo
      // chegou durante a decodificação — só o último pedido vale.
      if (!alive || mine !== seq) return;
      inFlight = null;
      if (!file) {
        setInvalid(true);
        clearHash();
      } else if (selectDirty(useStore.getState())) {
        setSaveFailed(false);
        setAsking(file);
      } else {
        stopPlayback();
        useStore.getState().loadExternal(file);
        clearHash();
      }
    };
    void process();
    window.addEventListener("hashchange", process);
    return () => {
      alive = false;
      window.removeEventListener("hashchange", process);
    };
  }, []);

  const finish = () => {
    setAsking(null);
    clearHash();
  };
  const open = (file: SongFile) => {
    stopPlayback();
    useStore.getState().loadExternal(file);
    finish();
  };

  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [asking]);

  return (
    <>
      {invalid && (
        <div className="warn-bar small" role="alert">
          O link de compartilhamento é inválido ou está incompleto.
          <button className="btn" onClick={() => setInvalid(false)} aria-label="Dispensar">
            ✕
          </button>
        </div>
      )}
      {asking && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-label="Abrir link compartilhado">
            <p>
              Abrir “{asking.name}”? “{useStore.getState().songName}” tem alterações não salvas.
            </p>
            {saveFailed && (
              <p className="warn-bar small" role="alert">
                {SAVE_ERROR}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="btn primary"
                autoFocus
                onClick={() => {
                  if (useStore.getState().saveSong()) open(asking);
                  else setSaveFailed(true);
                }}
              >
                Salvar e abrir
              </button>
              <button className="btn danger" onClick={() => open(asking)}>
                Abrir sem salvar
              </button>
              <button className="btn" onClick={finish}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
