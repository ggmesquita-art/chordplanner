// Modo prática (DESIGN §9 v3): pergunta de percepção "qual é o grau deste acorde?".
// Puro: o sorteio vem de um `rng` injetável.

import { makeChord, type Chord } from "./chords";
import type { ScaleContext } from "./diatonic";
import { mod12 } from "./pitch";

export type PracticeLevel = "basic" | "all";
export type PracticeOption = { degreeIndex: number; roman: string };
export type Question = {
  /** Cadência que estabelece o tom: I–IV–V–I com os acordes primários da escala. */
  cadence: Chord[];
  target: { degreeIndex: number; chord: Chord; roman: string };
  options: PracticeOption[];
};

/** Graus com acorde primário e algarismo romano. */
function playable(ctx: ScaleContext) {
  return ctx.degrees.filter((d) => d.primary && d.roman);
}

/**
 * Graus do nível. "basic": I, IV, V e o vi (terça maior) / ♭VI (terça menor), por distância
 * da tônica (0, 5, 7, 9|8 semitons). Menor: usa o que a escala der — na menor natural o v é
 * menor (v, não V). Se sobrar menos de 2 graus (escalas exóticas), cai para "all".
 */
export function levelDegrees(ctx: ScaleContext, level: PracticeLevel) {
  const all = playable(ctx);
  if (level === "all") return all;
  const minorThird = ctx.pcSet.has(mod12(ctx.tonic + 3)) && !ctx.pcSet.has(mod12(ctx.tonic + 4));
  const wanted = new Set([0, 5, 7, minorThird ? 8 : 9]);
  const basic = all.filter((d) => wanted.has(mod12(d.root - ctx.tonic)));
  return basic.length >= 2 ? basic : all;
}

function degreeChord(ctx: ScaleContext, offset: number): Chord {
  const d = playable(ctx).find((x) => mod12(x.root - ctx.tonic) === offset) ?? playable(ctx)[0];
  return makeChord(d.root, d.primary!);
}

export function makeQuestion(ctx: ScaleContext, level: PracticeLevel, rng: () => number, previous?: number): Question {
  const degrees = levelDegrees(ctx, level);
  const options = degrees.map((d) => ({ degreeIndex: d.index, roman: d.roman! }));
  const pool = degrees.length > 1 ? degrees.filter((d) => d.index !== previous) : degrees;
  const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const cadence = [0, 5, 7, 0].map((off) => degreeChord(ctx, off));
  return { cadence, target: { degreeIndex: pick.index, chord: makeChord(pick.root, pick.primary!), roman: pick.roman! }, options };
}

export function scoreAnswer(question: Question, degreeIndex: number): boolean {
  return question.target.degreeIndex === degreeIndex;
}
