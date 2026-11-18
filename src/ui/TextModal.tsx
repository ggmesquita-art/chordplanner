import { useEffect, useRef, useState } from "react";

export type TextModalData = { title: string; text: string; hint?: string };

/** Texto para copiar (cifra, link). Esc ou clique fora fecham. */
export function TextModal({ data, onClose }: { data: TextModalData; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  const copyBtn = useRef<HTMLButtonElement>(null);

  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    copyBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close.current();
    };
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
