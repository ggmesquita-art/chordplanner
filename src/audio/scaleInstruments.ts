// Instrumentos clássicos por escala (DESIGN §5.3). Entrada da escala tem
// prioridade sobre a da família; sem nenhuma, cai no fallback.

import type { ScaleDef, ScaleFamily } from "../core/scales";

export type Suggestion = { instruments: string[]; context: string };

const BY_SCALE: Record<string, Suggestion> = {
  major: { instruments: ["piano", "guitar-steel", "strings"], context: "pop, erudito" },
  dorian: { instruments: ["organ", "guitar-clean", "flute"], context: "jazz modal, funk, folk celta" },
  phrygian: { instruments: ["guitar-nylon", "guitar-od"], context: "flamenco, metal" },
  lydian: { instruments: ["synth-pad", "strings", "celesta"], context: "trilha de cinema, clima de sonho" },
  mixolydian: { instruments: ["bagpipe", "guitar-od", "organ"], context: "a gaita de foles escocesa soa próxima do Mixolídio; rock" },
  minor: { instruments: ["piano", "strings", "cello"], context: "balada, erudito" },
  locrian: { instruments: ["guitar-od"], context: "metal" },
  "harmonic-minor": { instruments: ["harpsichord", "violin", "strings"], context: "barroco, erudito" },
  "phrygian-dominant": { instruments: ["guitar-nylon", "clarinet", "oud"], context: "flamenco, klezmer, Oriente Médio" },
  "double-harmonic": { instruments: ["oud", "qanun", "ney", "shehnai"], context: "música árabe, turca, bizantina" },
  oriental: { instruments: ["oud", "qanun", "ney", "shehnai"], context: "música árabe, turca, bizantina" },
  "hungarian-minor": { instruments: ["violin", "cimbalom", "accordion"], context: "música cigana e húngara" },
  persian: { instruments: ["santur", "ney"], context: "música persa" },
  "melodic-minor": { instruments: ["epiano", "tenor-sax", "vibraphone"], context: "jazz" },
  altered: { instruments: ["epiano", "tenor-sax", "vibraphone"], context: "jazz" },
  "lydian-dominant": { instruments: ["epiano", "tenor-sax", "vibraphone"], context: "jazz" },
  "minor-pentatonic": { instruments: ["harmonica", "guitar-od", "piano"], context: "blues, rock" },
  "major-pentatonic": { instruments: ["guitar-steel", "banjo", "pan-flute"], context: "folk, country, música andina" },
  chinese: { instruments: ["guzheng", "erhu"], context: "música tradicional chinesa" },
  hirajoshi: { instruments: ["koto", "shamisen", "shakuhachi"], context: "afinação tradicional do koto" },
  kumoi: { instruments: ["koto", "shamisen", "shakuhachi"], context: "afinação tradicional do koto" },
  "in-sen": { instruments: ["shakuhachi", "koto", "shamisen"], context: "música tradicional japonesa" },
  iwato: { instruments: ["koto", "shamisen", "shakuhachi"], context: "música tradicional japonesa" },
  yo: { instruments: ["shakuhachi", "koto", "shamisen"], context: "música folclórica japonesa (min'yō)" },
  pelog: { instruments: ["gamelan", "marimba", "glockenspiel"], context: "gamelão de Java e Bali (aprox. 12-TET)" },
  slendro: { instruments: ["gamelan", "marimba", "glockenspiel"], context: "gamelão de Java e Bali (aprox. 12-TET)" },
  egyptian: { instruments: ["ney", "flute"], context: "música egípcia antiga / árabe" },
  "whole-tone": { instruments: ["celesta", "harp", "vibraphone"], context: "impressionismo (Debussy), sequências de sonho" },
  diminished: { instruments: ["strings", "brass", "tenor-sax"], context: "suspense, big band" },
  "dominant-diminished": { instruments: ["strings", "brass", "tenor-sax"], context: "suspense, big band" },
  augmented: { instruments: ["tenor-sax", "piano"], context: "Coltrane" },
  prometheus: { instruments: ["piano"], context: "Scriabin" },
  enigmatic: { instruments: ["piano", "strings", "pipe-organ"], context: "Verdi, erudito" },
  chromatic: { instruments: ["piano", "synth-poly"], context: "—" },
};

const BY_FAMILY: Partial<Record<ScaleFamily, Suggestion>> = {
  "harmonic-minor-modes": { instruments: ["harpsichord", "violin", "strings"], context: "erudito" },
  "melodic-minor-modes": { instruments: ["epiano", "tenor-sax", "vibraphone"], context: "jazz" },
  "harmonic-major-modes": { instruments: ["piano", "strings"], context: "erudito" },
  "double-harmonic-modes": { instruments: ["oud", "qanun", "violin"], context: "Oriente Médio, Leste Europeu" },
  neapolitan: { instruments: ["piano", "strings", "pipe-organ"], context: "erudito" },
  pentatonic: { instruments: ["guitar-steel", "pan-flute"], context: "folk" },
  blues: { instruments: ["harmonica", "guitar-od", "piano"], context: "blues" },
  bebop: { instruments: ["tenor-sax", "piano", "vibraphone", "contrabass-pizz"], context: "bebop" },
  symmetric: { instruments: ["celesta", "strings"], context: "cinema, jazz" },
  asian: { instruments: ["koto", "shakuhachi"], context: "música asiática" },
  other: { instruments: ["pipe-organ", "piano"], context: "Messiaen era organista" },
};

const FALLBACK: Suggestion = { instruments: ["piano", "synth-poly"], context: "" };

export function suggestionsFor(scale: ScaleDef): Suggestion {
  return BY_SCALE[scale.id] ?? BY_FAMILY[scale.family] ?? FALLBACK;
}

export const SCALE_SUGGESTIONS = BY_SCALE;
export const FAMILY_SUGGESTIONS = BY_FAMILY;
