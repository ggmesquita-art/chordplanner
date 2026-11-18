/** Marcas de compasso de uma instância: todos até 8; de 2 em 2 até 16; de 4 em 4 acima. `at` em 0..1. */
export function barTicks(startBar: number, bars: number): { bar: number; at: number }[] {
  if (bars <= 0) return [];
  const step = bars <= 8 ? 1 : bars <= 16 ? 2 : 4;
  const out: { bar: number; at: number }[] = [];
  const b0 = Math.ceil(startBar - 1e-9);
  for (let b = b0; b < startBar + bars - 1e-9; b += step) out.push({ bar: b, at: (b - startBar) / bars });
  return out;
}
