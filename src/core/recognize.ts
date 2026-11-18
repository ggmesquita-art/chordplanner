// Reconhecedor puro de acordes a partir de notas MIDI. Reusa a teoria de
// modifiers.ts (chordIntervals/conflictsWith); a tabela mascara→leituras é
// calculada uma vez, de forma preguiçosa.

import { QUALITIES, type QualityId } from "./chords";
import { chordFits, type ScaleContext } from "./diatonic";
import { chordIntervals, conflictsWith, type Modifier } from "./modifiers";
import { mod12, type PitchClass } from "./pitch";

export type Recognized = { root: PitchClass; quality: QualityId; modifiers: Modifier[]; bass?: PitchClass };

const ALL_MODIFIERS: Modifier[] = [
  ...([6, 7, "maj7", 9, 11, 13] as const).map((value): Modifier => ({ kind: "ext", value })),
  ...([2, 4] as const).map((value): Modifier => ({ kind: "sus", value })),
  ...([9, 11, 13] as const).map((value): Modifier => ({ kind: "add", value })),
  ...(["b5", "#5", "b9", "#9", "#11", "b13"] as const).map((value): Modifier => ({ kind: "alt", value })),
  ...([3, 5] as const).map((value): Modifier => ({ kind: "omit", value })),
];

const QUALITY_COST: Record<QualityId, number> = { maj: 0, m: 0, "5": 1, dim: 2, sus4: 2, aug: 3, sus2: 3 };
const BASS_COST = 7;
const SCALE_BONUS = 3;
/** Leituras mais caras que isto (antes do bônus de escala) são rebuscadas demais: tratadas como "sem leitura". */
const MAX_COST = 45;

type Rep = { quality: QualityId; modifiers: Modifier[]; cost: number };

function modifiersCost(mods: Modifier[]): number {
  let c = 0;
  for (const m of mods) c += 10 + (m.kind === "omit" ? 6 : m.kind === "alt" ? 4 : 0);
  return c;
}

/** Subconjuntos sem conflito de até 3 modificadores, em ordem estável (tamanho crescente). */
function modifierSubsets(): Modifier[][] {
  const out: Modifier[][] = [[]];
  const n = ALL_MODIFIERS.length;
  const ok = (cur: Modifier[], m: Modifier) => cur.every((x) => !conflictsWith(x, m));
  for (let i = 0; i < n; i++) {
    out.push([ALL_MODIFIERS[i]]);
    for (let j = i + 1; j < n; j++) {
      if (!ok([ALL_MODIFIERS[i]], ALL_MODIFIERS[j])) continue;
      out.push([ALL_MODIFIERS[i], ALL_MODIFIERS[j]]);
      for (let k = j + 1; k < n; k++) {
        if (ok([ALL_MODIFIERS[i], ALL_MODIFIERS[j]], ALL_MODIFIERS[k])) out.push([ALL_MODIFIERS[i], ALL_MODIFIERS[j], ALL_MODIFIERS[k]]);
      }
    }
  }
  return out.sort((a, b) => a.length - b.length);
}

let table: Map<number, Rep[]> | null = null;

function getTable(): Map<number, Rep[]> {
  if (table) return table;
  const t = new Map<number, Rep[]>();
  const subsets = modifierSubsets();
  for (const q of QUALITIES) {
    for (const modifiers of subsets) {
      // sus sobre dim/aug é só 5ª alterada disfarçada (o símbolo vira sus2(♭5)): descartado.
      if ((q.id === "dim" || q.id === "aug") && modifiers.some((m) => m.kind === "sus")) continue;
      // sus2/sus4 com 5ª alterada é leitura artificial (ex.: B♭sus2(♭5) no lugar de C7 sem 5ª).
      if ((q.id === "sus2" || q.id === "sus4") && modifiers.some((m) => m.kind === "alt" && (m.value === "b5" || m.value === "#5"))) continue;
      let mask = 0;
      for (const iv of chordIntervals({ quality: q.id, modifiers })) mask |= 1 << mod12(iv);
      const list = t.get(mask);
      const rep: Rep = { quality: q.id, modifiers, cost: QUALITY_COST[q.id] + modifiersCost(modifiers) };
      if (list) list.push(rep);
      else t.set(mask, [rep]);
    }
  }
  for (const list of t.values()) list.sort((a, b) => a.cost - b.cost); // sort estável: empate mantém a ordem de geração
  table = t;
  return t;
}

/** Leituras alternativas em ordem de preferência (a primeira = recognizeChord). */
export function recognizeCandidates(notes: number[], ctx?: ScaleContext | null, max = 5): Recognized[] {
  if (notes.length === 0) return [];
  const bass = mod12(Math.min(...notes));
  const pcs: PitchClass[] = [];
  let mask = 0;
  // Ordem: baixo primeiro, depois as demais classes em ordem crescente (determinístico).
  for (const n of notes) {
    const pc = mod12(n);
    if (!(mask & (1 << pc))) {
      mask |= 1 << pc;
      pcs.push(pc);
    }
  }
  pcs.sort((a, b) => (a === bass ? -1 : b === bass ? 1 : a - b));

  if (pcs.length < 3) {
    if (pcs.length !== 2) return [];
    const root = pcs.find((r) => pcs.includes(mod12(r + 7)));
    if (root === undefined) return [];
    const res: Recognized = { root, quality: "5", modifiers: [] };
    if (bass !== root) res.bass = bass;
    return [res];
  }

  const t = getTable();
  const scored: { cost: number; value: Recognized }[] = [];
  for (const root of pcs) {
    const rel = ((mask >> root) | (mask << (12 - root))) & 0xfff;
    const reps = t.get(rel);
    if (!reps) continue;
    const bassCost = bass === root ? 0 : BASS_COST;
    for (const rep of reps) {
      let cost = rep.cost + bassCost;
      if (cost > MAX_COST) break; // reps ordenadas por custo
      if (ctx && ctx.pcSet && chordFits(root, rep.quality, ctx.pcSet) && pcs.every((pc) => ctx.pcSet.has(pc))) cost -= SCALE_BONUS;
      const value: Recognized = { root, quality: rep.quality, modifiers: rep.modifiers.map((m) => ({ ...m })) };
      if (bass !== root) value.bass = bass;
      scored.push({ cost, value });
    }
  }
  scored.sort((a, b) => a.cost - b.cost);
  return scored.slice(0, max).map((s) => s.value);
}

/** Melhor leitura das notas; null se não houver leitura exata. */
export function recognizeChord(notes: number[], ctx?: ScaleContext | null): Recognized | null {
  return recognizeCandidates(notes, ctx, 1)[0] ?? null;
}
