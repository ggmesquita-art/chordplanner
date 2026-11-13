import type { NoteStatus } from "../../core/modifiers";

const BLACK = new Set([1, 3, 6, 8, 10]);
const WHITE_W = 14;
const WHITE_H = 56;

/** Mini-teclado mostrando o voicing (cores por status da nota). */
export function MiniKeyboard({ notes, status }: { notes: number[]; status: (midi: number) => NoteStatus }) {
  const lowest = notes.length ? Math.min(...notes) : 48;
  const highest = notes.length ? Math.max(...notes) : 72;
  let lo = Math.floor(Math.min(lowest, 48) / 12) * 12;
  let hi = Math.ceil((Math.max(highest, lo + 23) + 1) / 12) * 12 - 1;
  if (hi - lo > 47) {
    lo = Math.floor(lowest / 12) * 12;
    hi = lo + 47;
  }
  const on = new Set(notes);
  const keys = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const whites = keys.filter((k) => !BLACK.has(k % 12));
  const xOf = new Map<number, number>();
  whites.forEach((k, i) => xOf.set(k, i * WHITE_W));

  return (
    <svg className="mini-keyboard" viewBox={`0 0 ${whites.length * WHITE_W} ${WHITE_H}`} role="img" aria-label="Mini-teclado com o voicing do acorde">
      {whites.map((k) => (
        <rect key={k} x={xOf.get(k)} y={0} width={WHITE_W - 1} height={WHITE_H} rx={2} className={`key white ${on.has(k) ? `on ${status(k)}` : ""}`} />
      ))}
      {keys
        .filter((k) => BLACK.has(k % 12))
        .map((k) => {
          const x = (xOf.get(k - 1) ?? 0) + WHITE_W * 0.65;
          return <rect key={k} x={x} y={0} width={WHITE_W * 0.7} height={WHITE_H * 0.6} rx={1.5} className={`key black ${on.has(k) ? `on ${status(k)}` : ""}`} />;
        })}
      {whites
        .filter((k) => k % 12 === 0)
        .map((k) => (
          <text key={`t${k}`} x={(xOf.get(k) ?? 0) + WHITE_W / 2 - 0.5} y={WHITE_H - 5} textAnchor="middle" className="key-label">
            C{Math.floor(k / 12) - 1}
          </text>
        ))}
    </svg>
  );
}
