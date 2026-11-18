// Fachada do motor de áudio (DESIGN §5.1). Leve e sem Tone/smplr: a implementação
// pesada (player.ts + loaders.ts) é carregada com import() só quando algo toca ou
// um instrumento é pré-carregado, mantendo o Tone fora do chunk inicial.
// Status/progresso vivem em status.ts e funcionam sem carregar o player.

import type { Expanded } from "../core/song";
import { primeAudioContext } from "./context";

export { instrumentProgress, instrumentStatus, pickEviction, subscribeStatus, type LoadStatus } from "./status";

export type PlayOptions = {
  loop: boolean;
  metronome: boolean;
  /** Um compasso de cliques antes de começar (toca uma vez, mesmo com loop). */
  countIn?: boolean;
  swing: number;
  /** Canal MIDI de cada bloco (override do bloco ou global). */
  channelFor: (blockId: string) => number;
  onEvent: (index: number) => void;
  onEnd: () => void;
  /** Tônica (pitch class) de cada bloco, para o bordão. */
  tonicFor?: (blockId: string) => number | null;
  /** Re-ataca acordes longos a cada compasso em instrumentos de decay. */
  reattack?: boolean;
  /** Condução de vozes entre acordes do mesmo bloco. */
  voiceLeading?: boolean;
};

type Player = typeof import("./player");

let playerPromise: Promise<Player> | null = null;
let player: Player | null = null;

/** Uma única promessa memorizada; se o import falhar (rede), a próxima chamada tenta de novo. */
function loadPlayer(): Promise<Player> {
  playerPromise ??= import("./player").then(
    (m) => (player = m),
    (err: unknown) => {
      playerPromise = null;
      throw err;
    },
  );
  return playerPromise;
}

// Gesto do usuário: o Safari/iOS só destrava o áudio dentro da "ativação do usuário", e o
// Tone chega depois de um `await import()`. Por isso, no primeiro pointerdown/keydown da
// página, o AudioContext é criado e retomado de forma síncrona (context.ts) — o Tone o adota
// ao carregar — e o import do motor já começa. play/preview também chamam primeAudioContext()
// antes de qualquer await. Falha de rede é ignorada: a chamada real tenta de novo.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const warm = () => {
    primeAudioContext();
    void loadPlayer().catch(() => {});
  };
  window.addEventListener("pointerdown", warm, { once: true, capture: true });
  window.addEventListener("keydown", warm, { once: true, capture: true });
}

/** Geração: stop() (e um novo play) invalida chamadas que ainda esperam o import. */
let generation = 0;

export async function unlock() {
  primeAudioContext();
  await (await loadPlayer()).unlock();
}

export async function previewNotes(midi: number[], instrumentId: string, opts: { arpeggio?: boolean; seconds?: number } = {}) {
  primeAudioContext();
  const gen = generation;
  const m = await loadPlayer();
  await m.unlock();
  if (gen !== generation) return;
  await m.previewNotes(midi, instrumentId, opts);
}

export async function play(expanded: Expanded, opts: PlayOptions) {
  primeAudioContext();
  const gen = ++generation;
  const m = await loadPlayer();
  await m.unlock(); // o stop() pode chegar durante o desbloqueio
  if (gen !== generation) return;
  await m.play(expanded, opts);
}

// ——— Teclado MIDI ao vivo: síncrono quando o player já carregou (latência mínima) ———

/** Teclas apertadas antes de o motor carregar: só atacam se ainda estiverem apertadas quando ele chegar. */
const pendingLive = new Map<number, { velocity: number; instrumentId: string }>();

export function liveNoteOn(note: number, velocity: number, instrumentId: string) {
  if (player) {
    player.liveNoteOn(note, velocity, instrumentId);
    return;
  }
  primeAudioContext();
  pendingLive.set(note, { velocity, instrumentId });
  void loadPlayer().then(
    async (m) => {
      await m.unlock().catch(() => {});
      const p = pendingLive.get(note);
      if (!p) return;
      pendingLive.delete(note);
      m.liveNoteOn(note, p.velocity, p.instrumentId);
    },
    () => pendingLive.delete(note),
  );
}

export function liveNoteOff(note: number) {
  pendingLive.delete(note);
  player?.liveNoteOff(note);
}

export function liveAllOff() {
  pendingLive.clear();
  player?.liveAllOff();
}

/** Síncrona: sem player carregado não há nada tocando. */
export function stop() {
  generation++;
  player?.stop();
}

/** Dispare e esqueça: a UI não espera. */
export function preload(id: string) {
  loadPlayer().then(
    (m) => m.preload(id),
    (err: unknown) => console.warn(`falha ao carregar o motor de áudio para ${id}`, err),
  );
}

export function disposeInstrument(id: string) {
  // Sem player não há instrumento carregado para descartar.
  player?.disposeInstrument(id);
}
