// Saída MIDI (Web MIDI API): envia as notas para um DAW/plugin — ex.: Ableton
// recebendo pelo IAC Driver do macOS. Funciona no Chrome/Edge/Firefox (não no Safari).
// A entrada (teclado MIDI) usa o mesmo acesso: ver midiInput.ts.

export type MidiRecordTarget = "chords" | "melody-step" | "melody-live";

export type MidiSettings = {
  enabled: boolean;
  outputId: string | null;
  /** Canal global 1–16 (blocos podem sobrescrever). */
  channel: number;
  /** Canal global 1–16 para a pista de melodia. */
  melodyChannel: number;
  /** Compensação de latência em ms (positivo = atrasa o MIDI em relação ao áudio do navegador). */
  latencyMs: number;
  /** Silencia o som do navegador enquanto a saída MIDI está ativa. */
  muteBrowser: boolean;
  /** Recebe notas de um teclado MIDI (reconhece o acorde tocado). */
  inputEnabled: boolean;
  /** Porta de entrada; null = todas. */
  inputId: string | null;
  /** Toca as notas recebidas com o instrumento atual. */
  inputThru: boolean;
  /** Ao tocar, insere na progressão (acordes) ou na pista de melodia conforme `inputRecordTarget`. */
  inputRecord: boolean;
  /** Alvo de gravação do teclado MIDI: acordes ao soltar, melodia passo a passo ou melodia ao vivo. */
  inputRecordTarget: MidiRecordTarget;
};

export const DEFAULT_MIDI: MidiSettings = {
  enabled: false,
  outputId: null,
  channel: 1,
  melodyChannel: 2,
  latencyMs: 0,
  muteBrowser: true,
  inputEnabled: false,
  inputId: null,
  inputThru: true,
  inputRecord: false,
  inputRecordTarget: "chords",
};

export type MidiPort = { id: string; name: string };

let access: MIDIAccess | null = null;
let settings: MidiSettings = DEFAULT_MIDI;
export type MidiStatus = "idle" | "requesting" | "ready" | "denied" | "unsupported";

let status: MidiStatus = "idle";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const midiSupported = () => typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";

export function subscribeMidi(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let snapshot: { status: MidiStatus; ports: MidiPort[]; inputs: MidiPort[] } = { status, ports: [], inputs: [] };
/** Estado para `useSyncExternalStore` (referência estável entre mudanças). */
export function midiSnapshot() {
  return snapshot;
}
function refresh() {
  const ports = access ? [...access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id })) : [];
  const inputs = access?.inputs ? [...access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? i.id })) : [];
  snapshot = { status, ports, inputs };
  notify();
}

/** Pede permissão de MIDI (o navegador mostra um aviso na primeira vez). */
export async function initMidi(): Promise<boolean> {
  if (access) return true;
  if (!midiSupported()) {
    status = "unsupported";
    refresh();
    return false;
  }
  status = "requesting";
  refresh();
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => refresh();
    status = "ready";
  } catch {
    status = "denied";
  }
  refresh();
  return !!access;
}

/** Acesso MIDI já concedido (null antes de initMidi). */
export const midiAccess = (): MIDIAccess | null => access;

export function configureMidi(next: MidiSettings) {
  const was = output();
  settings = next;
  if ((next.enabled || next.inputEnabled) && !access && status === "idle") void initMidi();
  // Ligado → desligado: panic final na porta que estava em uso (as notas ativas ficariam presas).
  if (was && !midiActive()) {
    sendPanic(was);
    active.clear();
  }
}

/** Porta selecionada (ou a primeira), independente de a saída estar habilitada. */
function selectedPort(): MIDIOutput | null {
  if (!access) return null;
  const outs = [...access.outputs.values()];
  return (settings.outputId ? outs.find((o) => o.id === settings.outputId) : outs[0]) ?? null;
}

function output(): MIDIOutput | null {
  return settings.enabled ? selectedPort() : null;
}

export const midiActive = () => output() !== null;
/** Nome da porta de saída em uso (null se a saída está desligada). Portas virtuais como o IAC Driver
 *  aparecem também como entrada com o mesmo nome: a entrada as ignora para não realimentar. */
export const activeOutputName = (): string | null => {
  const out = output();
  return out ? (out.name ?? out.id) : null;
};
export const midiMutesBrowser = () => midiActive() && settings.muteBrowser;
export const midiChannel = () => settings.channel;
export const midiMelodyChannel = () => settings.melodyChannel;

/** Converte um tempo do AudioContext em timestamp do `performance.now()` (base do Web MIDI). */
export function toMidiTime(audioTime: number, ctx: AudioContext): number {
  const stamp = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
  const base =
    stamp?.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0
      ? stamp.performanceTime + (audioTime - stamp.contextTime) * 1000
      : performance.now() + (audioTime - ctx.currentTime) * 1000;
  return Math.max(performance.now(), base + settings.latencyMs);
}

const active = new Map<string, number>();
const key = (ch: number, note: number) => `${ch}:${note}`;

export function noteOn(channel: number, note: number, velocity: number, at?: number) {
  const out = output();
  if (!out) return;
  const ch = (channel - 1) & 0x0f;
  out.send([0x90 | ch, note & 0x7f, Math.max(1, Math.min(127, Math.round(velocity * 127)))], at);
  active.set(key(ch, note), (active.get(key(ch, note)) ?? 0) + 1);
}

export function noteOff(channel: number, note: number, at?: number) {
  const out = output();
  if (!out) return;
  const ch = (channel - 1) & 0x0f;
  out.send([0x80 | ch, note & 0x7f, 0], at);
  const k = key(ch, note);
  const n = (active.get(k) ?? 1) - 1;
  if (n <= 0) active.delete(k);
  else active.set(k, n);
}

/** Note-off das notas ativas + All Notes Off / pedal em todos os canais de uma porta. */
function sendPanic(out: MIDIOutput) {
  for (const k of active.keys()) {
    const [ch, note] = k.split(":").map(Number);
    out.send([0x80 | ch, note, 0]);
  }
  for (let ch = 0; ch < 16; ch++) {
    out.send([0xb0 | ch, 64, 0]);
    out.send([0xb0 | ch, 123, 0]);
  }
}

/** Solta as notas na porta SELECIONADA, só se a saída MIDI está habilitada ou há notas ativas pendentes. */
export function panic() {
  if (!settings.enabled && active.size === 0) return;
  const out = selectedPort();
  if (out) sendPanic(out);
  active.clear();
}

/** Panic completo (todas as portas com acesso, 16 canais), para botão de segurança/teste. */
export function panicAll() {
  const outs = access ? [...access.outputs.values()] : [];
  for (const out of outs) sendPanic(out);
  active.clear();
}
