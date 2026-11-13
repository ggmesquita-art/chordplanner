/** Marcas de compasso de uma instância: todos até 8; de 2 em 2 até 16; de 4 em 4 acima. `at` em 0..1. */
export function barTicks(startBar: number, bars: number): { bar: number; at: number }[] {
  const whole = Math.floor(bars + 1e-9);
  if (whole <= 0 || bars <= 0) return [];
  const step = bars <= 8 ? 1 : bars <= 16 ? 2 : 4;
  const out: { bar: number; at: number }[] = [];
  for (let k = 0; k < whole; k += step) out.push({ bar: Math.floor(startBar) + k, at: k / bars });
  return out;
}
