import { mod12 } from "../../core/pitch";
import { FAMILY_NAMES, getScale, SCALES, type ScaleFamily } from "../../core/scales";
import { relativeTonic } from "../../core/view";
import { useStore } from "../../state/store";
import { useSpeller } from "../hooks";

const FAMILIES = Array.from(new Set(SCALES.map((sc) => sc.family))) as ScaleFamily[];

/** Tonalidade própria do bloco (modulação, §3.8): desligado = herda a global. Não transpõe os acordes. */
export function BlockKey({ blockId }: { blockId: string }) {
  const block = useStore((s) => s.song.blocks[blockId]);
  const globalTonic = useStore((s) => s.tonic);
  const spell = useSpeller();
  const setBlockProps = useStore.getState().setBlockProps;
  const globalScaleId = useStore((s) => s.scaleId);
  if (!block) return null;
  const key = block.key;
  const set = (tonic: number, scaleId: string) => setBlockProps(blockId, { key: { tonic, scaleId } });
  const cur = key ?? (globalTonic === null ? null : { tonic: globalTonic, scaleId: globalScaleId });
  const scale = cur ? getScale(cur.scaleId) : null;
  const relTarget = scale?.id === "major" ? "minor" : scale?.id === "minor" ? "major" : null;

  return (
    <div className="block-key">
      <label className="field small" title={globalTonic === null ? "Defina a tônica primeiro" : "Tonalidade própria deste bloco (os acordes não mudam)"}>
        <input
          type="checkbox"
          checked={!!key}
          disabled={globalTonic === null}
          onChange={(e) => {
            if (!e.target.checked) setBlockProps(blockId, { key: undefined });
            else if (cur) set(cur.tonic, cur.scaleId);
          }}
        />
        Modular
      </label>
      {key && cur && scale && (
        <>
          <label className="field small">
            Tom do bloco
            <select value={key.tonic} onChange={(e) => set(Number(e.target.value), key.scaleId)} aria-label="Tônica do bloco">
              {Array.from({ length: 12 }, (_, pc) => (
                <option key={pc} value={pc}>
                  {spell(pc)}
                </option>
              ))}
            </select>
          </label>
          <select value={key.scaleId} onChange={(e) => set(key.tonic, e.target.value)} aria-label="Escala do bloco">
            {FAMILIES.map((f) => (
              <optgroup key={f} label={FAMILY_NAMES[f]}>
                {SCALES.filter((sc) => sc.family === f).map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="btn small" title="Quarta acima (IV)" onClick={() => set(mod12(key.tonic + 5), key.scaleId)}>
            IV
          </button>
          <button className="btn small" title="Quinta acima (V)" onClick={() => set(mod12(key.tonic + 7), key.scaleId)}>
            V
          </button>
          <button
            className="btn small"
            disabled={!relTarget}
            title={relTarget ? "Relativa maior/menor" : "Só para jônio/eólio"}
            onClick={() => relTarget && set(relativeTonic(key.tonic, scale, getScale(relTarget)), relTarget)}
          >
            relativa
          </button>
        </>
      )}
    </div>
  );
}
