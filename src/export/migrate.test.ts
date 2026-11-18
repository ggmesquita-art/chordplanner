import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, migrate, type MigrationStep } from "./migrate";

const steps: MigrationStep[] = [
  { from: 1, migrate: (r) => ({ ...r, trail: [...((r.trail as string[]) ?? []), "1>2"] }) },
  { from: 2, migrate: (r) => ({ ...r, trail: [...((r.trail as string[]) ?? []), "2>3"] }) },
];

describe("migrate", () => {
  it("aplica os passos em ordem até a versão alvo", () => {
    expect(migrate({ a: 1 }, 1, steps, 3)).toEqual({ data: { a: 1, trail: ["1>2", "2>3"] }, version: 3 });
    expect(migrate({ a: 1, trail: ["x"] }, 2, steps, 3)).toEqual({ data: { a: 1, trail: ["x", "2>3"] }, version: 3 });
  });

  it("versão atual passa direto", () => {
    const raw = { a: 1 };
    expect(migrate(raw, CURRENT_VERSION)).toEqual({ data: raw, version: CURRENT_VERSION });
  });

  it("versão futura ou inválida dá null", () => {
    expect(migrate({}, CURRENT_VERSION + 1)).toBeNull();
    for (const v of [0, -1, 1.5, NaN]) expect(migrate({}, v)).toBeNull();
  });

  it("passo que lança dá null", () => {
    const boom: MigrationStep[] = [{ from: 1, migrate: () => { throw new Error("x"); } }];
    expect(migrate({}, 1, boom, 2)).toBeNull();
  });

  it("passo ausente dá null", () => {
    expect(migrate({}, 1, [], 2)).toBeNull();
  });
});
