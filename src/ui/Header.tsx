import type { AccidentalPref } from "../core/pitch";
import { useStore } from "../state/store";
import type { RestrictionMode } from "../state/repository";
import { useSpeller } from "./hooks";
import { FileMenu } from "./FileMenu/FileMenu";
import { InstrumentPicker } from "./InstrumentPicker/InstrumentPicker";
import { ScalePicker } from "./ScalePicker/ScalePicker";

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text, title]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} title={title} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const tonic = useStore((s) => s.tonic);
  const setTonic = useStore((s) => s.setTonic);
  const accidentals = useStore((s) => s.accidentals);
  const setAccidentals = useStore((s) => s.setAccidentals);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const spell = useSpeller();

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
      <Segmented<AccidentalPref>
        label="Grafia"
        value={accidentals}
        onChange={setAccidentals}
        options={[
          ["auto", "Auto", "Grafia automática pela escala"],
          ["sharp", "♯", "Forçar sustenidos"],
          ["flat", "♭", "Forçar bemóis"],
        ]}
      />
      <Segmented<RestrictionMode>
        label="Modo de restrição"
        value={mode}
        onChange={setMode}
        options={[
          ["strict", "Estrito", "Só acordes diatônicos e modificadores verdes"],
          ["colorful", "Colorido", "Acordes diatônicos + tensões idiomáticas (âmbar)"],
          ["free", "Livre", "Tudo liberado; fora da escala marcado com ⚠"],
        ]}
      />
      <div className="spacer" />
      <InstrumentPicker />
    </header>
  );
}
