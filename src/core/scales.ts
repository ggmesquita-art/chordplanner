// Catálogo de escalas (DESIGN §2.2–2.3). Dados, não código: para ampliar, basta
// acrescentar entradas. Modos são gerados por rotação da escala-mãe para
// garantir intervalos corretos.

import { mod12, type PitchClass } from "./pitch";

export type ScaleFamily =
  | "major-modes"
  | "harmonic-minor-modes"
  | "melodic-minor-modes"
  | "harmonic-major-modes"
  | "double-harmonic-modes"
  | "neapolitan"
  | "pentatonic"
  | "blues"
  | "bebop"
  | "symmetric"
  | "asian"
  | "other";

export const FAMILY_NAMES: Record<ScaleFamily, string> = {
  "major-modes": "Modos da escala maior",
  "harmonic-minor-modes": "Modos da menor harmônica",
  "melodic-minor-modes": "Modos da menor melódica",
  "harmonic-major-modes": "Modos da maior harmônica",
  "double-harmonic-modes": "Modos da dupla harmônica",
  neapolitan: "Napolitanas e afins",
  pentatonic: "Pentatônicas",
  blues: "Blues",
  bebop: "Bebop",
  symmetric: "Simétricas",
  asian: "Japonesas / asiáticas",
  other: "Outras",
};

export type ScaleDef = {
  id: string;
  name: string;
  family: ScaleFamily;
  intervals: number[];
  aliases?: string[];
  mode?: { parent: string; degree: number };
  /** Escala não temperada, aproximada em 12-TET. */
  approx?: boolean;
};

function rotate(intervals: number[], degree: number): number[] {
  const root = intervals[degree];
  return [...intervals.slice(degree), ...intervals.slice(0, degree)].map((i) => mod12(i - root));
}

type ModeSpec = [id: string, name: string, aliases?: string[]];

function modes(family: ScaleFamily, parent: number[], specs: ModeSpec[]): ScaleDef[] {
  const parentId = specs[0][0];
  return specs.map(([id, name, aliases], degree) => ({
    id,
    name,
    family,
    intervals: rotate(parent, degree),
    aliases,
    mode: degree === 0 ? undefined : { parent: parentId, degree: degree + 1 },
  }));
}

const s = (id: string, name: string, family: ScaleFamily, intervals: number[], extra: Partial<ScaleDef> = {}): ScaleDef => ({
  id,
  name,
  family,
  intervals,
  ...extra,
});

export const SCALES: ScaleDef[] = [
  ...modes("major-modes", [0, 2, 4, 5, 7, 9, 11], [
    ["major", "Jônio (Maior)", ["Maior", "Escala maior natural", "Ionian"]],
    ["dorian", "Dórico", ["Dorian"]],
    ["phrygian", "Frígio", ["Phrygian"]],
    ["lydian", "Lídio", ["Lydian"]],
    ["mixolydian", "Mixolídio", ["Mixolydian"]],
    ["minor", "Eólio (Menor natural)", ["Menor", "Menor natural", "Aeolian"]],
    ["locrian", "Lócrio", ["Locrian"]],
  ]),
  ...modes("harmonic-minor-modes", [0, 2, 3, 5, 7, 8, 11], [
    ["harmonic-minor", "Menor harmônica", ["Harmonic minor"]],
    ["locrian-nat6", "Lócrio ♮6"],
    ["ionian-sharp5", "Jônio ♯5", ["Jônio aumentado"]],
    ["dorian-sharp4", "Dórico ♯4", ["Romeno", "Ucraniano dórico"]],
    ["phrygian-dominant", "Frígio dominante", ["Ahava Rabbah", "Espanhola", "Cigana espanhola", "Freygish"]],
    ["lydian-sharp2", "Lídio ♯2"],
    ["ultralocrian", "Ultralócrio", ["Superlócrio 𝄫7"]],
  ]),
  ...modes("melodic-minor-modes", [0, 2, 3, 5, 7, 9, 11], [
    ["melodic-minor", "Menor melódica (jazz)", ["Melodic minor"]],
    ["dorian-b2", "Dórico ♭2", ["Frígio ♮6"]],
    ["lydian-augmented", "Lídio aumentado"],
    ["lydian-dominant", "Lídio dominante", ["Acústica", "Overtone"]],
    ["mixolydian-b6", "Mixolídio ♭6", ["Hindu", "Eólio dominante"]],
    ["locrian-nat2", "Lócrio ♮2", ["Meio-diminuto"]],
    ["altered", "Alterada", ["Superlócrio"]],
  ]),
  ...modes("harmonic-major-modes", [0, 2, 4, 5, 7, 8, 11], [
    ["harmonic-major", "Maior harmônica"],
    ["dorian-b5", "Dórico ♭5"],
    ["phrygian-b4", "Frígio ♭4"],
    ["lydian-b3", "Lídio ♭3"],
    ["mixolydian-b2", "Mixolídio ♭2"],
    ["lydian-augmented-sharp2", "Lídio aumentado ♯2"],
    ["locrian-bb7", "Lócrio 𝄫7"],
  ]),
  ...modes("double-harmonic-modes", [0, 1, 4, 5, 7, 8, 11], [
    ["double-harmonic", "Dupla harmônica", ["Bizantina", "Árabe", "Cigana maior"]],
    ["lydian-sharp2-sharp6", "Lídio ♯2 ♯6"],
    ["ultraphrygian", "Ultrafrígio"],
    ["hungarian-minor", "Húngara menor", ["Cigana", "Menor cigana"]],
    ["oriental", "Oriental"],
    ["ionian-sharp2-sharp5", "Jônio ♯2 ♯5"],
    ["locrian-bb3-bb7", "Lócrio 𝄫3 𝄫7"],
  ]),

  s("neapolitan-major", "Napolitana maior", "neapolitan", [0, 1, 3, 5, 7, 9, 11]),
  s("neapolitan-minor", "Napolitana menor", "neapolitan", [0, 1, 3, 5, 7, 8, 11]),
  s("enigmatic", "Enigmática", "neapolitan", [0, 1, 4, 6, 8, 10, 11], { aliases: ["Verdi"] }),
  s("hungarian-major", "Húngara maior", "neapolitan", [0, 3, 4, 6, 7, 9, 10]),
  s("persian", "Persa", "neapolitan", [0, 1, 4, 5, 6, 8, 11]),
  s("prometheus", "Prometeu", "neapolitan", [0, 2, 4, 6, 9, 10], { aliases: ["Místico", "Scriabin"] }),
  s("spanish-8", "Espanhola 8 tons", "neapolitan", [0, 1, 3, 4, 5, 6, 8, 10]),

  s("major-pentatonic", "Pentatônica maior", "pentatonic", [0, 2, 4, 7, 9]),
  s("minor-pentatonic", "Pentatônica menor", "pentatonic", [0, 3, 5, 7, 10]),
  s("egyptian", "Egípcia (suspensa)", "pentatonic", [0, 2, 5, 7, 10], { aliases: ["Pentatônica suspensa"] }),
  s("man-gong", "Blues maior (Man Gong)", "pentatonic", [0, 3, 5, 8, 10]),
  s("dominant-pentatonic", "Pentatônica dominante", "pentatonic", [0, 2, 4, 7, 10]),

  s("minor-blues", "Blues menor (hexatônica)", "blues", [0, 3, 5, 6, 7, 10], { aliases: ["Blues"] }),
  s("major-blues", "Blues maior", "blues", [0, 2, 3, 4, 7, 9]),
  s("nine-tone-blues", "Blues de 9 notas", "blues", [0, 2, 3, 4, 5, 6, 7, 9, 10]),

  s("bebop-dominant", "Bebop dominante", "bebop", [0, 2, 4, 5, 7, 9, 10, 11]),
  s("bebop-major", "Bebop maior", "bebop", [0, 2, 4, 5, 7, 8, 9, 11]),
  s("bebop-dorian", "Bebop dórico", "bebop", [0, 2, 3, 4, 5, 7, 9, 10]),
  s("bebop-melodic-minor", "Bebop menor melódica", "bebop", [0, 2, 3, 5, 7, 8, 9, 11]),

  s("whole-tone", "Tons inteiros", "symmetric", [0, 2, 4, 6, 8, 10]),
  s("diminished", "Diminuta (T-sT)", "symmetric", [0, 2, 3, 5, 6, 8, 9, 11], { aliases: ["Octatônica"] }),
  s("dominant-diminished", "Diminuta dominante (sT-T)", "symmetric", [0, 1, 3, 4, 6, 7, 9, 10]),
  s("augmented", "Aumentada (hexatônica)", "symmetric", [0, 3, 4, 7, 8, 11], { aliases: ["Hexatônica de Coltrane"] }),
  s("tritone", "Tritônica", "symmetric", [0, 1, 4, 6, 7, 10]),
  s("chromatic", "Cromática", "symmetric", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),

  s("hirajoshi", "Hirajoshi", "asian", [0, 2, 3, 7, 8]),
  s("in-sen", "In-sen", "asian", [0, 1, 5, 7, 10]),
  s("iwato", "Iwato", "asian", [0, 1, 5, 6, 10]),
  s("kumoi", "Kumoi", "asian", [0, 2, 3, 7, 9]),
  s("yo", "Yo", "asian", [0, 2, 5, 7, 9], { aliases: ["Ritusen", "Blues menor (Ritusen)"] }),
  s("pelog", "Pelog (aprox.)", "asian", [0, 1, 3, 7, 8], { approx: true }),
  s("slendro", "Slendro (aprox.)", "asian", [0, 2, 5, 7, 10], { approx: true }),
  s("chinese", "Chinesa", "asian", [0, 4, 6, 7, 11]),

  s("messiaen-3", "Messiaen modo 3", "other", [0, 2, 3, 4, 6, 7, 8, 10, 11]),
  s("messiaen-4", "Messiaen modo 4", "other", [0, 1, 2, 5, 6, 7, 8, 11]),
  s("messiaen-5", "Messiaen modo 5", "other", [0, 1, 5, 6, 7, 11]),
  s("messiaen-6", "Messiaen modo 6", "other", [0, 2, 4, 5, 6, 8, 10, 11]),
  s("messiaen-7", "Messiaen modo 7", "other", [0, 1, 2, 3, 5, 6, 7, 8, 9, 11]),
];

const BY_ID = new Map(SCALES.map((sc) => [sc.id, sc]));

export function getScale(id: string): ScaleDef {
  const sc = BY_ID.get(id);
  if (!sc) throw new Error(`Escala desconhecida: ${id}`);
  return sc;
}

export const pitchSet = (tonic: PitchClass, scale: ScaleDef): PitchClass[] =>
  scale.intervals.map((i) => mod12(tonic + i));

const FORMULA = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];

/**
 * Fórmula por graus (`1 2 ♭3 4 5 6 ♭7`). Heptatônicas usam o grau pela posição
 * (permitindo ♯2, 𝄫7…); as demais, o nome mais comum do intervalo.
 */
export function scaleFormula(scale: ScaleDef): string {
  const major = [0, 2, 4, 5, 7, 9, 11];
  if (scale.intervals.length === 7) {
    return scale.intervals
      .map((iv, deg) => {
        let d = iv - major[deg];
        if (d > 6) d -= 12;
        if (d < -6) d += 12;
        const acc = d === -2 ? "𝄫" : d === -1 ? "♭" : d === 1 ? "♯" : d === 2 ? "𝄪" : "";
        return acc + (deg + 1);
      })
      .join(" ");
  }
  return scale.intervals.map((iv) => FORMULA[iv]).join(" ");
}

const normalize = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Busca por nome e aliases, sem acento. */
export function searchScales(query: string): ScaleDef[] {
  const q = normalize(query.trim());
  if (!q) return SCALES;
  return SCALES.filter((sc) => [sc.name, ...(sc.aliases ?? [])].some((n) => normalize(n).includes(q)));
}

/** Modos relativos: escalas da mesma família com o mesmo conjunto de notas. */
export function relativeModes(scale: ScaleDef): ScaleDef[] {
  const parent = scale.mode?.parent ?? scale.id;
  return SCALES.filter((sc) => sc.id === parent || sc.mode?.parent === parent);
}
