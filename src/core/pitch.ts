// Pitch classes (0–11, C=0) e grafia enarmônica. Toda a lógica usa inteiros;
// nomes de notas só existem aqui, na borda de apresentação (DESIGN §2.1, §2.6).

export type PitchClass = number;
export type AccidentalPref = "auto" | "sharp" | "flat";

export const mod12 = (n: number): PitchClass => ((n % 12) + 12) % 12;

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** Tônicas do lado dos bemóis no círculo de quintas (F, B♭, E♭, A♭, D♭, G♭). */
const FLAT_SIDE = new Set([5, 10, 3, 8, 1, 6]);

const ACCIDENTAL: Record<number, string> = { [-2]: "𝄫", [-1]: "♭", 0: "", 1: "♯", 2: "𝄪" };

export function pcName(pc: PitchClass, useFlats: boolean): string {
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** Preferência de bemóis para escalas não heptatônicas ou notas fora da escala. */
export function prefersFlats(tonic: PitchClass, pref: AccidentalPref): boolean {
  if (pref === "sharp") return false;
  if (pref === "flat") return true;
  return FLAT_SIDE.has(mod12(tonic));
}

function spellWithLetters(tonicLetter: number, pcs: PitchClass[]): { names: string[]; cost: number } | null {
  const names: string[] = [];
  let cost = 0;
  for (let i = 0; i < pcs.length; i++) {
    const letter = (tonicLetter + i) % 7;
    let diff = mod12(pcs[i] - LETTER_PC[letter]);
    if (diff > 6) diff -= 12;
    if (Math.abs(diff) > 2) return null;
    cost += Math.abs(diff) * (Math.abs(diff) === 2 ? 3 : 1);
    names.push(LETTERS[letter] + ACCIDENTAL[diff]);
  }
  return { names, cost };
}

/**
 * Grafia das notas de uma escala. Heptatônicas: cada letra exatamente uma vez,
 * escolhendo a grafia da tônica com menos acidentes (a preferência ♯/♭ desempata
 * ou força). Demais: armadura preferida da tônica.
 */
export function spellScale(tonic: PitchClass, pcs: PitchClass[], pref: AccidentalPref): Map<PitchClass, string> {
  const out = new Map<PitchClass, string>();
  if (pcs.length === 7) {
    const candidates: { names: string[]; cost: number; flat: boolean; sharp: boolean }[] = [];
    for (let letter = 0; letter < 7; letter++) {
      let diff = mod12(tonic - LETTER_PC[letter]);
      if (diff > 6) diff -= 12;
      if (Math.abs(diff) > 1) continue;
      const res = spellWithLetters(letter, pcs);
      if (res) candidates.push({ ...res, flat: diff < 0, sharp: diff > 0 });
    }
    const forced = candidates.filter((c) =>
      pref === "flat" ? !c.sharp : pref === "sharp" ? !c.flat : true,
    );
    const pool = forced.length ? forced : candidates;
    pool.sort((a, b) => a.cost - b.cost || Number(b.flat === prefersFlats(tonic, pref)) - Number(a.flat === prefersFlats(tonic, pref)));
    if (pool.length) {
      pcs.forEach((pc, i) => out.set(pc, pool[0].names[i]));
      return out;
    }
  }
  const flats = prefersFlats(tonic, pref);
  for (const pc of pcs) out.set(pc, pcName(pc, flats));
  return out;
}

export type Speller = (pc: PitchClass) => string;

/** Função de grafia: usa a grafia da escala quando a nota pertence a ela. */
export function makeSpeller(tonic: PitchClass | null, pcs: PitchClass[], pref: AccidentalPref): Speller {
  if (tonic === null) return (pc) => pcName(pc, prefersFlats(pc, pref));
  const map = spellScale(tonic, pcs, pref);
  const flats = prefersFlats(tonic, pref);
  const tonicName = map.get(mod12(tonic)) ?? pcName(tonic, flats);
  return (pc) => map.get(mod12(pc)) ?? (pref === "auto" ? spellChromatic(tonicName, mod12(pc - tonic)) : null) ?? pcName(pc, flats);
}

/** Letra relativa à tônica por intervalo: cromatismos como ♭2, ♭3, ♯4, ♭6, ♭7. */
const DEGREE_LETTER = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];

/** Grafia de nota fora da escala pelo grau em relação à tônica (B♭ em Dó, não A♯). */
function spellChromatic(tonicName: string, interval: number): string | null {
  const tonicLetter = LETTERS.indexOf(tonicName[0] as (typeof LETTERS)[number]);
  if (tonicLetter < 0) return null;
  const letter = (tonicLetter + DEGREE_LETTER[interval]) % 7;
  const tonicPc = mod12(LETTER_PC[tonicLetter] + accidentalValue(tonicName.slice(1)));
  let diff = mod12(tonicPc + interval - LETTER_PC[letter]);
  if (diff > 6) diff -= 12;
  // Evita dobrados em contexto cromático: cai na armadura.
  return Math.abs(diff) > 1 ? null : LETTERS[letter] + ACCIDENTAL[diff];
}

function accidentalValue(acc: string): number {
  return [...acc].reduce((n, ch) => n + (ch === "♯" ? 1 : ch === "♭" ? -1 : ch === "𝄪" ? 2 : ch === "𝄫" ? -2 : 0), 0);
}

/** Posição de uma pitch class no círculo de quintas (C=0, G=1, D=2…). */
export const fifthsPosition = (pc: PitchClass): number => mod12(pc * 7);

export const midiToPc = (midi: number): PitchClass => mod12(midi);
