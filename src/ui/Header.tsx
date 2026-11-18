import type { AccidentalPref } from "../core/pitch";
import { keyLabel } from "../core/view";
import { selectBlock, useStore } from "../state/store";
import type { RestrictionMode, Theme } from "../state/repository";
import { useSpeller } from "./hooks";
import { FileMenu } from "./FileMenu/FileMenu";
import { InstrumentPicker } from "./InstrumentPicker/InstrumentPicker";
import { ScalePicker } from "./ScalePicker/ScalePicker";
import { Segmented } from "./Segmented";

export function Header() {
  const tonic = useStore((s) => s.tonic);
  const setTonic = useStore((s) => s.setTonic);
  const accidentals = useStore((s) => s.accidentals);
  const setAccidentals = useStore((s) => s.setAccidentals);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const spell = useSpeller();
  const block = useStore((s) => selectBlock(s));

  return (
    <header className="header">
      <h1 className="logo">
        Chord<span>Planner</span>
      </h1>
      <FileMenu />
      <ScalePicker />
      <label className="picker-button tonic">
        <span className="picker-label">Tônica</span>
        <select value={tonic ?? ""} onChange={(e) => setTonic(Number(e.target.value))} aria-label="Tônica">
          {tonic === null && <option value="">— escolha —</option>}
          {Array.from({ length: 12 }, (_, pc) => (
            <option key={pc} value={pc}>
              {spell(pc)}
            </option>
          ))}
        </select>
      </label>
      <span className="key-notice small" aria-live="polite">
        {block?.key && `Bloco “${block.name}” em ${keyLabel(block.key.tonic, block.key.scaleId, accidentals)}`}
      </span>
      <Segmented<AccidentalPref>
        label="Grafia"
        value={accidentals}
        onChange={setAccidentals}
        options={[
          { value: "auto", text: "Auto", title: "Grafia automática pela escala" },
          { value: "sharp", text: "♯", title: "Forçar sustenidos" },
          { value: "flat", text: "♭", title: "Forçar bemóis" },
        ]}
      />
      <Segmented<RestrictionMode>
        label="Modo de restrição"
        value={mode}
        onChange={setMode}
        options={[
          { value: "strict", text: "Estrito", title: "Só acordes diatônicos e modificadores verdes" },
          { value: "colorful", text: "Colorido", title: "Acordes diatônicos + tensões idiomáticas (âmbar)" },
          { value: "free", text: "Livre", title: "Tudo liberado; fora da escala marcado com ⚠" },
        ]}
      />
      <div className="spacer" />
      <Segmented<Theme>
        label="Tema"
        value={theme}
        onChange={setTheme}
        options={[
          { value: "auto", text: "Auto", title: "Seguir o tema do sistema" },
          { value: "light", text: "☀ Claro" },
          { value: "dark", text: "☾ Escuro" },
        ]}
      />
      <InstrumentPicker />
    </header>
  );
}
