import type { TrackBus } from "../../audio/status";
import { useStore } from "../../state/store";

type Props = {
  track: TrackBus;
  label: string;
};

/** Controles compactos de Mute (M), Solo (S) e Volume por pista (Melodia / Acordes). */
export function TrackMixControls({ track, label }: Props) {
  const mix = useStore((s) => s.mixer[track]);
  const setTrackMix = useStore((s) => s.setTrackMix);

  return (
    <div className="track-mix" role="group" aria-label={`Mixer de ${label}`}>
      <button
        type="button"
        className={`btn tiny mix-btn ${mix.muted ? "active-mute" : ""}`}
        aria-pressed={mix.muted}
        aria-label={`Silenciar ${label}`}
        title={`Mute (${label})`}
        onClick={() => setTrackMix(track, { muted: !mix.muted })}
      >
        M
      </button>
      <button
        type="button"
        className={`btn tiny mix-btn ${mix.solo ? "active-solo" : ""}`}
        aria-pressed={mix.solo}
        aria-label={`Solo ${label}`}
        title={`Solo (${label})`}
        onClick={() => setTrackMix(track, { solo: !mix.solo })}
      >
        S
      </button>
      <input
        type="range"
        className="mix-vol"
        min={0}
        max={1.5}
        step={0.05}
        value={mix.volume}
        aria-label={`Volume de ${label}`}
        title={`Volume de ${label}: ${Math.round(mix.volume * 100)}%`}
        onChange={(e) => setTrackMix(track, { volume: Number(e.target.value) })}
      />
    </div>
  );
}
