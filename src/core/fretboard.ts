// Digitação de violão/guitarra para um acorde (ROADMAP Etapa 5).
//
// Busca exaustiva com poda: para cada corda, "não toca" ou uma casa 0…maxFret cuja nota pertença ao acorde
// (ou ao baixo). Restrições duras: o baixo (chord.bass ?? fundamental) na corda mais grave tocada; todas as
// classes essenciais presentes (tudo menos a 5ª justa e as extensões ≥ 9ª; a 5ª vira essencial só num power
// chord); abertura (casa mais alta − mais baixa, ignorando cordas soltas) menor que `span`; no máximo 4 dedos
// (só com mais de 4 casas pressionadas a menor casa vira pestana: 1 dedo, sem corda solta dentro dela).
// Custo (menor vence): soma das casas ×0.5 + maior casa ×0.3 (posições baixas); corda das pontas não tocada +2;
// corda "pulada" no meio +6; pestana +2.5; 5ª ausente +2.5; extensão ausente +2.5. Cordas soltas custam 0.
// Empate: a primeira encontrada (ordem determinística das casas).

import type { Chord } from "./chords";
import { chordIntervals } from "./modifiers";
import { mod12 } from "./pitch";

/** Afinação padrão, da corda mais grave (6ª) à mais aguda (1ª): E2 A2 D3 G3 B3 E4. */
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64];

export type GuitarVoicing = {
  /** Casa por corda (da grave à aguda): 0 = solta, null = não toca. */
  strings: (number | null)[];
  /** Primeira casa mostrada no diagrama (1 = pestana na pestana "nut"). */
  baseFret: number;
  /** MIDI das cordas tocadas, da grave à aguda. */
  notes: number[];
};

type Opts = { maxFret?: number; span?: number };

export function guitarVoicing(chord: Chord, { maxFret = 12, span = 4 }: Opts = {}): GuitarVoicing | null {
  const ivs = chordIntervals(chord);
  const pcOf = (iv: number) => mod12(chord.root + iv);
  const bassPc = mod12(chord.bass ?? chord.root);
  const required = new Set(ivs.filter((i) => i < 12 && i !== 7).map(pcOf));
  if (required.size <= 1 && ivs.includes(7)) required.add(pcOf(7));
  // Pelo menos 4 cordas (3 num power chord) para soar como acorde e não como díade.
  const minPlayed = new Set(ivs.map(pcOf)).size <= 2 ? 3 : 4;
  const fifth = ivs.includes(7) ? pcOf(7) : null;
  const optional = [...new Set(ivs.map(pcOf))].filter((pc) => !required.has(pc));
  const allowed = new Set([...ivs.map(pcOf), bassPc]);

  let best: { strings: (number | null)[]; cost: number } | null = null;
  const cur: (number | null)[] = Array(6).fill(null);

  const evaluate = () => {
    const played = cur.map((f, s) => (f === null ? -1 : s)).filter((s) => s >= 0);
    if (played.length < minPlayed) return;
    const pcs = new Set(played.map((s) => mod12(GUITAR_TUNING[s] + cur[s]!)));
    for (const pc of required) if (!pcs.has(pc)) return;
    const fretted = played.map((s) => cur[s]!).filter((f) => f > 0);
    // Dedos: um por casa pressionada; só com mais de 4 a menor casa vira pestana (1 dedo; sem corda solta por baixo).
    let fingers = fretted.length;
    let barre = false;
    if (fingers > 4) {
      const low = Math.min(...fretted);
      const onLow = played.filter((s) => cur[s] === low);
      if (onLow.length >= 2) {
        barre = true;
        fingers -= onLow.length - 1;
        for (let s = onLow[0]; s <= onLow[onLow.length - 1]; s++) if (cur[s] === 0) return;
      }
    }
    if (fingers > 4) return;

    let cost = 0;
    for (const f of fretted) cost += f * 0.5;
    if (fretted.length) cost += Math.max(...fretted) * 0.3;
    if (barre) cost += 2.5;
    cost += (played[0] + 5 - played[played.length - 1]) * 2;
    cost += (played[played.length - 1] - played[0] + 1 - played.length) * 6;
    if (fifth !== null && !pcs.has(fifth) && !required.has(fifth)) cost += 2.5;
    for (const pc of optional) if (pc !== fifth && !pcs.has(pc)) cost += 2.5;
    if (!best || cost < best.cost) best = { strings: [...cur], cost };
  };

  const walk = (s: number, lo: number, hi: number, started: boolean) => {
    if (s === 6) return evaluate();
    cur[s] = null;
    // Antes de tocar qualquer corda, só vale começar pelo baixo; depois, qualquer uma (inclusive pular).
    walk(s + 1, lo, hi, started);
    for (let f = 0; f <= maxFret; f++) {
      const pc = mod12(GUITAR_TUNING[s] + f);
      if (!allowed.has(pc) || (!started && pc !== bassPc)) continue;
      const nlo = f > 0 ? Math.min(lo, f) : lo;
      const nhi = f > 0 ? Math.max(hi, f) : hi;
      if (nhi - nlo >= span) continue;
      cur[s] = f;
      walk(s + 1, nlo, nhi, true);
    }
    cur[s] = null;
  };
  walk(0, Infinity, -Infinity, false);

  const found = best as { strings: (number | null)[] } | null;
  if (!found) return null;
  const { strings } = found;
  const fretted = strings.filter((f): f is number => f !== null && f > 0);
  const baseFret = fretted.length && Math.max(...fretted) > 5 ? Math.min(...fretted) : 1;
  const notes = strings.flatMap((f, s) => (f === null ? [] : [GUITAR_TUNING[s] + f]));
  return { strings, baseFret, notes };
}
