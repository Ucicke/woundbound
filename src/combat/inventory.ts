import { SYNERGY_RULES } from './synergy.ts';
import { formatItemNumber } from './formatNumber.ts';
import type { CombatItem, EncounterState, ItemClassAffinity } from './simulation.ts';
import { COMBAT_CONFIG } from './config.ts';

export type Cell = readonly [number, number];
/** One inventory geometry contract for rules, pointer math, and Canvas layout. */
export const INVENTORY_GRID_SIZE = 6;
export const INVENTORY_CELL_COUNT = INVENTORY_GRID_SIZE * INVENTORY_GRID_SIZE;
export const inventoryColumn = (index: number): number => index % INVENTORY_GRID_SIZE;
export const inventoryRow = (index: number): number => Math.floor(index / INVENTORY_GRID_SIZE);
export const inventoryIndex = (column: number, row: number): number => row * INVENTORY_GRID_SIZE + column;
const shapeOf = (item: CombatItem): readonly Cell[] => item.shape ?? [[0, 0]];

export function rotatedShape(item: CombatItem): readonly Cell[] {
  let cells = shapeOf(item).map(([x, y]) => [x, y] as const);
  const turns = ((item.rotation ?? 0) % 4 + 4) % 4;
  for (let turn = 0; turn < turns; turn++) {
    const rotated = cells.map(([x, y]) => [-y, x] as const);
    const minX = Math.min(...rotated.map(([x]) => x));
    const minY = Math.min(...rotated.map(([, y]) => y));
    cells = rotated.map(([x, y]) => [x - minX, y - minY] as const);
  }
  return cells;
}

export function rotateItem(item: CombatItem): void {
  item.rotation = ((item.rotation ?? 0) + 1) % 4;
}

export function occupiedCells(item: CombatItem, cell: number | undefined): number[] | null {
  if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= INVENTORY_CELL_COUNT) return null;
  const x = inventoryColumn(cell), y = inventoryRow(cell);
  const result: number[] = [];
  for (const [dx, dy] of rotatedShape(item)) {
    const cx = x + dx, cy = y + dy;
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cx >= INVENTORY_GRID_SIZE || cy < 0 || cy >= INVENTORY_GRID_SIZE) return null;
    const index = inventoryIndex(cx, cy);
    if (result.includes(index)) return null;
    result.push(index);
  }
  return result.length ? result : null;
}

function overlapsExisting(items: readonly CombatItem[], cells: readonly number[], ignoredItem?: CombatItem): boolean {
  return items.some(other => {
    if (other === ignoredItem) return false;
    const occupied = occupiedCells(other, other.cell);
    return !occupied || occupied.some(index => cells.includes(index));
  });
}

export function findPlacement(state: EncounterState, item: CombatItem, heroId: string): number | null {
  const hero = state.heroes.find(candidate => candidate.id === heroId && candidate.status !== 'dead');
  if (!hero) return null;
  for (let cell = 0; cell < INVENTORY_CELL_COUNT; cell++) {
    const occupied = occupiedCells(item, cell);
    if (occupied && !overlapsExisting(hero.items, occupied, item)) return cell;
  }
  return null;
}

export function rotateItemInInventory(state: EncounterState, itemId: string): boolean {
  if (state.phase !== 'preparation' && state.phase !== 'result') return false;
  const owner = state.heroes.find(hero => hero.items.some(candidate => candidate.id === itemId));
  const item = [state.stash, state.floor, ...state.heroes.map(hero => hero.items)].flat().find(candidate => candidate.id === itemId);
  if (!item) return false;
  const previous = item.rotation ?? 0;
  rotateItem(item);
  if (owner) {
    const cells = occupiedCells(item, item.cell);
    if (!cells || overlapsExisting(owner.items, cells, item)) { item.rotation = previous; return false; }
  }
  return true;
}

/** Validate the entire footprint without changing ownership or position. */
export function canPlaceItem(state: EncounterState, item: CombatItem, heroId: string, cell: number): boolean {
  if (state.phase !== 'preparation' && state.phase !== 'result') return false;
  const hero = state.heroes.find(candidate => candidate.id === heroId && candidate.status !== 'dead');
  const cells = occupiedCells(item, cell);
  if (!hero || !cells) return false;
  return !overlapsExisting(hero.items, cells, item);
}

/** Move one real instance only after validating the complete destination. */
export function moveItem(state: EncounterState, itemId: string, heroId: string, cell: number): boolean {
  if (state.phase !== 'preparation' && state.phase !== 'result') return false;
  const hero = state.heroes.find(candidate => candidate.id === heroId && candidate.status !== 'dead');
  const sources = [state.stash, state.floor, ...state.heroes.map(candidate => candidate.items)];
  const source = sources.find(items => items.some(item => item.id === itemId));
  const item = source?.find(candidate => candidate.id === itemId);
  if (!hero || !source || !item) return false;
  if (!canPlaceItem(state, item, heroId, cell)) return false;
  source.splice(source.indexOf(item), 1);
  item.cell = cell;
  hero.items.push(item);
  return true;
}

export function storeItem(state: EncounterState, itemId: string): boolean {
  if (state.phase !== 'preparation' && state.phase !== 'result') return false;
  const owner = state.heroes.find(hero => (state.phase === 'result' || hero.status !== 'dead') && hero.items.some(item => item.id === itemId));
  const index = owner?.items.findIndex(item => item.id === itemId) ?? -1;
  if (!owner || index < 0) return false;
  const [item] = owner.items.splice(index, 1);
  delete item.cell;
  state.floor.push(item);
  return true;
}

export function areAdjacent(a: CombatItem, b: CombatItem): boolean {
  const left = occupiedCells(a, a.cell);
  const right = occupiedCells(b, b.cell);
  if (!left || !right) return false;
  return left.some(x => right.some(y => Math.abs(inventoryColumn(x) - inventoryColumn(y)) + Math.abs(inventoryRow(x) - inventoryRow(y)) === 1));
}

export const SYNERGY_TAG_LABELS: Record<string, string> = { blade: 'КЛИНОК', whetstone: 'ТОЧИЛЬНЫЙ КАМЕНЬ', clockwork: 'МЕХАНИЗМ', spring: 'ПРУЖИНА', firearm: 'СТРЕЛКОВОЕ', scope: 'ПРИЦЕЛ', support: 'ПОДДЕРЖКА', glass: 'СТЕКЛО', bell: 'КОЛОКОЛ' };
export function synergyTargets(item: CombatItem): Array<{ tag: string; text: string; negative?: boolean }> {
  const result: Array<{ tag: string; text: string; negative?: boolean }> = [];
  if (item.tags?.includes('whetstone')) result.push({ tag: 'blade', text: `+${SYNERGY_RULES.whetstoneDamage} урона` });
  if (item.tags?.includes('blade')) result.push({ tag: 'whetstone', text: `+${SYNERGY_RULES.whetstoneDamage} урона` });
  if (item.tags?.includes('spring')) result.push({ tag: 'clockwork', text: `−${Math.round(SYNERGY_RULES.springCooldownReduction * 100)}% кулдауна` });
  if (item.tags?.includes('clockwork')) result.push({ tag: 'spring', text: `−${Math.round(SYNERGY_RULES.springCooldownReduction * 100)}% кулдауна` });
  if (item.tags?.includes('scope')) result.push({ tag: 'firearm', text: `+${SYNERGY_RULES.scopeDamage} урона` });
  if (item.tags?.includes('firearm')) result.push({ tag: 'scope', text: `+${SYNERGY_RULES.scopeDamage} урона` });
  if (item.definitionId === 'lantern' && !item.calmed) result.push({ tag: 'blade', text: `+${Math.round(SYNERGY_RULES.jealousCooldownIncrease * 100)}% кулдауна`, negative: true });
  return result;
}

export function itemBonuses(item: CombatItem, items: CombatItem[], ownerAffinity?: ItemClassAffinity): { damage: number; cooldownFactor: number; healing: number; wind: number; descriptions: string[] } {
  const neighbours = items.filter(other => other !== item && areAdjacent(item, other));
  const stones = item.tags?.includes('blade') ? neighbours.filter(other => other.tags?.includes('whetstone')).length : 0;
  const springs = item.tags?.includes('clockwork') ? neighbours.filter(other => other.tags?.includes('spring')).length : 0;
  const scopes = item.tags?.includes('firearm') ? neighbours.filter(other => other.tags?.includes('scope')).length : 0;
  const jealous = item.definitionId === 'lantern' && !item.calmed && neighbours.some(other => other.tags?.includes('blade'));
  const passiveFactor = (other: CombatItem): number => ownerAffinity && other.classAffinity === ownerAffinity ? COMBAT_CONFIG.classAffinityMultiplier : 1;
  const passiveDamage = items.reduce((sum, other) => sum + (other.passiveBonuses?.damageReach && item.reach !== other.passiveBonuses.damageReach ? 0 : (other.passiveBonuses?.damage ?? 0) * passiveFactor(other)), 0);
  const passiveHealing = items.reduce((sum, other) => sum + (other.passiveBonuses?.healing ?? 0) * passiveFactor(other), 0);
  const passiveWind = items.reduce((sum, other) => sum + (other.passiveBonuses?.wind ?? 0) * passiveFactor(other), 0);
  const passiveCooldown = items.reduce((factor, other) => {
    const cooldown = other.passiveBonuses?.cooldownFactor ?? 1;
    return factor * Math.max(0.5, 1 - (1 - cooldown) * passiveFactor(other));
  }, 1);
  const adjacencyCooldown = Math.max(0.1, 1 - springs * SYNERGY_RULES.springCooldownReduction) * (jealous ? 1 + SYNERGY_RULES.jealousCooldownIncrease : 1);
  return {
    damage: stones * SYNERGY_RULES.whetstoneDamage + scopes * SYNERGY_RULES.scopeDamage + passiveDamage,
    cooldownFactor: Math.max(SYNERGY_RULES.minimumCooldownFactor, adjacencyCooldown * passiveCooldown),
    healing: passiveHealing,
    wind: passiveWind,
    descriptions: [
      ...(stones ? [`Клинок: +${stones * SYNERGY_RULES.whetstoneDamage} урона`] : []),
      ...(scopes ? [`Прицел: +${scopes * SYNERGY_RULES.scopeDamage} урона`] : []),
      ...(springs ? [`Механизм: −${Math.round(springs * SYNERGY_RULES.springCooldownReduction * 100)}% кулдауна`] : []),
      ...(passiveDamage ? [`Снаряжение: +${formatItemNumber(passiveDamage)} урона`] : []),
      ...(passiveHealing ? [`Реликвии: +${formatItemNumber(passiveHealing)} лечения`] : []),
      ...(passiveWind ? [`Механизмы: +${formatItemNumber(passiveWind)} завода`] : []),
      ...(passiveCooldown < 1 ? [`Снаряжение: −${Math.round((1 - passiveCooldown) * 100)}% кулдауна`] : []),
      ...(jealous ? [`Ревность: +${Math.round(SYNERGY_RULES.jealousCooldownIncrease * 100)}% кулдауна рядом с клинком`] : []),
    ],
  };
}
