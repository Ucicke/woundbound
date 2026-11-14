import { describe, expect, it } from 'vitest';
import { createItem, itemDefinitionIds } from '../src/combat/items.ts';
import { rotatedShape } from '../src/combat/inventory.ts';
import { itemArtBounds } from '../src/presentation/itemGeometry.ts';

describe('inventory art bounds', () => {
  it('keeps the entire art rectangle inside occupied cells for every item and rotation', () => {
    for (const id of itemDefinitionIds()) for (let rotation = 0; rotation < 4; rotation++) {
      const item = createItem(id, `item-${id}`, () => 0);
      item.rotation = rotation;
      const cells = rotatedShape(item), occupied = new Set(cells.map(([x, y]) => `${x},${y}`));
      for (const [width, height] of [[100, 400], [400, 100], [300, 300]]) {
        const bounds = itemArtBounds(cells, 100, 200, 20, width!, height!);
        for (let y = (bounds.top - 200) / 20; y < (bounds.bottom - 200) / 20; y++) {
          for (let x = (bounds.left - 100) / 20; x < (bounds.right - 100) / 20; x++) {
            expect(occupied.has(`${x},${y}`), `${id}, rotation ${rotation}, cell ${x},${y}`).toBe(true);
          }
        }
      }
    }
  });
});
