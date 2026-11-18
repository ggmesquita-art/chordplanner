import { GUITAR_TUNING, guitarVoicing } from "../../core/fretboard";
import type { Chord } from "../../core/chords";
import { midiStatus } from "../../core/view";
import type { ResolvedChord } from "../../core/modifiers";

const X0 = 22;
const DX = 12;
const Y0 = 22;
const DY = 15;
const FRETS = 5;

/** Diagrama de braço (violão): digitação sugerida do acorde, pontos coloridos pelo status da nota. */
export function Fretboard({ chord, resolved }: { chord: Chord; resolved: ResolvedChord }) {
  const v = guitarVoicing(chord);
  if (!v) return <p className="muted small fretboard-empty">Sem digitação simples para este acorde</p>;

  const { strings, baseFret } = v;
  const x = (s: number) => X0 + s * DX;
  const y = (fret: number) => Y0 + (fret - baseFret + 0.5) * DY;
  const fretted = strings.flatMap((f, s) => (f !== null && f > 0 ? [{ s, f }] : []));
  // Pestana: o dedo da menor casa cobre várias cordas quando há mais de 4 casas pressionadas.
  const low = fretted.length ? Math.min(...fretted.map((n) => n.f)) : 0;
  const onLow = fretted.filter((n) => n.f === low);
  const barre = fretted.length > 4 && onLow.length >= 2 ? { from: onLow[0].s, to: onLow[onLow.length - 1].s } : null;
  const code = strings.map((f) => (f === null ? "x" : f)).join(strings.some((f) => f !== null && f > 9) ? "-" : "");

  return (
    <svg className="fretboard" viewBox="0 0 100 112" role="img" aria-label={`Violão: ${code} — ${resolved.symbol}`}>
      {baseFret === 1 && <rect x={X0 - 1} y={Y0 - 3} width={5 * DX + 2} height={3} className="fb-nut" />}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line key={`f${i}`} x1={X0} x2={x(5)} y1={Y0 + i * DY} y2={Y0 + i * DY} className="fb-fret" />
      ))}
      {strings.map((_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={Y0} y2={Y0 + FRETS * DY} className="fb-string" />
      ))}
      {baseFret > 1 && (
        <text x={X0 - 8} y={y(baseFret) + 3} textAnchor="end" className="fb-label">
          {baseFret}
        </text>
      )}
      {strings.map((f, s) =>
        f === null ? (
          <text key={`m${s}`} x={x(s)} y={Y0 - 8} textAnchor="middle" className="fb-mark">
            ×
          </text>
        ) : f === 0 ? (
          <circle key={`m${s}`} cx={x(s)} cy={Y0 - 10} r={3.2} className={`fb-open ${midiStatus(resolved, GUITAR_TUNING[s])}`} />
        ) : null,
      )}
      {barre && <rect x={x(barre.from) - 4} y={y(low) - 4} width={x(barre.to) - x(barre.from) + 8} height={8} rx={4} className="fb-barre" />}
      {fretted.map(({ s, f }) => (
        <circle key={`d${s}`} cx={x(s)} cy={y(f)} r={4.6} className={`fb-dot ${midiStatus(resolved, GUITAR_TUNING[s] + f)}`} />
      ))}
    </svg>
  );
}
