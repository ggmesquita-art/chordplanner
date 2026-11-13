import { useRef } from "react";
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

  const end = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onLive(null);
    if (commit && d.value !== d.start) onCommit(d.value);
  };

  return (
    <div
      className="chord-resize"
      role="slider"
      tabIndex={0}
      aria-label={`Duração de ${label}`}
      aria-orientation="horizontal"
      aria-valuenow={duration}
      aria-valuemin={unit}
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
        e.stopPropagation();
        e.preventDefault();
        const width = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
        if (width <= 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, start: duration, pxPerBeat: width / duration, value: duration };
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
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && drag.current) {
          drag.current = null;
          onLive(null);
          return;
        }
        const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = stepDuration(duration, dir, unit);
        if (next !== duration) onCommit(next);
      }}
    />
  );
}
