import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { ChordWheel, DegreeStrip } from "./ui/ChordWheel/ChordWheel";
import { togglePlay, useMidiSync, useSessionGuard } from "./ui/hooks";
import { Dock, MiniDock } from "./ui/Layout/Dock";
import { TopBar } from "./ui/Layout/TopBar";
import { ModifierPanel } from "./ui/ModifierPanel/ModifierPanel";
import { SharedLink } from "./ui/SharedLink";
import { Practice } from "./ui/Practice/Practice";
import { useTheme } from "./ui/useTheme";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
      if (typing) return;
      const s = useStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (e.code === "Space" && !(t.getAttribute("role") === "button" || t.tagName === "BUTTON")) {
        e.preventDefault();
        void togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  useShortcuts();
  useMidiSync();
  useSessionGuard();
  useTheme();
  const soundOnClick = useStore((s) => s.soundOnClick);
  const setSoundOnClick = useStore((s) => s.setSoundOnClick);
  const soundOnHover = useStore((s) => s.soundOnHover);
  const setSoundOnHover = useStore((s) => s.setSoundOnHover);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const showDegrees = useStore((s) => s.showDegrees);
  const setShowDegrees = useStore((s) => s.setShowDegrees);
  const dock = useStore((s) => s.dock);

  return (
    <div className={`app dock-${dock}`}>
      <SharedLink />
      <TopBar />
      <main className="main">
        <section className="wheel-panel" aria-label="Roda de acordes">
          <div className="section-head">
            <h2>Roda de acordes</h2>
            <div className="spacer" />
            <button className="btn small" onClick={() => setPracticeOpen(true)}>
              🎧 Prática
            </button>
            <label className="check small">
              <input type="checkbox" checked={soundOnClick} onChange={(e) => setSoundOnClick(e.target.checked)} />
              Som ao clicar
            </label>
            <label className="check small">
              <input type="checkbox" checked={soundOnHover} onChange={(e) => setSoundOnHover(e.target.checked)} />
              Som ao passar o mouse
            </label>
            <label className="check small">
              <input type="checkbox" checked={showDegrees} onChange={(e) => setShowDegrees(e.target.checked)} />
              Lista por graus
            </label>
          </div>
          <ChordWheel />
        </section>
        <aside className="side">
          {showDegrees && (
            <section className="degrees-panel" aria-label="Graus da escala">
              <DegreeStrip />
            </section>
          )}
          <ModifierPanel />
          <footer className="footer muted small">
            Espaço: tocar/parar · Ctrl+Z / Ctrl+Shift+Z: desfazer/refazer · Setas + Enter navegam na roda · Samples: SplendidGrandPiano, Greg Sullivan E-Pianos, VCSL, Smolken e MusyngKite (via smplr)
          </footer>
        </aside>
        {dock === "compact" && <MiniDock />}
      </main>
      {dock === "full" && <Dock />}
      {practiceOpen && <Practice onClose={() => setPracticeOpen(false)} />}
    </div>
  );
}
