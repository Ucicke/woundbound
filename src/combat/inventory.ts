import type { CombatItem, EncounterState } from './simulation.ts';

type Cell = readonly [number, number];
const shapeOf = (item: CombatItem): readonly Cell[] => item.shape ?? [[0, 0]];

export function occupiedCells(item: CombatItem, cell: number): number[] | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= 16) return null;
  const x = cell % 4, y = Math.floor(cell / 4);
  const result: number[] = [];
  for (const [dx, dy] of shapeOf(item)) {
    const cx = x + dx, cy = y + dy;
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cx >= 4 || cy < 0 || cy >= 4) return null;
    const index = cy * 4 + cx;
    if (result.includes(index)) return null;
    result.push(index);
  }
  return result.length ? result : null;
}

/** Move one real instance only after validating the complete destination. */
export function moveItem(state: EncounterState, itemId: string, heroId: string, cell: number): boolean {
  if (state.phase !== 'preparation' && !(state.phase === 'result' && state.outcome === 'victory')) return false;
  const hero = state.heroes.find(candidate => candidate.id === heroId && candidate.status !== 'dead');
  const sources = [state.stash, state.floor, ...state.heroes.map(candidate => candidate.items)];
  const source = sources.find(items => items.some(item => item.id === itemId));
  const item = source?.find(candidate => candidate.id === itemId);
  if (!hero || !source || !item) return false;
  const cells = occupiedCells(item, cell);
  if (!cells) return false;
  for (const other of hero.items) {
    if (other.id === item.id) continue;
    const occupied = occupiedCells(other, other.cell ?? 0);
    if (!occupied || occupied.some(index => cells.includes(index))) return false;
  }
  source.splice(source.indexOf(item), 1);
  item.cell = cell;
  hero.items.push(item);
  state.item = state.heroes[0]?.items[0] ?? null;
  return true;
}

export function storeItem(state: EncounterState, itemId: string): boolean {
  if (state.phase !== 'preparation' && !(state.phase === 'result' && state.outcome === 'victory')) return false;
  const owner = state.heroes.find(hero => hero.status !== 'dead' && hero.items.some(item => item.id === itemId));
  const index = owner?.items.findIndex(item => item.id === itemId) ?? -1;
  if (!owner || index < 0) return false;
  const [item] = owner.items.splice(index, 1);
  delete item.cell;
  state.stash.push(item);
  state.item = state.heroes[0]?.items[0] ?? null;
  return true;
}

export function areAdjacent(a: CombatItem, b: CombatItem): boolean {
  const left = occupiedCells(a, a.cell ?? 0) ?? [];
  const right = occupiedCells(b, b.cell ?? 0) ?? [];
  return left.some(x => right.some(y => Math.abs(x % 4 - y % 4) + Math.abs(Math.floor(x / 4) - Math.floor(y / 4)) === 1));
}

export function itemBonuses(item: CombatItem, items: CombatItem[]): { damage: number; cooldownFactor: number; descriptions: string[] } {
  const neighbours = items.filter(other => other.id !== item.id && areAdjacent(item, other));
  const stones = item.tags?.includes('blade') ? neighbours.filter(other => other.tags?.includes('whetstone')).length : 0;
  const springs = item.tags?.includes('clockwork') ? neighbours.filter(other => other.tags?.includes('spring')).length : 0;
  return {
    damage: stones * 2,
    cooldownFactor: Math.max(0.1, 1 - springs * 0.15),
    descriptions: [...(stones ? [`Клинок: +${stones * 2} урона`] : []), ...(springs ? [`Механизм: −${springs * 15}% кулдауна`] : [])],
  };
}
