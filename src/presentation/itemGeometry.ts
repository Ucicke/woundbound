export type ItemCell = readonly [number, number];

export interface ItemFootprintBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

/** Bounds the occupied silhouette's rectangle, not the centroid of its cells. */
export function itemFootprintBounds(cells: readonly ItemCell[], anchorX: number, anchorY: number, cellSize: number): ItemFootprintBounds {
  if (cells.length === 0) throw new Error('An item footprint must occupy at least one cell.');
  const left = anchorX + Math.min(...cells.map(([x]) => x)) * cellSize;
  const top = anchorY + Math.min(...cells.map(([, y]) => y)) * cellSize;
  const right = anchorX + (Math.max(...cells.map(([x]) => x)) + 1) * cellSize;
  const bottom = anchorY + (Math.max(...cells.map(([, y]) => y)) + 1) * cellSize;
  return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

/** Finds the filled rectangle that fits the largest undistorted sprite inside the occupied cells. */
export function itemArtBounds(cells: readonly ItemCell[], anchorX: number, anchorY: number, cellSize: number, artWidth: number, artHeight: number): ItemFootprintBounds {
  const footprint = itemFootprintBounds(cells, anchorX, anchorY, cellSize);
  const occupied = new Set(cells.map(([x, y]) => `${x},${y}`));
  const maxX = Math.max(...cells.map(([x]) => x)), maxY = Math.max(...cells.map(([, y]) => y));
  let best = footprint, bestScale = -1, bestArea = -1;
  for (const [left, top] of cells) for (let right = left; right <= maxX; right++) for (let bottom = top; bottom <= maxY; bottom++) {
    let filled = true;
    for (let y = top; y <= bottom && filled; y++) for (let x = left; x <= right; x++) if (!occupied.has(`${x},${y}`)) { filled = false; break; }
    if (!filled) continue;
    const width = (right - left + 1) * cellSize, height = (bottom - top + 1) * cellSize;
    const scale = Math.min(width / Math.max(1, artWidth), height / Math.max(1, artHeight));
    const area = width * height;
    if (scale < bestScale || (scale === bestScale && area <= bestArea)) continue;
    bestScale = scale; bestArea = area;
    const x = anchorX + left * cellSize, y = anchorY + top * cellSize;
    best = { left: x, top: y, right: x + width, bottom: y + height, centerX: x + width / 2, centerY: y + height / 2 };
  }
  return best;
}
