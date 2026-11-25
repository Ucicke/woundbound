export interface LootGrid {
  size: number;
  columns: number;
  rows: number;
}

/** Find the largest tile that fits the target count without consuming the panel's insets. */
export function lootGrid(width: number, height: number, gap: number, maximum: number, target = 0): LootGrid {
  const capacity = (span: number, size: number): number => Math.max(1, Math.floor((span + gap) / (size + gap)));
  let size = Math.max(1, Math.floor(Math.min(maximum, width, height)));
  const minimum = Math.min(size, 60);
  while (size > minimum && capacity(width, size) * capacity(height, size) < target) size--;
  return { size, columns: capacity(width, size), rows: capacity(height, size) };
}
