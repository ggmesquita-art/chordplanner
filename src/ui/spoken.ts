// Rótulos falados para leitores de tela (DESIGN §8): "Mi menor, grau ii, diatônico".

const SOLFEGE: Record<string, string> = { C: "Dó", D: "Ré", E: "Mi", F: "Fá", G: "Sol", A: "Lá", B: "Si" };
const ACC: Record<string, string> = { "♯": " sustenido", "♭": " bemol", "𝄪": " dobrado sustenido", "𝄫": " dobrado bemol" };
const STATE: Record<string, string> = {
  explore: "clique para definir a tônica",
  diatonic: "diatônico",
  chromatic: "cromático liberado",
  other: "fundamental na escala, qualidade fora",
  out: "fora da escala",
};

export function spokenNote(name: string): string {
  const letter = SOLFEGE[name[0]] ?? name[0];
  const acc = [...name.slice(1)].map((ch) => ACC[ch] ?? "").join("");
  return letter + acc;
}

export type SpokenChromatic = "secondary" | "borrowed" | "supertonic" | "subV";

const CHROMATIC_TEXT: Record<SpokenChromatic, string> = {
  secondary: "dominante secundária",
  borrowed: "empréstimo modal",
  supertonic: "segundo grau secundário",
  subV: "substituto de trítono",
};

export function spokenChord(symbol: string, roman: string | null, state: string, chromaticKind?: SpokenChromatic): string {
  const m = symbol.match(/^([A-G][♯♭𝄪𝄫]?)(.*)$/u);
  const root = m ? spokenNote(m[1]) : symbol;
  const rest = m?.[2] ?? "";
  const quality = rest === "" ? "maior" : rest === "m" ? "menor" : rest === "°" ? "diminuto" : rest === "+" ? "aumentado" : rest;
  const stateText = chromaticKind ? CHROMATIC_TEXT[chromaticKind] : STATE[state];
  return [`${root} ${quality}`, roman ? `grau ${roman}` : null, stateText].filter(Boolean).join(", ");
}
