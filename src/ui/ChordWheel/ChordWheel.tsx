import { useEffect, useMemo, useRef, useState } from "react";
import { getQuality, makeChord, type QualityId } from "../../core/chords";
import { nextChordSuggestions } from "../../core/analysis";
import type { SeventhInfo } from "../../core/diatonic";
import { chordSymbol } from "../../core/modifiers";
import { fifthsPosition, mod12, type PitchClass } from "../../core/pitch";
import { WHEEL_RINGS, chromaticTitle, extraQualities, hoverChordInfo, sliceClickable, shortScaleName, sliceState, wheelCounts, wheelSlices } from "../../core/view";
import { useStore } from "../../state/store";
import { previewChord, useBlock, useCtx, useSpeller } from "../hooks";
import { spokenChord } from "../spoken";
import { sharedPitchClasses } from "./shared";

const SIZE = 560;
const C = SIZE / 2;
const RADII: [number, number][] = [
  [170, 240],
  [108, 170],
  [58, 108],
];
const RINGS = WHEEL_RINGS.map((ring, i) => ({ ...ring, r0: RADII[i][0], r1: RADII[i][1] }));

const HOVER_DELAY = 250;

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
  // Movimento reduzido: sem animação, o ângulo é sempre o alvo.
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (reduced) {
      current.current = target;
      return;
    }
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
  }, [target, reduced]);
  return reduced ? target : angle;
}

export function ChordWheel() {
  const ctx = useCtx();
  const spell = useSpeller();
  const mode = useStore((s) => s.mode);
  const tonic = useStore((s) => s.tonic);
  const globalScaleId = useStore((s) => s.scaleId);
  const soundOnClick = useStore((s) => s.soundOnClick);
  const selectedChordId = useStore((s) => s.selectedChord);
  const playhead = useStore((s) => s.playhead);
  const song = useStore((s) => s.song);
  const block = useBlock();
  const { setTonic, addChord } = useStore.getState();
  const [hover, setHover] = useState<{ root: PitchClass; quality: QualityId } | null>(null);
  const [suggest, setSuggest] = useState(true);
  const [menu, setMenu] = useState<{ root: PitchClass; x: number; y: number; qualities: QualityId[] } | null>(null);
  const refs = useRef(new Map<string, SVGGElement>());
  const badgeRefs = useRef(new Map<number, SVGGElement>());
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPlayed = useRef<string | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => clearHoverTimer, []);

  // Menu radial: foco no primeiro item ao abrir; Esc e clique fora fecham.
  const menuRoot = menu?.root;
  useEffect(() => {
    if (menuRoot === undefined) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || badgeRefs.current.get(menuRoot)?.contains(t)) return;
      setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setMenu(null);
      badgeRefs.current.get(menuRoot)?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuRoot]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + dir + items.length) % items.length]?.focus();
    e.preventDefault();
  };

  const onSliceEnter = (e: React.PointerEvent, key: string, root: PitchClass, quality: QualityId, can: boolean) => {
    clearHoverTimer();
    const { soundOnHover } = useStore.getState();
    if (!soundOnHover || !can || e.pointerType !== "mouse" || hoverPlayed.current === key) return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      if (!useStore.getState().soundOnHover || useStore.getState().playing) return;
      hoverPlayed.current = key;
      previewChord(makeChord(root, quality));
    }, HOVER_DELAY);
  };
  const onSliceLeave = () => {
    clearHoverTimer();
    hoverPlayed.current = null;
  };

  // A roda gira para a tônica do BLOCO selecionado (modulação) — ou a global.
  const rotation = useRotation(ctx === null ? 0 : -fifthsPosition(ctx.tonic) * 30);

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

  const slices = useMemo(() => wheelSlices(ctx, mode), [ctx, mode]);

  // Próximo acorde: histórico = acordes do bloco até o selecionado (ou o bloco todo).
  const suggestions = useMemo(() => {
    if (!suggest || !ctx || !block) return new Map<string, { weight: number; reason: string }>();
    const at = block.chords.findIndex((c) => c.id === selectedChordId);
    const history = at >= 0 ? block.chords.slice(0, at + 1) : block.chords;
    return new Map(nextChordSuggestions(ctx, history).map((s) => [`${s.root}-${s.quality}`, s]));
  }, [suggest, ctx, block, selectedChordId]);

  const activate = (root: PitchClass, quality: QualityId) => {
    // Menu radial: devolve o foco ao badge que o abriu (o menu some ao escolher).
    if (menu) badgeRefs.current.get(menu.root)?.focus();
    setMenu(null);
    if (tonic === null) {
      setTonic(root);
      return;
    }
    if (!sliceClickable(sliceState(ctx, root, quality), mode)) return;
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
    const info = hoverChordInfo(ctx, hover, previous);
    return {
      symbol: chordSymbol(info.chord, spell),
      roman: info.roman,
      notes: info.pcs.map(spell).join(" "),
      shared: info.shared?.map(spell) ?? null,
    };
  }, [hover, previous, spell, ctx]);

  const sharedPcs = useMemo(() => sharedPitchClasses(hover, previous), [hover, previous]);

  return (
    <div className="wheel-wrap">
      <label className="wheel-suggest small">
        <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> Sugestões
      </label>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="wheel" role="group" aria-label="Roda de acordes (círculo de quintas)">
        {RINGS.map((ring, ri) =>
          Array.from({ length: 12 }, (_, pos) => {
            const { root, state: st, clickable: can, chromatic, roman, icon } = slices[ri][pos];
            const angle = pos * 30 + rotation;
            const isTonic = ctx !== null && root === ctx.tonic && ctx.degrees[0]?.primary === ring.quality;
            const isSel = selected && selected.root === root && selected.quality === ring.quality;
            const isPlaying = playing && playing.root === root && playing.quality === ring.quality;
            const sym = chordSymbol(makeChord(root, ring.quality), spell);
            const [lx, ly] = pt((ring.r0 + ring.r1) / 2 + (roman ? 7 : 0), angle);
            const [rx, ry] = pt((ring.r0 + ring.r1) / 2 - 13, angle);
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
                onPointerEnter={(e) => onSliceEnter(e, `${ri}-${pos}`, root, ring.quality, can)}
                onPointerLeave={onSliceLeave}
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
                    {chromaticTitle(chromatic, true)}
                  </title>
                )}
                {roman && (
                  <text x={rx} y={ry} className="slice-roman" textAnchor="middle" dominantBaseline="central">
                    {roman}
                  </text>
                )}
                {hover && sharedPcs.size > 0 && sharedPcs.has(root) && (
                  <circle cx={pt(ring.r1 - 6, angle)[0]} cy={pt(ring.r1 - 6, angle)[1]} r={3.5} className="shared-dot" />
                )}
                {(() => {
                  const sg = suggestions.get(`${root}-${ring.quality}`);
                  if (!sg) return null;
                  const [dx, dy] = pt(ring.r0 + 9, angle);
                  return (
                    <circle cx={dx} cy={dy} r={5} className="suggest-dot" opacity={0.25 + 0.75 * sg.weight}>
                      <title>{`Sugestão: ${sg.reason}`}</title>
                    </circle>
                  );
                })()}
              </g>
            );
          }),
        )}

        {/* Badges: qualidades que não cabem nos 3 anéis (aug, sus, power chord). */}
        {ctx?.degrees.map((deg) => {
          const extras = extraQualities(deg);
          if (!extras.length) return null;
          const angle = fifthsPosition(deg.root) * 30 + rotation;
          const [bx, by] = pt(256, angle);
          return (
            <g
              key={`badge-${deg.root}`}
              ref={(el) => void (el ? badgeRefs.current.set(deg.root, el) : badgeRefs.current.delete(deg.root))}
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
              {ctx === null ? "?" : spell(ctx.tonic)}
            </text>
            <text x={C} y={C + 16} textAnchor="middle" className="center-small">
              {ctx === null ? "escolha a tônica" : shortScaleName(ctx.scale.id)}
            </text>
            {ctx !== null && tonic !== null && (ctx.tonic !== tonic || ctx.scale.id !== globalScaleId) && (
              <text x={C} y={C + 32} textAnchor="middle" className="center-small muted-fill">
                modulação
              </text>
            )}
          </g>
        )}
      </svg>

      {menu && (
        <div className="radial-menu" ref={menuRef} onKeyDown={onMenuKey} style={{ left: `${menu.x * 100}%`, top: `${menu.y * 100}%` }} role="menu">
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

  const { diatonic, chromatic } = wheelCounts(ctx);
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
              {" "}+ <b>{chromatic} cromáticos</b> (dominantes secundárias, empréstimos modais, ii/x e subV)
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
  const { addChord, toggleMod } = useStore.getState();
  if (!ctx) return null;

  const add = (root: PitchClass, q: QualityId) => {
    const chord = addChord(root, q);
    if (chord && soundOnClick) previewChord(chord);
  };

  const addSeventh = (root: PitchClass, sv: SeventhInfo) => {
    const chord = addChord(root, sv.quality);
    if (!chord) return;
    for (const m of sv.modifiers) toggleMod(chord.id, m);
    if (soundOnClick) previewChord({ ...chord, modifiers: sv.modifiers });
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
              {d.sevenths.map((sv) => (
                <button key={sv.label} className="chip tiny seventh" onClick={() => addSeventh(d.root, sv)} title={`Sétima: ${sv.label}`}>
                  {chordSymbol({ ...makeChord(d.root, sv.quality), modifiers: sv.modifiers }, spell)}
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

