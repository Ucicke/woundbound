/** Display fractional item bonuses without floating-point noise. */
export function formatItemNumber(value: number): string {
  return Number(value.toFixed(2)).toString().replace('.', ',');
}
