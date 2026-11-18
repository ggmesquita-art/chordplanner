// Status e progresso de carregamento por instrumento + assinantes. Sem Tone/smplr:
// a UI importa isto (via engine.ts) sem puxar o áudio para o carregamento inicial.

export type LoadStatus = "idle" | "loading" | "ready" | "error";

const statuses = new Map<string, LoadStatus>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function instrumentStatus(id: string): LoadStatus {
  return statuses.get(id) ?? "idle";
}

// Progresso (0–1) do download dos samples do smplr, por instrumento.
const progress = new Map<string, number>();
const lastProgressNotify = new Map<string, number>();
const PROGRESS_INTERVAL_MS = 100;

/** Progresso de carregamento (0–1); null quando desconhecido (synth, plano B, pronto ou erro). */
export function instrumentProgress(id: string): number | null {
  return progress.get(id) ?? null;
}

// ——— Escrita (usada por loaders.ts) ———

export function setStatus(id: string, status: LoadStatus) {
  statuses.set(id, status);
  notify();
}

/** Instrumento descartado: volta a "idle" e limpa o progresso. */
export function clearStatus(id: string) {
  statuses.delete(id);
  clearProgress(id);
  notify();
}

export function clearProgress(id: string) {
  progress.delete(id);
  lastProgressNotify.delete(id);
}

export function reportProgress(id: string, p: { loaded: number; total: number }) {
  if (!p.total || statuses.get(id) !== "loading") return;
  const value = Math.max(0, Math.min(1, p.loaded / p.total));
  progress.set(id, value);
  const now = Date.now();
  if (value < 1 && now - (lastProgressNotify.get(id) ?? 0) < PROGRESS_INTERVAL_MS) return;
  lastProgressNotify.set(id, now);
  notify();
}

/**
 * Escolhe quem descartar: se os SAMPLEADOS passam de `max`, os menos recentemente usados
 * que não estão em uso. Synths (`sampled: false`) não entram na conta.
 */
export function pickEviction(entries: { id: string; lastUsed: number; sampled: boolean }[], inUse: Set<string>, max: number): string[] {
  const pool = entries.filter((e) => e.sampled);
  const excess = pool.length - max;
  if (excess <= 0) return [];
  return pool
    .filter((e) => !inUse.has(e.id))
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, excess)
    .map((e) => e.id);
}
