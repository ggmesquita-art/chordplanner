// Catálogo de instrumentos (DESIGN §5.2). Dados, não código.

export type InstrumentCategory = "synth" | "keys" | "plucked" | "bowed" | "wind" | "mallet" | "world";

export const CATEGORY_NAMES: Record<InstrumentCategory, string> = {
  synth: "Synth",
  keys: "Teclas",
  plucked: "Cordas dedilhadas",
  bowed: "Cordas friccionadas",
  wind: "Sopros",
  mallet: "Percussão melódica",
  world: "Mundo",
};

export type SynthPreset = "poly" | "pad" | "pluck" | "lead" | "bell" | "stab" | "fmkeys" | "supersaw" | "gamelan";

/** Fonte de samples no smplr (DESIGN §5.2). */
export type SmplrSource =
  | { kind: "grand-piano" }
  | { kind: "electric-piano"; name: "CP80" | "PianetT" | "WurlitzerEP200" | "TX81Z" }
  | { kind: "mallet"; name: string }
  | { kind: "smolken"; name: "Arco" | "Pizzicato" }
  | { kind: "versilian"; name: string }
  | { kind: "soundfont"; name: string };

export type InstrumentDef = {
  id: string;
  name: string;
  category: InstrumentCategory;
  engine: "synth" | "sampler";
  /** `smplr` é a fonte principal; `gm` (FluidR3 via Tone.Sampler) é o plano B se o smplr falhar. */
  source: { preset?: SynthPreset; gm?: string; smplr?: SmplrSource };
  /** Tessitura em MIDI. */
  range: [number, number];
  polyphony: "poly" | "mono";
  envelope: "sustain" | "decay";
  drone?: boolean;
  /** Instrumento real que este timbre aproxima (marcado com ≈ na UI). */
  approximates?: string;
};

type Def = Omit<InstrumentDef, "engine" | "source" | "polyphony" | "envelope"> &
  Partial<Pick<InstrumentDef, "polyphony" | "envelope">>;

const synth = (preset: SynthPreset, d: Def): InstrumentDef => ({
  polyphony: "poly",
  envelope: "sustain",
  ...d,
  engine: "synth",
  source: { preset },
});

/** Instrumento GM: MusyngKite pelo smplr, com FluidR3 como plano B. */
const gm = (name: string, d: Def, smplr?: SmplrSource): InstrumentDef => ({
  polyphony: "poly",
  envelope: "sustain",
  ...d,
  engine: "sampler",
  source: { gm: name, smplr: smplr ?? { kind: "soundfont", name } },
});

const VCSL = (path: string): SmplrSource => ({ kind: "versilian", name: path });

export const INSTRUMENTS: InstrumentDef[] = [
  synth("poly", { id: "synth-poly", name: "Poly analógico", category: "synth", range: [24, 108] }),
  synth("pad", { id: "synth-pad", name: "Pad", category: "synth", range: [24, 108] }),
  synth("pluck", { id: "synth-pluck", name: "Pluck", category: "synth", range: [24, 108], envelope: "decay" }),
  synth("lead", { id: "synth-lead", name: "Lead serra", category: "synth", range: [36, 96] }),
  synth("bell", { id: "synth-bell", name: "FM Bell", category: "synth", range: [36, 108], envelope: "decay" }),
  synth("stab", { id: "synth-stab", name: "Chord stab", category: "synth", range: [36, 96], envelope: "decay" }),
  synth("fmkeys", { id: "synth-fmkeys", name: "FM Keys", category: "synth", range: [28, 103], envelope: "decay" }),
  synth("supersaw", { id: "synth-supersaw", name: "Supersaw", category: "synth", range: [36, 96] }),

  gm("acoustic_grand_piano", { id: "piano", name: "Piano de cauda (Steinway)", category: "keys", range: [21, 108], envelope: "decay" }, { kind: "grand-piano" }),
  gm("electric_piano_1", { id: "epiano", name: "Piano elétrico (Wurlitzer)", category: "keys", range: [28, 103], envelope: "decay" }, { kind: "electric-piano", name: "WurlitzerEP200" }),
  gm("electric_piano_2", { id: "cp80", name: "Piano elétrico (Yamaha CP80)", category: "keys", range: [28, 103], envelope: "decay" }, { kind: "electric-piano", name: "CP80" }),
  gm("drawbar_organ", { id: "organ", name: "Órgão Hammond", category: "keys", range: [36, 96] }),
  gm("church_organ", { id: "pipe-organ", name: "Órgão de tubos", category: "keys", range: [36, 96] }, VCSL("Aerophones/Edge-blown Aerophones/Pipe Organ - Loud")),
  gm("harpsichord", { id: "harpsichord", name: "Cravo (flamengo)", category: "keys", range: [29, 89], envelope: "decay" }, VCSL("Chordophones/Zithers/Harpsichord, Flemish - 8'")),
  gm("celesta", { id: "celesta", name: "Celesta", category: "keys", range: [60, 108], envelope: "decay" }),

  gm("acoustic_guitar_nylon", { id: "guitar-nylon", name: "Violão nylon", category: "plucked", range: [40, 84], envelope: "decay" }),
  gm("acoustic_guitar_steel", { id: "guitar-steel", name: "Violão aço", category: "plucked", range: [40, 84], envelope: "decay" }),
  gm("electric_guitar_clean", { id: "guitar-clean", name: "Guitarra limpa", category: "plucked", range: [40, 86], envelope: "decay" }),
  gm("overdriven_guitar", { id: "guitar-od", name: "Guitarra overdrive", category: "plucked", range: [40, 86] }),
  gm("orchestral_harp", { id: "harp", name: "Harpa de concerto", category: "plucked", range: [24, 103], envelope: "decay" }, VCSL("Chordophones/Composite Chordophones/Concert Harp")),
  gm("banjo", { id: "banjo", name: "Banjo", category: "plucked", range: [48, 84], envelope: "decay" }),

  gm("string_ensemble_1", { id: "strings", name: "Ensemble de cordas", category: "bowed", range: [28, 96] }),
  gm("violin", { id: "violin", name: "Violino", category: "bowed", range: [55, 103] }),
  gm("cello", { id: "cello", name: "Violoncelo", category: "bowed", range: [36, 76] }),
  gm("contrabass", { id: "contrabass", name: "Contrabaixo (arco)", category: "bowed", range: [28, 60], polyphony: "mono" }, { kind: "smolken", name: "Arco" }),
  gm("acoustic_bass", { id: "contrabass-pizz", name: "Contrabaixo (pizzicato)", category: "plucked", range: [28, 60], polyphony: "mono", envelope: "decay" }, { kind: "smolken", name: "Pizzicato" }),

  gm("tenor_sax", { id: "tenor-sax", name: "Sax tenor", category: "wind", range: [44, 76], polyphony: "mono" }, VCSL("Aerophones/Reed Aerophones/Tenor Saxophone - Vibrato")),
  gm("clarinet", { id: "clarinet", name: "Clarinete", category: "wind", range: [50, 91], polyphony: "mono" }),
  gm("flute", { id: "flute", name: "Flauta", category: "wind", range: [60, 96], polyphony: "mono" }),
  gm("brass_section", { id: "brass", name: "Naipe de metais", category: "wind", range: [40, 84] }),
  gm("harmonica", { id: "harmonica", name: "Gaita cromática", category: "wind", range: [48, 86] }, VCSL("Aerophones/Free Aerophones/Harmonica-Hohner-Super64 - Normal")),
  gm("accordion", { id: "accordion", name: "Acordeão", category: "wind", range: [41, 89] }),

  gm("vibraphone", { id: "vibraphone", name: "Vibrafone", category: "mallet", range: [53, 89], envelope: "decay" }, { kind: "mallet", name: "Vibraphone - Soft Mallets" }),
  gm("marimba", { id: "marimba", name: "Marimba", category: "mallet", range: [45, 96], envelope: "decay" }, VCSL("Idiophones/Struck Idiophones/Marimba")),
  gm("xylophone", { id: "xylophone", name: "Xilofone", category: "mallet", range: [65, 108], envelope: "decay" }, { kind: "mallet", name: "Xylophone - Medium Mallets" }),
  gm("glockenspiel", { id: "glockenspiel", name: "Glockenspiel", category: "mallet", range: [79, 108], envelope: "decay" }, VCSL("Idiophones/Struck Idiophones/Glockenspiel")),
  gm("kalimba", { id: "kalimba", name: "Kalimba (Quênia)", category: "mallet", range: [60, 88], envelope: "decay" }, VCSL("Idiophones/Plucked Idiophones/Kalimba, Kenya")),
  gm("steel_drums", { id: "steel-drum", name: "Steel drum", category: "mallet", range: [52, 88], envelope: "decay" }),
  gm("tubular_bells", { id: "tubular-bells", name: "Sinos tubulares", category: "mallet", range: [60, 77], envelope: "decay" }, { kind: "mallet", name: "Tubular Bells 1" }),

  gm("sitar", { id: "sitar", name: "Sitar", category: "world", range: [48, 84], envelope: "decay", drone: true }),
  gm("koto", { id: "koto", name: "Koto", category: "world", range: [48, 91], envelope: "decay" }),
  gm("shamisen", { id: "shamisen", name: "Shamisen", category: "world", range: [50, 84], envelope: "decay" }),
  gm("shakuhachi", { id: "shakuhachi", name: "Shakuhachi", category: "world", range: [55, 84], polyphony: "mono" }),
  gm("bagpipe", { id: "bagpipe", name: "Gaita de foles", category: "world", range: [55, 81], polyphony: "mono", drone: true }),
  gm("shanai", { id: "shehnai", name: "Shehnai", category: "world", range: [60, 84], polyphony: "mono" }),
  gm("dulcimer", { id: "dulcimer", name: "Dulcimer", category: "world", range: [48, 91], envelope: "decay" }),
  gm("pan_flute", { id: "pan-flute", name: "Flauta de pã", category: "world", range: [60, 96], polyphony: "mono" }),

  // Aproximações (≈): não existem no banco GM.
  gm("acoustic_guitar_nylon", { id: "oud", name: "Oud", category: "world", range: [40, 76], envelope: "decay", approximates: "Violão nylon" }),
  gm("koto", { id: "qanun", name: "Qanun", category: "world", range: [48, 91], envelope: "decay", approximates: "Koto" }),
  gm("dulcimer", { id: "santur", name: "Santur", category: "world", range: [48, 91], envelope: "decay", approximates: "Dulcimer" }),
  gm("dulcimer", { id: "cimbalom", name: "Címbalo", category: "world", range: [40, 91], envelope: "decay", approximates: "Dulcimer" }),
  gm("koto", { id: "guzheng", name: "Guzheng", category: "world", range: [43, 91], envelope: "decay", approximates: "Đàn tranh (cítara vietnamita, prima do guzheng)" }, VCSL("Chordophones/Zithers/Dan Tranh - Normal")),
  gm("fiddle", { id: "erhu", name: "Erhu", category: "world", range: [62, 93], polyphony: "mono", approximates: "Fiddle" }),
  gm("shakuhachi", { id: "ney", name: "Ney", category: "world", range: [55, 84], polyphony: "mono", approximates: "Shakuhachi" }),
  synth("gamelan", { id: "gamelan", name: "Gamelan", category: "mallet", range: [48, 96], envelope: "decay", approximates: "FM metálico" }),
];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export const getInstrumentDef = (id: string): InstrumentDef => BY_ID.get(id) ?? BY_ID.get("piano")!;
export const hasInstrument = (id: string) => BY_ID.has(id);
