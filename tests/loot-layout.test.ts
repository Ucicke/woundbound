import { describe, expect, it } from 'vitest';
import { lootGrid } from '../src/ui/lootLayout.ts';

describe('loot grid', () => {
  it('fits two mobile rows without shrinking 54 px touch targets', () => {
    expect(lootGrid(306, 133, 6, 54)).toEqual({ size: 54, columns: 5, rows: 2 });
  });

  it.each([[586, 544], [891, 823]])('fits forty tiles with safe gaps within %i × %i', (width, height) => {
    const gap = 8;
    const { size, columns, rows } = lootGrid(width, height, gap, 112, 40);
    expect(columns * rows).toBeGreaterThanOrEqual(40);
    expect(size).toBeGreaterThanOrEqual(60);
    expect(columns * size + (columns - 1) * gap).toBeLessThanOrEqual(width);
    expect(rows * size + (rows - 1) * gap).toBeLessThanOrEqual(height);
  });
});
