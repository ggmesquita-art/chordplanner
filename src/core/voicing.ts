// Voicing: transforma um acorde resolvido em notas MIDI (DESIGN §3.5, §5.2).

import { isRest, type Chord } from "./chords";
import { chordIntervals } from "./modifiers";
import { mod12 } from "./pitch";

const BASS_BASE = 36; // C2
/** Faixa onde começa a estrutura superior (F3–E4): nem embolada no grave, nem estridente. */
const UPPER_LOW = 53;

const UPPER_HIGH = 81; // A5: teto da estrutura superior na condução de vozes

const uniqSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** Aberto (spread): a partir do fechado, sobe uma oitava a 2ª, 4ª… nota (de baixo para cima). */
const openShape = (closed: number[]) => closed.map((n, i) => (i % 2 === 1 ? n + 12 : n));

/** Drop N: das (até) 4 vozes de cima do fechado, desce uma oitava a N-ésima voz a partir do topo. */
function dropShape(closed: number[], n: 2 | 3): number[] {
  const out = [...closed];
  const i = out.length - n;
  if (i >= Math.max(0, out.length - 4) && i >= 0) out[i] -= 12;
  return out;
}

/**
 * Shell: 3ª + 7ª sobre o baixo (sem 5ª). Sem 7ª: 3ª + 6ª; senão 3ª + 5ª.
 * Sus: a 4ª (ou 2ª) ocupa o lugar da 3ª. Sem 3ª/sus (omit3), usa o que restar.
 */
function shellShape(ivs: number[], upperRoot: number): number[] {
  const has = (i: number) => ivs.includes(i);
  const third = [3, 4, 5, 2].find(has);
  const seventh = [10, 11, 9, 7, 6, 8].find(has);
  return [third, seventh].filter((i): i is number => i !== undefined).map((i) => upperRoot + i);
}

const QUARTAL_CACHE = new Map<string, number[]>();
const QUARTAL_CACHE_MAX = 256;

/**
 * Quartal: só notas do acorde (nenhuma tensão inventada). Testa todas as ordens das
 * classes de altura e escolhe a que tem mais quartas justas entre vizinhas
 * (empate: menor extensão total, depois ordem lexicográfica das classes).
 */
function quartalShape(ivs: number[], upperRoot: number): number[] {
  let pcs = [...new Set(ivs.map(mod12))].sort((x, y) => x - y);
  if (pcs.length < 2) return pcs.map((pc) => upperRoot + pc);
  // Com 7 classes a busca (n!) é cara: descarta a 5ª justa (a nota mais dispensável) antes de permutar.
  if (pcs.length > 6) pcs = pcs.filter((pc) => pc !== 7);
  const cacheKey = `${pcs.join(",")}|${upperRoot}`;
  const hit = QUARTAL_CACHE.get(cacheKey);
  if (hit) return [...hit];
  const stack = (order: number[]) => {
    const notes = [upperRoot + order[0]];
    for (const pc of order.slice(1)) {
      let n = notes[notes.length - 1] + 1;
      while (mod12(n - upperRoot) !== pc) n++;
      notes.push(n);
    }
    return notes;
  };
  let best: { notes: number[]; fourths: number; span: number } | null = null;
  const walk = (order: number[], rest: number[]) => {
    if (!rest.length) {
      const notes = stack(order);
      const fourths = notes.filter((n, i) => i > 0 && n - notes[i - 1] === 5).length;
      const span = notes[notes.length - 1] - notes[0];
      if (!best || fourths > best.fourths || (fourths === best.fourths && span < best.span)) best = { notes, fourths, span };
      return;
    }
    for (const pc of rest) walk([...order, pc], rest.filter((x) => x !== pc));
  };
  walk([], pcs);
  // A ordem pode começar numa nota alta da escala: reposiciona a pilha perto de F3.
  let notes = (best as unknown as { notes: number[] }).notes;
  while (notes[0] - 12 >= UPPER_LOW) notes = notes.map((n) => n - 12);
  // Cache limitado (FIFO): as combinações reais são poucas, mas a chave nunca cresce sem teto.
  if (QUARTAL_CACHE.size >= QUARTAL_CACHE_MAX) QUARTAL_CACHE.delete(QUARTAL_CACHE.keys().next().value as string);
  QUARTAL_CACHE.set(cacheKey, notes);
  return [...notes];
}

/** Estrutura superior (sem oitava do acorde) do voicing pedido. */
function upperShape(chord: Chord): number[] {
  const ivs = chordIntervals(chord);
  let upperRoot = 48 + chord.root;
  if (upperRoot < UPPER_LOW) upperRoot += 12;
  const closed = uniqSorted(ivs.map((i) => upperRoot + i));
  switch (chord.voicing) {
    case "open":
      return uniqSorted(openShape(closed));
    case "drop2":
      return uniqSorted(dropShape(closed, 2));
    case "drop3":
      return uniqSorted(dropShape(closed, 3));
    case "quartal":
      return quartalShape(ivs, upperRoot);
    case "shell": {
      const shell = shellShape(ivs, upperRoot);
      return shell.length >= 2 ? shell : closed;
    }
    default:
      return closed;
  }
}

/**
 * Condução de vozes (§5.1): entre as inversões (a nota mais grave sobe uma oitava, repetidamente)
 * e transposições de oitava da estrutura superior, dentro de F3–A5 e acima do baixo, escolhe a de
 * menor movimento total vs. as notas superiores de `prev` (pareadas por ordem, do grave ao agudo;
 * empate: menor distância entre os topos). Quartal e shell só transpõem por oitava, para
 * preservar sua estrutura de intervalos. Sem candidata válida, devolve `shape`.
 */
function leadVoices(shape: number[], prevUpper: number[], bass: number, oct: number, invert: boolean): number[] {
  if (!prevUpper.length) return shape;
  const lo = Math.max(UPPER_LOW + oct, bass + 1);
  const hi = UPPER_HIGH + oct;
  const inversions: number[][] = [shape];
  if (invert) for (let k = 1; k < shape.length; k++) inversions.push([...inversions[k - 1].slice(1), inversions[k - 1][0] + 12]);
  let best: { notes: number[]; cost: number; top: number } | null = null;
  for (const inv of inversions) {
    for (let t = -48; t <= 48; t += 12) {
      const notes = inv.map((n) => n + t);
      if (notes[0] < lo || notes[notes.length - 1] > hi) continue;
      let cost = 0;
      for (let i = 0; i < Math.min(notes.length, prevUpper.length); i++) cost += Math.abs(notes[i] - prevUpper[i]);
      const top = Math.abs(notes[notes.length - 1] - prevUpper[prevUpper.length - 1]);
      if (!best || cost < best.cost || (cost === best.cost && top < best.top)) best = { notes, cost, top };
    }
  }
  return (best as { notes: number[] } | null)?.notes ?? shape;
}

/**
 * Voicing de piano: baixo separado na 2ª oitava (fundamental, inversão ou slash)
 * e estrutura superior (fechada por padrão) a partir da fundamental, começando entre F3 e E4.
 * `prev`: notas do acorde anterior (baixo primeiro), para a condução de vozes; null = sem condução.
 */
export function voiceChord(chord: Chord, prev: number[] | null = null): number[] {
  if (isRest(chord)) return [];
  const oct = (chord.octave ?? 0) * 12;
  const bass = BASS_BASE + mod12(chord.bass ?? chord.root) + oct;
  let upper = upperShape(chord).map((n) => n + oct);
  if (chord.voicing && chord.voicing !== "closed") while (upper.length && upper[0] <= bass) upper = upper.map((n) => n + 12);
  if (prev && prev.length > 1) {
    const invert = chord.voicing !== "quartal" && chord.voicing !== "shell";
    upper = leadVoices(upper, [...prev.slice(1)].sort((a, b) => a - b), bass, oct, invert);
  }
  return uniqSorted([bass, ...upper.filter((n) => n > bass)]);
}

/** Ajusta as notas à tessitura do instrumento, transpondo por oitava; omite o que não couber. */
export function fitToRange(notes: number[], [lo, hi]: [number, number]): { notes: number[]; dropped: number } {
  const fitted: number[] = [];
  let dropped = 0;
  for (let n of notes) {
    while (n < lo) n += 12;
    while (n > hi) n -= 12;
    if (n < lo || n > hi) dropped++;
    else fitted.push(n);
  }
  return { notes: [...new Set(fitted)].sort((a, b) => a - b), dropped };
}
