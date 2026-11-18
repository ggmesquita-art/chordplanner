// Migração do formato salvo (sessão, arquivo .json, músicas guardadas). Módulo puro.
// Cada passo leva os dados da versão `from` para `from + 1`; `migrate` encadeia até a versão atual.

export const CURRENT_VERSION = 1;

export type MigrationStep = { from: number; migrate: (raw: Record<string, unknown>) => Record<string, unknown> };

/**
 * Passos em ordem crescente de `from`. Para evoluir o formato: suba `CURRENT_VERSION` para 2 e acrescente
 *   { from: 1, migrate: (raw) => ({ ...raw, campoNovo: raw.campoAntigo ?? 0 }) }
 */
const STEPS: MigrationStep[] = [];

/** Leva `raw` da `version` dada até `CURRENT_VERSION`. null = versão inválida, mais nova que a atual, ou passo que falhou. */
export function migrate(raw: unknown, version: number, steps: MigrationStep[] = STEPS, target = CURRENT_VERSION): { data: unknown; version: number } | null {
  if (!Number.isInteger(version) || version < 1 || version > target) return null;
  let data = raw;
  let v = version;
  while (v < target) {
    const step = steps.find((s) => s.from === v);
    if (!step || typeof data !== "object" || data === null || Array.isArray(data)) return null;
    try {
      data = step.migrate(data as Record<string, unknown>);
    } catch {
      return null;
    }
    v++;
  }
  return { data, version: v };
}
