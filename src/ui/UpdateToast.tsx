import { useEffect, useSyncExternalStore } from "react";
import { applyUpdate, pwaStore } from "../pwa";

const estilo: React.CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 1000,
  display: "flex",
  gap: 10,
  alignItems: "center",
  padding: "8px 12px",
  background: "var(--panel-2)",
  color: "var(--text)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  fontSize: 13,
  boxShadow: "0 4px 16px rgba(0,0,0,.35)",
};

/** Aviso discreto: nova versão disponível (com ação) ou pronto para uso offline (some em 4 s). */
export function UpdateToast() {
  const { updateReady, offlineReady } = useSyncExternalStore(pwaStore.subscribe, pwaStore.getSnapshot);
  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(pwaStore.dismissOffline, 4000);
    return () => clearTimeout(t);
  }, [offlineReady]);

  if (!updateReady && !offlineReady) return null;
  return (
    <div role="status" style={estilo}>
      {updateReady ? (
        <>
          <span>Nova versão disponível</span>
          <button type="button" onClick={applyUpdate}>
            Atualizar
          </button>
        </>
      ) : (
        <span>Pronto para uso offline</span>
      )}
    </div>
  );
}
