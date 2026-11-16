export type ItemCell = readonly [number, number];

export interface ItemFootprintBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface RelativeBounds { left: number; top: number; right: number; bottom: number }
const artBoundsCache = new Map<string, RelativeBounds>();
const MAX_ART_BOUNDS_CACHE = 256;

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
  if (cells.length === 0) throw new Error('An item footprint must occupy at least one cell.');
  const minX = Math.min(...cells.map(([x]) => x)), minY = Math.min(...cells.map(([, y]) => y));
  const normalized = cells.map(([x, y]) => [x - minX, y - minY] as const).sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
  const shapeKey = normalized.map(([x, y]) => `${x},${y}`).join(';');
  const cacheKey = `${shapeKey}|${cellSize}|${Math.max(1, artWidth)}|${Math.max(1, artHeight)}`;
  let relative = artBoundsCache.get(cacheKey);
  if (!relative) {
    const occupied = new Set(normalized.map(([x, y]) => `${x},${y}`));
    const maxX = Math.max(...normalized.map(([x]) => x)), maxY = Math.max(...normalized.map(([, y]) => y));
    let best = { left: 0, top: 0, right: maxX + 1, bottom: maxY + 1 };
    let bestScale = -1, bestArea = -1;
    for (const [left, top] of normalized) for (let right = left; right <= maxX; right++) for (let bottom = top; bottom <= maxY; bottom++) {
      let filled = true;
      for (let y = top; y <= bottom && filled; y++) for (let x = left; x <= right; x++) if (!occupied.has(`${x},${y}`)) { filled = false; break; }
      if (!filled) continue;
      const width = (right - left + 1) * cellSize, height = (bottom - top + 1) * cellSize;
      const scale = Math.min(width / Math.max(1, artWidth), height / Math.max(1, artHeight));
      const area = width * height;
      if (scale < bestScale || (scale === bestScale && area <= bestArea)) continue;
      bestScale = scale; bestArea = area;
      best = { left, top, right: right + 1, bottom: bottom + 1 };
    }
    relative = best;
    artBoundsCache.set(cacheKey, relative);
    if (artBoundsCache.size > MAX_ART_BOUNDS_CACHE) artBoundsCache.delete(artBoundsCache.keys().next().value!);
  }
  const left = anchorX + (minX + relative.left) * cellSize;
  const top = anchorY + (minY + relative.top) * cellSize;
  const right = anchorX + (minX + relative.right) * cellSize;
  const bottom = anchorY + (minY + relative.bottom) * cellSize;
  return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}
