import { useEffect, useRef, useState } from "react";
import { keyLabel } from "../../core/view";
import { useStore } from "../../state/store";
import { AIPanel } from "../AIPanel/AIPanel";
import { Header } from "../Header";
import { togglePlay, usePositionLabel } from "../hooks";
import { Transport } from "../Transport/Transport";

/**
 * Topo da tela (cabeçalho + transporte).
 * - Fixo: sempre visível, no fluxo da página.
 * - Automático: vira uma faixa fina (tocar, andamento, tom, posição); passar o mouse mostra os controles
 *   por cima da roda; clicar dentro deles (ou em "Mostrar") os mantém abertos até clicar fora ou Esc.
 */
export function TopBar() {
  const mode = useStore((s) => s.topBar);
  const setTopBar = useStore((s) => s.setTopBar);
  const songName = useStore((s) => s.songName);
  const bpm = useStore((s) => s.song.bpm);
  const tonic = useStore((s) => s.tonic);
  const scaleId = useStore((s) => s.scaleId);
  const accidentals = useStore((s) => s.accidentals);
  const playing = useStore((s) => s.playing);
  const position = usePositionLabel();
  const [peek, setPeek] = useState(false);
  const [held, setHeld] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const showBtn = useRef<HTMLButtonElement>(null);
  const collapseBtn = useRef<HTMLButtonElement>(null);
  /** Botão que recebe o foco depois de trocar de modo (o que foi clicado deixa de existir). */
  const focusAfter = useRef<"show" | "collapse" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const auto = mode === "auto";
  const open = auto && (peek || held);

  const close = (restoreFocus = false) => {
    clearTimeout(timer.current);
    // O painel vira inert: o foco que estava nele volta para o botão da faixa.
    if (restoreFocus && panel.current?.contains(document.activeElement)) showBtn.current?.focus();
    setHeld(false);
    setPeek(false);
  };

  useEffect(() => {
    const target = focusAfter.current === "show" ? showBtn.current : focusAfter.current === "collapse" ? collapseBtn.current : null;
    focusAfter.current = null;
    target?.focus();
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('[data-popover-owner="topbar"]')) return;
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    // Na janela (depois do documento): o Esc de um popover interno é tratado primeiro e marcado.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close(true);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const hover = auto
    ? {
        onMouseEnter: () => {
          clearTimeout(timer.current);
          setPeek(true);
        },
        onMouseLeave: () => {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setPeek(false), 350);
        },
      }
    : {};

  return (
    <div ref={ref} className={`topbar ${auto ? "auto" : "pinned"} ${open ? "open" : ""}`} {...hover}>
      {auto && (
        <div className="top-strip" role="toolbar" aria-label="Barra compacta">
          <span className="logo strip-logo" aria-hidden="true">
            Chord<span>Planner</span>
          </span>
          <span className="strip-name" title={songName}>
            {songName}
          </span>
          <button className={`play small ${playing ? "on" : ""}`} onClick={() => void togglePlay()} aria-label={playing ? "Parar (barra compacta)" : "Tocar (barra compacta)"} title="Tocar/parar (Espaço)">
            {playing ? "■" : "▶"}
          </button>
          <span className="mono">♩={bpm}</span>
          <span className="strip-key">{tonic === null ? "sem tônica" : keyLabel(tonic, scaleId, accidentals)}</span>
          <span className="mono muted strip-pos">⏱ {position}</span>
          <div className="spacer" />
          <button
            type="button"
            className="btn small ai-btn"
            aria-haspopup="dialog"
            onClick={() => setAiOpen(true)}
            title="IA Musical (MIDI-GPT)"
          >
            ✨ IA
          </button>
          <button ref={showBtn} className="btn small" aria-expanded={open} onClick={() => (held ? close() : setHeld(true))} title="Mostrar e manter os controles do topo">
            {held ? "▴ Ocultar controles" : "▾ Mostrar controles"}
          </button>
          <button
            className="btn small"
            title="Manter o topo sempre visível"
            onClick={() => {
              close();
              focusAfter.current = "collapse";
              setTopBar("pinned");
            }}
          >
            📌 Fixar
          </button>
        </div>
      )}
      <div ref={panel} className="top-panel" inert={auto && !open} onPointerDown={auto ? () => setHeld(true) : undefined}>
        <Header onOpenAI={() => setAiOpen(true)} />
        <Transport />
        {!auto && (
          <button
            ref={collapseBtn}
            className="icon-btn top-collapse"
            aria-label="Recolher o topo"
            title="Recolher o topo: vira uma faixa fina que se abre ao passar o mouse"
            onClick={() => {
              focusAfter.current = "show";
              setTopBar("auto");
            }}
          >
            ⇡
          </button>
        )}
      </div>
      {aiOpen && <AIPanel onClose={() => setAiOpen(false)} />}
    </div>
  );
}
