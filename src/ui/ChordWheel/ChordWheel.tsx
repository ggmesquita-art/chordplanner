import { useEffect, useMemo, useRef, useState } from "react";
import { getQuality, makeChord, type QualityId } from "../../core/chords";
import { chordFits, chromaticFunction, romanFor } from "../../core/diatonic";
import { chordIntervals, chordSymbol } from "../../core/modifiers";
import { fifthsPosition, mod12, type PitchClass } from "../../core/pitch";
import { useStore } from "../../state/store";
import { previewChord, useBlock, useCtx, useSpeller } from "../hooks";
import { spokenChord } from "../spoken";

const SIZE = 560;
const C = SIZE / 2;
const RINGS: { quality: QualityId; r0: number; r1: number; offset: number; label: string }[] = [
  { quality: "maj", r0: 170, r1: 240, offset: 0, label: "maiores" },
  { quality: "m", r0: 108, r1: 170, offset: 9, label: "menores" },
  { quality: "dim", r0: 58, r1: 108, offset: 11, label: "diminutos" },
];
const EXTRA_QUALITIES: QualityId[] = ["aug", "sus4", "sus2", "5"];

type SliceState = "explore" | "diatonic" | "chromatic" | "other" | "out";

const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (r: number, deg: number): [number, number] => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))];

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

/** Rotação animada (~300 ms) sempre pelo caminho mais curto. */
function useRotation(target: number): number {
  const [angle, setAngle] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    let to = target;
    while (to - current.current > 180) to -= 360;
    while (to - current.current < -180) to += 360;
    const from = current.current;
    if (from === to) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 300);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = from + (to - from) * eased;
      setAngle(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return angle;
}

export function ChordWheel() {
  const ctx = useCtx();
  const spell = useSpeller();
  const mode = useStore((s) => s.mode);
  const tonic = useStore((s) => s.tonic);
  const soundOnClick = useStore((s) => s.soundOnClick);
  const selectedChordId = useStore((s) => s.selectedChord);
  const playhead = useStore((s) => s.playhead);
  const song = useStore((s) => s.song);
  const block = useBlock();
  const { setTonic, addChord } = useStore.getState();
  const [hover, setHover] = useState<{ root: PitchClass; quality: QualityId } | null>(null);
  const [menu, setMenu] = useState<{ root: PitchClass; x: number; y: number; qualities: QualityId[] } | null>(null);
  const refs = useRef(new Map<string, SVGGElement>());

  const rotation = useRotation(tonic === null ? 0 : -fifthsPosition(tonic) * 30);

  const selected = block?.chords.find((c) => c.id === selectedChordId) ?? null;
  const playing = useMemo(() => {
    if (!playhead) return null;
    const item = song.arrangement[playhead.itemIndex];
    return item ? song.blocks[item.blockId]?.chords[playhead.chordIndex] ?? null : null;
  }, [playhead, song]);

  const previous = useMemo(() => {
    if (!block?.chords.length) return null;
    const i = block.chords.findIndex((c) => c.id === selectedChordId);
    return block.chords[i >= 0 ? i : block.chords.length - 1];
  }, [block, selectedChordId]);

  const stateOf = (root: PitchClass, quality: QualityId): SliceState => {
    if (!ctx) return "explore";
    if (chordFits(root, quality, ctx.pcSet)) return "diatonic";
    if (chromaticFunction(ctx, root, quality)) return "chromatic";
    if (ctx.pcSet.has(root)) return "other";
    return "out";
  };

  const clickable = (st: SliceState) => st === "explore" || st === "diatonic" || (st === "chromatic" && mode !== "strict") || mode === "free";

  const activate = (root: PitchClass, quality: QualityId) => {
    setMenu(null);
    if (tonic === null) {
      setTonic(root);
      return;
    }
    const st = stateOf(root, quality);
    if (!clickable(st)) return;
    const chord = addChord(root, quality);
    if (chord && soundOnClick) previewChord(chord);
  };

  const onKey = (e: React.KeyboardEvent, ring: number, pos: number, root: PitchClass, quality: QualityId) => {
    const move = (r: number, p: number) => refs.current.get(`${r}-${mod12(p)}`)?.focus();
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(root, quality);
    } else if (e.key === "ArrowRight") move(ring, pos + 1);
    else if (e.key === "ArrowLeft") move(ring, pos - 1);
    else if (e.key === "ArrowUp") move(Math.max(0, ring - 1), pos);
    else if (e.key === "ArrowDown") move(Math.min(2, ring + 1), pos);
    else return;
    e.preventDefault();
  };

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const chord = makeChord(hover.root, hover.quality);
    const pcs = chordIntervals(chord).map((i) => mod12(hover.root + i));
    const prevPcs = previous ? new Set(chordIntervals(previous).map((i) => mod12(previous.root + i))) : null;
    return {
      symbol: chordSymbol(chord, spell),
      roman: ctx ? chromaticFunction(ctx, hover.root, hover.quality)?.label ?? romanFor(ctx, hover.root, hover.quality) : "",
      notes: pcs.map(spell).join(" "),
      shared: prevPcs ? pcs.filter((pc) => prevPcs.has(pc)).map(spell) : null,
    };
  }, [hover, previous, spell, ctx]);

  const sharedPcs = useMemo(() => {
    if (!hover || !previous) return new Set<number>();
    const prev = new Set(chordIntervals(previous).map((i) => mod12(previous.root + i)));
    return new Set(getQuality(hover.quality).intervals.map((i) => mod12(hover.root + i)).filter((pc) => prev.has(pc)));
  }, [hover, previous]);

  return (
    <div className="wheel-wrap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="wheel" role="group" aria-label="Roda de acordes (círculo de quintas)">
        {RINGS.map((ring, ri) =>
          Array.from({ length: 12 }, (_, pos) => {
            const majorRoot = mod12(pos * 7);
            const root = mod12(majorRoot + ring.offset);
            const angle = pos * 30 + rotation;
            const st = stateOf(root, ring.quality);
            const can = clickable(st);
            const isTonic = tonic !== null && root === tonic && ctx?.degrees[0]?.primary === ring.quality;
            const isSel = selected && selected.root === root && selected.quality === ring.quality;
            const isPlaying = playing && playing.root === root && playing.quality === ring.quality;
            const sym = chordSymbol(makeChord(root, ring.quality), spell);
            const chromatic = st === "chromatic" && ctx ? chromaticFunction(ctx, root, ring.quality) : null;
            const roman = st === "diatonic" && ctx ? romanFor(ctx, root, ring.quality) : chromatic?.label ?? null;
            const [lx, ly] = pt((ring.r0 + ring.r1) / 2 + (roman ? 7 : 0), angle);
            const [rx, ry] = pt((ring.r0 + ring.r1) / 2 - 13, angle);
            const icon = st === "other" ? "◐" : st === "out" && mode === "free" ? "⚠" : "";
            return (
              <g
                key={`${ri}-${pos}`}
                ref={(el) => void (el ? refs.current.set(`${ri}-${pos}`, el) : refs.current.delete(`${ri}-${pos}`))}
                className={`slice ring-${ri} ${st} ${can ? "can" : ""} ${isTonic ? "tonic" : ""} ${isSel ? "selected" : ""} ${isPlaying ? "playing" : ""}`}
                tabIndex={0}
                role="button"
                aria-disabled={!can}
                aria-label={spokenChord(sym, roman, st, chromatic?.kind)}
                onClick={() => activate(root, ring.quality)}
                onKeyDown={(e) => onKey(e, ri, pos, root, ring.quality)}
                onMouseEnter={() => setHover({ root, quality: ring.quality })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ root, quality: ring.quality })}
                onBlur={() => setHover(null)}
              >
                <path d={sector(ring.r0, ring.r1, angle - 15, angle + 15)} />
                <text x={lx} y={ly} className="slice-label" textAnchor="middle" dominantBaseline="central">
                  {sym}
                  {icon && <tspan className="slice-icon"> {icon}</tspan>}
                </text>
                {chromatic && (
                  <title>
                    {chromatic.kind === "secondary" ? `Dominante secundária: ${chromatic.label} (resolve em ${chromatic.target})` : `Empréstimo modal de ${chromatic.from}: ${chromatic.label}`}
                  </title>
                )}
                {roman && (
                  <text x={rx} y={ry} className="slice-roman" textAnchor="middle" dominantBaseline="central">
                    {roman}
                  </text>
                )}
                {hover && sharedPcs.size > 0 && ri === 0 && sharedPcs.has(majorRoot) && (
                  <circle cx={pt(ring.r1 - 6, angle)[0]} cy={pt(ring.r1 - 6, angle)[1]} r={3.5} className="shared-dot" />
                )}
              </g>
            );
          }),
        )}

        {/* Badges: qualidades que não cabem nos 3 anéis (aug, sus, power chord). */}
        {ctx?.degrees.map((deg) => {
          const ringQs = new Set<QualityId>(["maj", "m", "dim"]);
          const extras = deg.qualities.filter((q) => EXTRA_QUALITIES.includes(q) && !(q === "5" && deg.qualities.some((x) => ringQs.has(x))));
          if (!extras.length) return null;
          const angle = fifthsPosition(deg.root) * 30 + rotation;
          const [bx, by] = pt(256, angle);
          return (
            <g
              key={`badge-${deg.root}`}
              className="badge"
              role="button"
              tabIndex={0}
              aria-label={`Outras qualidades em ${spell(deg.root)}: ${extras.join(", ")}`}
              onClick={() => setMenu({ root: deg.root, x: bx / SIZE, y: by / SIZE, qualities: extras })}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setMenu({ root: deg.root, x: bx / SIZE, y: by / SIZE, qualities: extras })}
            >
              <circle cx={bx} cy={by} r={13} />
              <text x={bx} y={by} textAnchor="middle" dominantBaseline="central">
                +{extras.length}
              </text>
            </g>
          );
        })}

        <circle cx={C} cy={C} r={56} className="wheel-center" />
        {hoverInfo ? (
          <g className="center-text">
            <text x={C} y={C - 16} textAnchor="middle" className="center-big">
              {hoverInfo.symbol}
            </text>
            <text x={C} y={C + 4} textAnchor="middle" className="center-small">
              {hoverInfo.roman} · {hoverInfo.notes}
            </text>
            {hoverInfo.shared && (
              <text x={C} y={C + 22} textAnchor="middle" className="center-small muted-fill">
                comum: {hoverInfo.shared.length ? hoverInfo.shared.join(" ") : "—"}
              </text>
            )}
          </g>
        ) : (
          <g className="center-text">
            <text x={C} y={C - 6} textAnchor="middle" className="center-big">
              {tonic === null ? "?" : spell(tonic)}
            </text>
            <text x={C} y={C + 16} textAnchor="middle" className="center-small">
              {tonic === null ? "escolha a tônica" : ctx?.scale.name.replace(/ \(.*\)/, "")}
            </text>
          </g>
        )}
      </svg>

      {menu && (
        <div className="radial-menu" style={{ left: `${menu.x * 100}%`, top: `${menu.y * 100}%` }} role="menu">
          {menu.qualities.map((q) => (
            <button key={q} role="menuitem" onClick={() => activate(menu.root, q)}>
              {chordSymbol(makeChord(menu.root, q), spell)}
            </button>
          ))}
          <button className="muted" onClick={() => setMenu(null)} aria-label="Fechar">
            ✕
          </button>
        </div>
      )}

      <div className="legend small">
        <span>
          <i className="sw diatonic" /> diatônico
        </span>
        <span>
          <i className="sw chromatic" /> V/x dominante secundária · empréstimo modal
        </span>
        <span>
          <i className="sw other" /> ◐ fundamental na escala, outra qualidade
        </span>
        <span>
          <i className="sw out" /> fora da escala{mode === "free" ? " (⚠ liberado)" : ""}
        </span>
      </div>
      <WheelHint />
    </div>
  );
}

/** Explica quantos acordes estão liberados e como liberar mais. */
function WheelHint() {
  const ctx = useCtx();
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  if (!ctx) return <p className="wheel-hint muted small">Clique numa fatia (ou use o seletor no topo) para definir a tônica.</p>;

  let diatonic = 0;
  let chromatic = 0;
  for (const ring of RINGS)
    for (let pc = 0; pc < 12; pc++) {
      if (chordFits(pc, ring.quality, ctx.pcSet)) diatonic++;
      else if (chromaticFunction(ctx, pc, ring.quality)) chromatic++;
    }
  const name = ctx.scale.name;
  const go = (m: "colorful" | "free", label: string) => (
    <button className="link" onClick={() => setMode(m)}>
      {label}
    </button>
  );

  return (
    <p className="wheel-hint small">
      {mode === "strict" && (
        <>
          <b>{diatonic} de 36</b> acordes cabem em {name}. {chromatic > 0 && <>{go("colorful", "Colorido")} libera +{chromatic} (dominantes secundárias e empréstimos); </>}
          {go("free", "Livre")} libera todos.
        </>
      )}
      {mode === "colorful" && (
        <>
          <b>{diatonic} diatônicos</b>
          {chromatic > 0 && (
            <>
              {" "}+ <b>{chromatic} cromáticos</b> (dominantes secundárias e empréstimos modais)
            </>
          )}{" "}
          de 36 liberados. {go("free", "Livre")} libera todos.
        </>
      )}
      {mode === "free" && <>Todos os 36 acordes liberados; os fora da escala aparecem com ⚠ na progressão.</>}
    </p>
  );
}

/** Lista por graus (alternativa à roda, mais direta para iniciantes). */
export function DegreeStrip() {
  const ctx = useCtx();
  const spell = useSpeller();
  const soundOnClick = useStore((s) => s.soundOnClick);
  const { addChord } = useStore.getState();
  if (!ctx) return null;

  const add = (root: PitchClass, q: QualityId) => {
    const chord = addChord(root, q);
    if (chord && soundOnClick) previewChord(chord);
  };

  return (
    <div className="degree-strip" aria-label="Graus da escala">
      {ctx.degrees.map((d) =>
        d.primary ? (
          <div key={d.index} className="degree">
            <button className="degree-main" onClick={() => add(d.root, d.primary!)}>
              <span className="roman">{d.roman}</span>
              <span>{chordSymbol(makeChord(d.root, d.primary), spell)}</span>
            </button>
            <div className="degree-alts">
              {d.qualities
                .filter((q) => q !== d.primary && q !== "5")
                .map((q) => (
                  <button key={q} className="chip tiny" onClick={() => add(d.root, q)} title={getQuality(q).name}>
                    {chordSymbol(makeChord(d.root, q), spell)}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div key={d.index} className="degree empty" title="Nenhuma tríade cabe neste grau">
            <span className="roman muted">{spell(d.root)}</span>
            <span className="muted small">—</span>
          </div>
        ),
      )}
    </div>
  );
}

