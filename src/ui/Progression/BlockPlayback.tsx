import { preload } from "../../audio/engine";
import { CATEGORY_NAMES, INSTRUMENTS, getInstrumentDef, type InstrumentCategory } from "../../audio/instruments";
import { useStore } from "../../state/store";
import { NumberField } from "../NumberField";

const CATEGORIES = Object.keys(CATEGORY_NAMES) as InstrumentCategory[];

/** Camadas de execução do bloco: baixo com instrumento próprio, bordão e rampa de andamento (§3.8, §3.9). */
export function BlockPlayback({ blockId }: { blockId: string }) {
  const block = useStore((s) => s.song.blocks[blockId]);
  const songInstrument = useStore((s) => s.song.instrument);
  const songBpm = useStore((s) => s.song.bpm);
  const setBlockProps = useStore((s) => s.setBlockProps);
  if (!block) return null;

  const effective = getInstrumentDef(block.instrument ?? songInstrument);
  const canDrone = !!effective.drone;

  return (
    <div className="block-overrides small">
      <label className="field small" title="Camada de baixo com instrumento próprio: toca a fundamental (ou o baixo invertido)">
        Baixo
        <select value={block.bassInstrument ?? ""} onChange={(e) => {
            if (e.target.value) preload(e.target.value);
            setBlockProps(blockId, { bassInstrument: e.target.value || undefined });
          }} aria-label="Instrumento do baixo do bloco">
          <option value="">— sem camada</option>
          {CATEGORIES.map((cat) => (
            <optgroup key={cat} label={CATEGORY_NAMES[cat]}>
              {INSTRUMENTS.filter((i) => i.category === cat).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field small" title={canDrone ? "Nota longa na tônica durante o bloco" : `${effective.name} não tem bordão (use sitar ou gaita de foles)`}>
        <input type="checkbox" checked={!!block.drone} disabled={!canDrone} onChange={(e) => setBlockProps(blockId, { drone: e.target.checked })} aria-label="Bordão do bloco" />
        Bordão
      </label>
      <label className="field small" title="BPM ao fim do bloco: menor = ritardando, maior = accelerando">
        ♩ final
        <NumberField
          key={blockId}
          allowEmpty
          value={block.rampTo}
          min={30}
          max={300}
          placeholder={String(block.bpm ?? songBpm)}
          onCommit={(v) => setBlockProps(blockId, { rampTo: v })}
          aria-label="BPM ao fim do bloco"
          title="BPM ao fim do bloco: menor = ritardando, maior = accelerando"
        />
      </label>
    </div>
  );
}
