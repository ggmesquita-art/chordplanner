import { useEffect } from "react";
import { useStore } from "./state/store";
import { Arrangement } from "./ui/Arrangement/Arrangement";
import { ChordWheel, DegreeStrip } from "./ui/ChordWheel/ChordWheel";
import { Header } from "./ui/Header";
import { togglePlay, useMidiSync, useSessionGuard } from "./ui/hooks";
import { ModifierPanel } from "./ui/ModifierPanel/ModifierPanel";
import { SharedLink } from "./ui/SharedLink";
import { Progression } from "./ui/Progression/Progression";
import { Transport } from "./ui/Transport/Transport";

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
  const soundOnClick = useStore((s) => s.soundOnClick);
  const setSoundOnClick = useStore((s) => s.setSoundOnClick);

  return (
    <div className="app">
      <SharedLink />
      <Header />
      <Transport />
      <main className="main">
        <section className="wheel-panel" aria-label="Roda de acordes">
          <div className="section-head">
            <h2>Roda de acordes</h2>
            <div className="spacer" />
            <label className="check small">
              <input type="checkbox" checked={soundOnClick} onChange={(e) => setSoundOnClick(e.target.checked)} />
              Som ao clicar
            </label>
          </div>
          <ChordWheel />
          <DegreeStrip />
        </section>
        <ModifierPanel />
      </main>
      <Arrangement />
      <Progression />
      <footer className="footer muted small">
        Espaço: tocar/parar · Ctrl+Z / Ctrl+Shift+Z: desfazer/refazer · Setas + Enter navegam na roda · Samples: SplendidGrandPiano, Greg Sullivan E-Pianos, VCSL, Smolken e MusyngKite (via smplr)
      </footer>
    </div>
  );
}
