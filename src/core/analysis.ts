// Análise funcional e sugestão do próximo acorde (DESIGN §3.7). Funções puras.
//
// Função harmônica (T / SD / D) pelo INTERVALO da fundamental até a tônica (o "grau"),
// só em escalas heptatônicas com 3ª (maior ou menor) e 5ª justa definidas; senão, null:
//  - T  (repouso): I; III e ♭III (relativos/mediante, substituem a tônica); VI (substitui a
//    tônica) e ♭VI diatônico (menor: o VI faz cadência deceptiva V→♭VI e repousa);
//  - SD (afastamento): II, IV, ♭II (napolitano) e o ♭VI emprestado do menor (vem de iv–♭VI);
//  - D  (tensão que pede resolução): V, VII/vii° (sensível), ♭VII (subtônica, "porta dos
//    fundos" ♭VII–I) e ♯IV/♭V só se diminuto (tem trítono com a tônica).
// Cromáticos: dominante secundária → D (do grau-alvo); ii secundário → SD (prepara o V/x);
// empréstimos modais → pela tabela acima. Acorde fora da escala e sem função idiomática → null.

import type { Chord, QualityId } from "./chords";
import { chordFits, chromaticFunction, tonicChord, type ScaleContext } from "./diatonic";
import { mod12, type PitchClass } from "./pitch";
import { WHEEL_RINGS, sliceClickable, sliceState } from "./view";

export type HarmonicFunction = "T" | "SD" | "D";
type ChordLike = Pick<Chord, "root" | "quality" | "modifiers">;

export const FUNCTION_NAME: Record<HarmonicFunction, string> = { T: "Tônica", SD: "Subdominante", D: "Dominante" };

/** Função pelo intervalo (semitons) acima da tônica; `diatonic` decide o ♭VI (T no menor, SD emprestado). */
function byInterval(interval: number, quality: QualityId, diatonic: boolean): HarmonicFunction | null {
  switch (interval) {
    case 0: case 3: case 4: case 9: return "T";
    case 1: case 2: case 5: return "SD";
    case 6: return quality === "dim" ? "D" : null;
    case 7: case 10: case 11: return "D";
    case 8: return diatonic ? "T" : "SD";
    default: return null;
  }
}

export function harmonicFunction(ctx: ScaleContext, chord: ChordLike): HarmonicFunction | null {
  const iv = new Set(ctx.scale.intervals);
  if (ctx.pcs.length !== 7 || iv.has(3) === iv.has(4) || !iv.has(7)) return null;
  const interval = mod12(chord.root - ctx.tonic);
  if (chordFits(chord.root, chord.quality, ctx.pcSet)) return byInterval(interval, chord.quality, true);
  const chromatic = chromaticFunction(ctx, chord.root, chord.quality);
  if (!chromatic) return null;
  if (chromatic.kind === "secondary" || chromatic.kind === "subV") return "D";
  if (chromatic.kind === "supertonic") return "SD";
  return byInterval(interval, chord.quality, false);
}

// ——— Sugestões ——————————————————————————————————————————————————————

export type Suggestion = { root: PitchClass; quality: QualityId; weight: number; reason: string };

/** Padrão de acorde: intervalo da fundamental acima da tônica e qualidades aceitas. */
type Pat = [interval: number, ...qualities: QualityId[]];
type Rule = { from: Pat[]; to: Pat; weight: number; reason: string };

const MAJOR_RULES: Rule[] = (() => {
  const I: Pat = [0, "maj"], ii: Pat = [2, "m"], iii: Pat = [4, "m"], IV: Pat = [5, "maj"], iv: Pat = [5, "m"];
  const V: Pat = [7, "maj"], vi: Pat = [9, "m"], vii: Pat = [11, "dim"], bVI: Pat = [8, "maj"], bVII: Pat = [10, "maj"];
  return [
    { from: [], to: I, weight: 0.9, reason: "tônica" },
    { from: [], to: IV, weight: 0.6, reason: "subdominante" },
    { from: [], to: V, weight: 0.55, reason: "dominante" },
    { from: [ii, V], to: I, weight: 0.95, reason: "ii–V–I" },
    { from: [ii], to: V, weight: 0.9, reason: "ii–V–I" },
    { from: [V], to: I, weight: 0.85, reason: "dominante → tônica" },
    { from: [vii], to: I, weight: 0.7, reason: "sensível → tônica" },
    { from: [V], to: vi, weight: 0.35, reason: "cadência deceptiva" },
    { from: [IV], to: V, weight: 0.6, reason: "I–vi–IV–V" },
    { from: [IV], to: I, weight: 0.45, reason: "cadência plagal" },
    { from: [vi], to: ii, weight: 0.55, reason: "vi–ii–V–I" },
    { from: [vi], to: IV, weight: 0.5, reason: "I–vi–IV–V" },
    { from: [I], to: vi, weight: 0.5, reason: "I–vi–IV–V" },
    { from: [I], to: IV, weight: 0.5, reason: "subdominante" },
    { from: [I], to: V, weight: 0.45, reason: "dominante" },
    { from: [I], to: ii, weight: 0.4, reason: "ii–V–I" },
    { from: [iii], to: vi, weight: 0.5, reason: "iii–vi–ii–V" },
    { from: [IV], to: iv, weight: 0.3, reason: "empréstimo do menor" },
    { from: [iv], to: I, weight: 0.4, reason: "plagal menor" },
    { from: [bVII], to: I, weight: 0.5, reason: "♭VII–I" },
    { from: [bVI], to: bVII, weight: 0.4, reason: "♭VI–♭VII–I" },
  ];
})();

const MINOR_RULES: Rule[] = (() => {
  const i: Pat = [0, "m"], ii: Pat = [2, "dim"], bIII: Pat = [3, "maj"], iv: Pat = [5, "m"];
  const V: Pat = [7, "maj"], v: Pat = [7, "m"], bVI: Pat = [8, "maj"], bVII: Pat = [10, "maj"];
  return [
    { from: [], to: i, weight: 0.9, reason: "tônica" },
    { from: [], to: iv, weight: 0.55, reason: "subdominante" },
    { from: [], to: V, weight: 0.5, reason: "dominante" },
    { from: [i], to: bVI, weight: 0.5, reason: "i–♭VI–♭III–♭VII" },
    { from: [bVI, bIII], to: bVII, weight: 0.8, reason: "i–♭VI–♭III–♭VII" },
    { from: [bVI], to: bIII, weight: 0.55, reason: "i–♭VI–♭III–♭VII" },
    { from: [bIII], to: bVII, weight: 0.55, reason: "i–♭VI–♭III–♭VII" },
    { from: [bVII], to: i, weight: 0.6, reason: "♭VII → tônica" },
    { from: [i], to: iv, weight: 0.5, reason: "subdominante" },
    { from: [iv], to: V, weight: 0.55, reason: "iv–V–i" },
    { from: [iv], to: v, weight: 0.45, reason: "iv–v–i" },
    { from: [V], to: i, weight: 0.85, reason: "dominante → tônica" },
    { from: [v], to: i, weight: 0.6, reason: "v → tônica" },
    { from: [ii], to: V, weight: 0.65, reason: "ii°–V–i" },
    { from: [ii], to: v, weight: 0.5, reason: "ii°–v–i" },
    { from: [i], to: bVII, weight: 0.4, reason: "i–♭VII–♭VI" },
    { from: [bVII], to: bVI, weight: 0.4, reason: "i–♭VII–♭VI" },
    { from: [bVI], to: V, weight: 0.4, reason: "♭VI–V" },
    { from: [bIII], to: iv, weight: 0.35, reason: "♭III–iv" },
    { from: [i], to: bIII, weight: 0.35, reason: "relativa maior" },
  ];
})();

const matches = (pat: Pat, interval: number, quality: QualityId) => pat[0] === interval && pat.slice(1).includes(quality);

/** Regra genérica T → SD → D → T para os acordes diatônicos sem regra específica. */
const NEXT_FUNCTION: Record<HarmonicFunction, { to: HarmonicFunction; weight: number; reason: string }> = {
  T: { to: "SD", weight: 0.3, reason: "tônica → subdominante" },
  SD: { to: "D", weight: 0.35, reason: "subdominante → dominante" },
  D: { to: "T", weight: 0.4, reason: "dominante → tônica" },
};

/**
 * Próximo acorde mais provável a partir dos últimos acordes: progressões comuns
 * (ii–V–I, I–vi–IV–V, i–♭VI–♭III–♭VII…), resolução de dominantes/ii secundários e a
 * regra de função. Só devolve acordes clicáveis na roda no modo Colorido. Pesos 0–1, em ordem decrescente.
 */
export function nextChordSuggestions(ctx: ScaleContext, history: Chord[], max = 3): Suggestion[] {
  const iv = new Set(ctx.scale.intervals);
  const rules = iv.has(4) ? MAJOR_RULES : iv.has(3) ? MINOR_RULES : [];
  const last = history.at(-1);
  const lastFn = last ? harmonicFunction(ctx, last) : null;
  const lastChromatic = last ? chromaticFunction(ctx, last.root, last.quality) : null;
  const relative = (c: { root: PitchClass }) => mod12(c.root - ctx.tonic);
  const applicable = rules.filter((r) => (r.from.length ? r.from.length <= history.length : history.length === 0) && r.from.every((p, k) => {
    const h = history[history.length - r.from.length + k];
    return matches(p, relative(h), h.quality);
  }));

  const out: Suggestion[] = [];
  for (let step = 0; step < 12; step++) {
    const root = mod12(ctx.tonic + step);
    for (const ring of WHEEL_RINGS) {
      const quality = ring.quality;
      if (!sliceClickable(sliceState(ctx, root, quality), "colorful")) continue;
      if (last && last.root === root && last.quality === quality) continue;
      let best: { weight: number; reason: string } | null = null;
      const offer = (weight: number, reason: string) => {
        if (!best || weight > best.weight) best = { weight, reason };
      };
      for (const r of applicable) if (matches(r.to, step, quality)) offer(r.weight, r.reason);
      // Só a qualidade primária do grau-alvo (D maior não empata com Dm depois de A maior em Dó).
      const primaryAt = ctx.degrees.find((d) => d.root === root)?.primary;
      if (lastChromatic?.kind === "secondary" && root === mod12(last!.root + 5) && quality === primaryAt) offer(0.85, `resolve ${lastChromatic.label}`);
      if (lastChromatic?.kind === "subV" && root === mod12(last!.root - 1) && quality === tonicChord(ctx)) offer(0.85, "subV → tônica");
      if (lastChromatic?.kind === "supertonic" && quality === "maj" && root === mod12(last!.root + 5)) offer(0.75, "ii–V secundário");
      if (lastFn && chordFits(root, quality, ctx.pcSet)) {
        const next = NEXT_FUNCTION[lastFn];
        if (harmonicFunction(ctx, { root, quality, modifiers: [] }) === next.to) offer(next.weight, next.reason);
      }
      if (best) out.push({ root, quality, ...(best as { weight: number; reason: string }) });
    }
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, max);
}
