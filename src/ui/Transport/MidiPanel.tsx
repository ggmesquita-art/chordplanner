import { previewNotes } from "../../audio/engine";
import { initMidi } from "../../audio/midi";
import { useStore } from "../../state/store";
import { currentInstrument, useMidiState } from "../hooks";
import { usePopover } from "../usePopover";

/** Saída MIDI para DAW/plugins (ex.: Ableton via IAC Driver). */
export function MidiPanel() {
  const midi = useStore((s) => s.midi);
  const setMidi = useStore((s) => s.setMidi);
  const { status, ports } = useMidiState();
  const { open, setOpen, ref } = usePopover();
  const selected = ports.find((p) => p.id === midi.outputId) ?? ports[0];
  const on = midi.enabled && status === "ready" && !!selected;

  const enable = async (v: boolean) => {
    if (v) await initMidi();
    setMidi({ enabled: v, outputId: midi.outputId ?? ports[0]?.id ?? null });
  };

  return (
    <div className="picker" ref={ref}>
      <button className={`toggle ${on ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} title="Saída MIDI para o seu DAW">
        🎛 MIDI{on ? ` · ${selected.name}` : ""}
      </button>
      {open && (
        <div className="popover midi-pop">
          <div className="group-title">Saída MIDI</div>
          {status === "unsupported" ? (
            <p className="pad-x warn">
              Este navegador não tem Web MIDI (o Safari não suporta). Abra o ChordPlanner no <b>Chrome</b> ou Edge.
            </p>
          ) : (
            <div className="midi-body">
              <label className="check">
                <input type="checkbox" checked={midi.enabled} onChange={(e) => void enable(e.target.checked)} />
                Enviar notas por MIDI
              </label>
              {status === "denied" && <p className="warn small">Permissão de MIDI negada. Libere nas configurações do site (ícone ao lado do endereço).</p>}
              {status === "requesting" && <p className="muted small">Aguardando permissão do navegador…</p>}
              {midi.enabled && status === "ready" && (
                <>
                  <label className="field">
                    Porta
                    <select value={selected?.id ?? ""} onChange={(e) => setMidi({ outputId: e.target.value })}>
                      {!ports.length && <option value="">— nenhuma porta —</option>}
                      {ports.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!ports.length && (
                    <p className="warn small">
                      Nenhuma porta MIDI. No macOS, ative o <b>IAC Driver</b>: app “Configuração de Áudio e MIDI” → Janela → Mostrar Estúdio MIDI → IAC Driver → “Dispositivo online”.
                    </p>
                  )}
                  <label className="field">
                    Canal
                    <select value={midi.channel} onChange={(e) => setMidi({ channel: Number(e.target.value) })}>
                      {Array.from({ length: 16 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                    <span className="muted small">(blocos podem usar outro)</span>
                  </label>
                  <label className="field" title="Compensa a diferença entre o som do navegador e o do DAW">
                    Latência
                    <input type="range" min={-150} max={150} step={5} value={midi.latencyMs} onChange={(e) => setMidi({ latencyMs: Number(e.target.value) })} />
                    <span className="mono">{midi.latencyMs} ms</span>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={midi.muteBrowser} onChange={(e) => setMidi({ muteBrowser: e.target.checked })} />
                    Silenciar o som do navegador
                  </label>
                  <button className="btn" disabled={!ports.length} onClick={() => void previewNotes([48, 60, 64, 67], currentInstrument())}>
                    ▶ Testar (acorde de Dó)
                  </button>
                  <details className="small muted">
                    <summary>Como receber no Ableton</summary>
                    <ol>
                      <li>Ative o IAC Driver (acima) no macOS.</li>
                      <li>Ableton → Settings → Link, Tempo &amp; MIDI → em “IAC Driver”, ligue <b>Track</b> na entrada.</li>
                      <li>Crie uma faixa MIDI com o seu plugin (Massive, Sylenth1…), MIDI From: IAC Driver, e arme a faixa (ou Monitor: In).</li>
                      <li>Toque aqui (Espaço). Se o som vier adiantado ou atrasado, ajuste a latência.</li>
                    </ol>
                  </details>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
