import { useEffect, useRef } from "react";
import { snapDuration, stepDuration } from "../../core/timeline";

type Props = {
  label: string;
  duration: number;
  unit: number;
  /** Duração provisória durante o arrasto (null = terminou/cancelou). */
  onLive: (beats: number | null) => void;
  onCommit: (beats: number) => void;
};

/** Alça na borda direita do card: arrastar (ponteiro) ou ←/→ (teclado) muda a duração pela grade. */
export function ResizeHandle({ label, duration, unit, onLive, onCommit }: Props) {
  const drag = useRef<{ x: number; start: number; pxPerBeat: number; value: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const live = useRef(onLive);
  const stopKeys = useRef<(() => void) | null>(null);

  useEffect(() => {
    live.current = onLive;
  });

  /** Encerra o arraste (idempotente): solta o ponteiro, remove o Esc global e limpa o estado do pai. */
  const finish = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    stopKeys.current?.();
    stopKeys.current = null;
    const id = pointer.current;
    if (id !== null && el.current?.hasPointerCapture?.(id)) el.current.releasePointerCapture(id);
    pointer.current = null;
    live.current(null);
    if (commit && d.value !== d.start) onCommit(d.value);
  };

  // Se o card desmontar no meio do arraste, o pai não pode ficar com `live` preso.
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        stopKeys.current?.();
        live.current(null);
      }
    },
    [],
  );

  return (
    <div
      ref={el}
      className="chord-resize"
      role="slider"
      tabIndex={0}
      aria-label={`Duração de ${label}`}
      aria-orientation="horizontal"
      aria-valuenow={duration}
      aria-valuemin={0.5}
      aria-valuemax={64}
      aria-valuetext={`${duration} ${duration === 1 ? "tempo" : "tempos"}`}
      title="Arraste para mudar a duração (ou use as setas)"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const width = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
        if (width <= 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, start: duration, pxPerBeat: width / duration, value: duration };
        pointer.current = e.pointerId;
        // Esc cancela mesmo sem foco na alça (captura: antes dos outros listeners).
        const onEsc = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          finish(false);
        };
        window.addEventListener("keydown", onEsc, true);
        stopKeys.current = () => window.removeEventListener("keydown", onEsc, true);
        onLive(duration);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const value = snapDuration(d.start + (e.clientX - d.x) / d.pxPerBeat, unit);
        if (value !== d.value) {
          d.value = value;
          onLive(value);
        }
      }}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(false)}
      onKeyDown={(e) => {
        // Delete/Backspace: não apagar o acorde pelo card. Demais teclas (Ctrl+Z, Espaço) seguem para os atalhos globais.
        if (e.key === "Delete" || e.key === "Backspace") {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
        if (!dir) return;
        e.stopPropagation();
        e.preventDefault();
        const next = stepDuration(duration, dir, unit);
        if (next !== duration) onCommit(next);
      }}
    />
  );
}
