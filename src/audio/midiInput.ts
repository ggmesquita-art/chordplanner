// Entrada MIDI (teclado): acompanha as teclas apertadas e o pedal de sustentação e avisa os
// assinantes. Separa "tecla solta" (para reconhecer o acorde e gravar a progressão) de "som
// termina" (o pedal segura o som das teclas soltas até ser levantado).
//
// Teclas e pedal são contados por porta: duas portas mandando a mesma nota contam como uma tecla
// (sem re-ataque), e uma porta que sai (desligada, trocada, desconectada) solta só o que era dela.

import { activeOutputName, midiAccess, subscribeMidi } from "./midi";

export type MidiInputEvent =
  | { type: "press"; note: number; velocity: number }
  | { type: "release"; note: number }
  /** O som da nota deve terminar (tecla solta sem pedal, ou pedal levantado). */
  | { type: "sound-off"; note: number }
  /** Teclas soltas à força (porta saiu, entrada desligada, All Notes Off): não é um gesto do músico. */
  | { type: "reset" };

export type MidiInputConfig = { enabled: boolean; inputId: string | null };

let config: MidiInputConfig = { enabled: false, inputId: null };
/** Por porta: nota → velocity (0–1). */
const keysByPort = new Map<string, Map<number, number>>();
const pedalByPort = new Set<string>();
/** Notas que soam só por causa do pedal. */
const sustained = new Set<number>();
const attached = new Map<string, MIDIInput>();
const listeners = new Set<(e: MidiInputEvent) => void>();
const stateListeners = new Set<() => void>();
let snapshot: readonly number[] = [];

const emit = (e: MidiInputEvent) => listeners.forEach((l) => l(e));
const isPressed = (note: number) => [...keysByPort.values()].some((k) => k.has(note));
const pedalDown = () => pedalByPort.size > 0;

function changed() {
  const all = new Set<number>();
  for (const keys of keysByPort.values()) for (const n of keys.keys()) all.add(n);
  snapshot = [...all].sort((a, b) => a - b);
  stateListeners.forEach((l) => l());
}

export function subscribeMidiInput(cb: (e: MidiInputEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Para `useSyncExternalStore`: notas apertadas agora (ordenadas). */
export function subscribePressed(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}
export const pressedNotes = (): readonly number[] => snapshot;

function press(port: string, note: number, velocity: number) {
  const already = isPressed(note);
  let keys = keysByPort.get(port);
  if (!keys) keysByPort.set(port, (keys = new Map()));
  keys.set(note, velocity);
  if (already) return; // mesma nota por outra porta: sem re-ataque
  sustained.delete(note);
  changed(); // antes de avisar: quem ouve o evento lê pressedNotes() já atualizado
  emit({ type: "press", note, velocity });
}

function release(port: string, note: number) {
  if (!keysByPort.get(port)?.delete(note)) return;
  if (isPressed(note)) return; // outra porta ainda segura a nota
  changed();
  emit({ type: "release", note });
  if (pedalDown()) sustained.add(note);
  else emit({ type: "sound-off", note });
}

function setPedal(port: string, down: boolean) {
  const was = pedalDown();
  if (down) pedalByPort.add(port);
  else pedalByPort.delete(port);
  if (!was || pedalDown()) return;
  for (const note of sustained) emit({ type: "sound-off", note });
  sustained.clear();
}

/** Solta à força tudo o que veio de `port` (ou de todas as portas). */
function releasePort(port?: string) {
  const ports = port === undefined ? [...keysByPort.keys(), ...pedalByPort] : [port];
  const any = ports.some((p) => (keysByPort.get(p)?.size ?? 0) > 0 || pedalByPort.has(p));
  if (!any) return;
  emit({ type: "reset" });
  for (const p of new Set(ports)) {
    for (const note of [...(keysByPort.get(p)?.keys() ?? [])]) release(p, note);
    setPedal(p, false);
  }
}

/** Solta tudo (entrada desligada, troca de porta). */
export const releaseAllInput = () => releasePort();

/** Interpreta uma mensagem MIDI crua (qualquer canal) vinda de `port`. Exportada para testes. */
export function handleMidiMessage(data: ArrayLike<number>, port = "default") {
  const [status = 0, d1 = 0, d2 = 0] = Array.from(data);
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0) press(port, d1, d2 / 127);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) release(port, d1);
  else if (cmd === 0xb0 && d1 === 64) setPedal(port, d2 >= 64);
  else if (cmd === 0xb0 && (d1 === 120 || d1 === 123)) releasePort(port);
}

const listenerFor = new Map<string, (e: MIDIMessageEvent) => void>();

/** Liga os ouvintes às portas certas (todas ou a escolhida); chamada quando a config ou as portas mudam. */
function attach() {
  const access = midiAccess();
  // Porta virtual usada como saída (IAC Driver) também aparece como entrada: ouvi-la realimentaria as notas.
  const echo = activeOutputName();
  const wanted = new Map<string, MIDIInput>();
  if (config.enabled && access?.inputs) {
    for (const input of access.inputs.values()) {
      if (input.state === "disconnected") continue;
      if (config.inputId !== null && input.id !== config.inputId) continue;
      if (echo !== null && (input.name ?? input.id) === echo) continue;
      wanted.set(input.id, input);
    }
  }
  for (const [id, input] of attached) {
    if (wanted.get(id) === input) continue;
    input.removeEventListener("midimessage", listenerFor.get(id)!);
    attached.delete(id);
    listenerFor.delete(id);
    releasePort(id);
  }
  for (const [id, input] of wanted) {
    if (attached.has(id)) continue;
    const onMessage = (e: MIDIMessageEvent) => e.data && handleMidiMessage(e.data, id);
    input.addEventListener("midimessage", onMessage);
    attached.set(id, input);
    listenerFor.set(id, onMessage);
  }
}

let watching = false;
export function configureMidiInput(next: MidiInputConfig) {
  config = next;
  if (!watching) {
    watching = true;
    // Acesso concedido depois, teclado conectado/desconectado: refaz as ligações.
    subscribeMidi(attach);
  }
  attach();
}

/** Só para testes. */
export function resetMidiInput() {
  keysByPort.clear();
  pedalByPort.clear();
  sustained.clear();
  listeners.clear();
  changed();
}
