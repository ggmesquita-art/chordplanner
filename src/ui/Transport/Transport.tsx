import { useRef } from "react";
import { blockMeter } from "../../core/song";
import type { PlaybackPattern } from "../../core/song";
import { METERS, meterLabel, type Meter } from "../../core/timeline";
import { selectRegion, useStore } from "../../state/store";
import { togglePlay } from "../hooks";
import { NumberField } from "../NumberField";
import { PATTERNS } from "../patterns";
import { MidiPanel } from "./MidiPanel";

export function Transport() {
  const song = useStore((s) => s.song);
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const loop = useStore((s) => s.loop);
  const scope = useStore((s) => s.playScope);
  const hasRegion = useStore((s) => selectRegion(s) !== null);
  const metronome = useStore((s) => s.metronome);
  const countIn = useStore((s) => s.countIn);
  const follow = useStore((s) => s.followPlayback);
  const { setBpm, setMeter, setSwing, setLoop, setPlayScope, setMetronome, setCountIn, setPattern, setFollowPlayback } = useStore.getState();
  const taps = useRef<number[]>([]);

  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now].slice(-6);
    if (taps.current.length >= 3) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    }
  };

  let position = "—";
  if (playhead) {
    const item = song.arrangement[playhead.itemIndex];
    const block = item && song.blocks[item.blockId];
    if (block) position = `${block.name} · acorde ${playhead.chordIndex + 1} · ${meterLabel(blockMeter(song, block))}`;
  }

  return (
    <div className="transport" role="toolbar" aria-label="Transporte">
      <button className={`play ${playing ? "on" : ""}`} onClick={() => void togglePlay()} aria-label={playing ? "Parar" : "Tocar"} title="Tocar/parar (Espaço)">
        {playing ? "■" : "▶"}
      </button>
      <button className={`toggle ${loop ? "on" : ""}`} onClick={() => setLoop(!loop)} title="Loop" aria-pressed={loop}>
        ⟲ Loop
      </button>
      <div className="segmented small" role="radiogroup" aria-label="O que tocar">
        <button className={scope === "song" ? "on" : ""} onClick={() => setPlayScope("song")} aria-checked={scope === "song"} role="radio">
          Arranjo
        </button>
        <button className={scope === "block" ? "on" : ""} onClick={() => setPlayScope("block")} aria-checked={scope === "block"} role="radio">
          Bloco
        </button>
        <button
          className={scope === "region" ? "on" : ""}
          onClick={() => setPlayScope("region")}
          aria-checked={scope === "region"}
          role="radio"
          disabled={!hasRegion}
          title={hasRegion ? "Tocar só os acordes da região selecionada" : "Selecione um acorde e Shift+clique em outro para marcar a região"}
        >
          Região
        </button>
      </div>
      <label className="field">
        ♩=
        <NumberField value={song.bpm} min={30} max={300} onCommit={(v) => v !== undefined && setBpm(v)} aria-label="BPM" />
      </label>
      <button className="toggle" onClick={tap} title="Toque no ritmo para definir o BPM">
        Tap
      </button>
      <label className="field">
        <select value={meterLabel(song.meter)} onChange={(e) => setMeter(METERS.find((m) => meterLabel(m) === e.target.value) as Meter)} aria-label="Fórmula de compasso">
          {METERS.map((m) => (
            <option key={meterLabel(m)}>{meterLabel(m)}</option>
          ))}
        </select>
      </label>
      <label className="field" title="Swing nas colcheias">
        swing
        <input type="range" min={0} max={75} step={5} value={song.swing} onChange={(e) => setSwing(Number(e.target.value))} aria-label="Swing" />
        <span className="mono">{song.swing}%</span>
      </label>
      <label className="field">
        <select value={song.pattern} onChange={(e) => setPattern(e.target.value as PlaybackPattern)} aria-label="Padrão de execução">
          {PATTERNS.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <button className={`toggle ${metronome ? "on" : ""}`} onClick={() => setMetronome(!metronome)} aria-pressed={metronome} title="Metrônomo">
        🔔 Metrônomo
      </button>
      <button className={`toggle ${countIn ? "on" : ""}`} onClick={() => setCountIn(!countIn)} aria-pressed={countIn} title="Um compasso de contagem antes de tocar">
        ⏺ Contagem
      </button>
      <MidiPanel />
      <button className={`toggle ${follow ? "on" : ""}`} onClick={() => setFollowPlayback(!follow)} aria-pressed={follow} title="A progressão acompanha o bloco que está tocando">
        ↪ Seguir
      </button>
      <div className="position mono" aria-live="polite">
        ⏱ {position}
      </div>
    </div>
  );
}
