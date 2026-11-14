import { createFullEncounter } from './encounter.ts';
import { COMBAT_CONFIG } from './config.ts';
import { areAdjacent, canPlaceItem, itemBonuses, moveItem, storeItem } from './inventory.ts';
import { createRun, beginRun, claimReward, enterRoom, nextRoomChoices, openRoute, syncRun } from './run.ts';
import { HERO_ITEM_AFFINITIES, prepareEncounter, queueWinding, startBattle, stepEncounter, type CombatItem, type EncounterState, type ItemClassAffinity } from './simulation.ts';

export type BalanceAgent = 'random' | 'synergy' | 'balanced';
export type BalanceOutcome = 'victory' | 'defeat' | 'timeout';

export interface BalanceRoomResult {
  room: number;
  kind: 'battle' | 'boss';
  outcome: 'victory' | 'defeat' | 'ongoing';
  durationSeconds: number;
  enemyHealth: number;
  enemyDamage: number;
}

export interface BalanceRunResult {
  agent: BalanceAgent;
  seed: number;
  outcome: BalanceOutcome;
  roomsCleared: number;
  durationSeconds: number;
  permanentlyLostHeroes: number;
  rooms: BalanceRoomResult[];
}

const FRAME_MS = 100;
const MAX_BATTLE_MS = 240_000;
const WIND_CLICK_INTERVAL_MS = 200;
const HERO_CLASSES = HERO_ITEM_AFFINITIES;

interface PlacementOption {
  heroId: string;
  cell: number;
  rotation: number;
  synergyScore: number;
  balancedScore: number;
}

interface BattleResult {
  outcome: EncounterState['outcome'] | 'timeout';
  elapsedMs: number;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

function triggerWeight(item: CombatItem): number {
  switch (item.trigger) {
    case 'ownerBelowHalf': return 0.35;
    case 'targetBelowHalf': return 0.55;
    case 'allyBelowHalf': return 0.45;
    case 'passive': return 0;
    default: return 1;
  }
}

function effectWeight(item: CombatItem): number {
  if (item.effect === 'heal') return 0.9;
  if (item.effect === 'wind') return 0.9;
  if (item.effect === 'passive' || item.trigger === 'passive') return 0;
  return 1;
}

/** Rough expected combat value used only by the simulated agents' loot policy. */
function loadoutPower(items: CombatItem[], affinity?: ItemClassAffinity): number {
  const nativeFactor = (item: CombatItem): number => item.classAffinity === affinity ? COMBAT_CONFIG.classAffinityMultiplier : 1;
  const armor = Math.min(3, Math.round(items.reduce((sum, item) => sum + (item.passiveBonuses?.armor ?? 0) * nativeFactor(item), 0)));
  // Armor is unusually valuable in a long idle fight: it reduces every incoming hit.
  let score = armor * 20;
  for (const item of items) {
    if (item.effect === 'passive' || item.trigger === 'passive') continue;
    const bonus = itemBonuses(item, items, affinity);
    const cooldown = Math.max(300, item.cooldownMs * bonus.cooldownFactor);
    const amount = item.effect === 'wind' ? (item.windAmount ?? item.damage) + bonus.wind : item.damage + bonus.damage;
    score += amount * nativeFactor(item) * 1000 / cooldown * triggerWeight(item) * effectWeight(item);
  }
  return score;
}

function singleItemValue(item: CombatItem, affinity?: ItemClassAffinity): number {
  return loadoutPower([item], affinity) + (item.rarityMultiplier ?? 1) * 0.01;
}

function placementOptions(state: EncounterState, item: CombatItem): PlacementOption[] {
  const options: PlacementOption[] = [];
  const previousCell = item.cell;
  const previousRotation = item.rotation;
  const partyPower = state.heroes.reduce((sum, hero) => sum + loadoutPower(hero.items, HERO_CLASSES[hero.slot]), 0);
  const partyMean = Math.max(1, partyPower / Math.max(1, state.heroes.filter(hero => hero.status !== 'dead').length));

  for (const hero of state.heroes) {
    if (hero.status === 'dead') continue;
    const before = loadoutPower(hero.items, HERO_CLASSES[hero.slot]);
    for (let rotation = 0; rotation < 4; rotation++) {
      if (rotation === 0) delete item.rotation;
      else item.rotation = rotation;
      let firstFit = true;
      for (let cell = 0; cell < 36; cell++) {
        if (!canPlaceItem(state, item, hero.id, cell)) continue;
        item.cell = cell;
        hero.items.push(item);
        const changesSynergy = hero.items.slice(0, -1).some(other => areAdjacent(item, other));
        if (!firstFit && !changesSynergy) {
          hero.items.pop();
          continue;
        }
        firstFit = false;
        const gain = Math.max(0, loadoutPower(hero.items, HERO_CLASSES[hero.slot]) - before);
        hero.items.pop();
        const affinity = item.classAffinity === HERO_CLASSES[hero.slot] ? singleItemValue(item) * 0.25 : 0;
        const synergyScore = gain + affinity;
        const fairness = Math.max(0.72, Math.min(1.28, 1 + (partyMean - before) / partyMean * 0.35));
        options.push({ heroId: hero.id, cell, rotation, synergyScore, balancedScore: synergyScore * fairness });
      }
    }
  }
  if (previousCell === undefined) delete item.cell;
  else item.cell = previousCell;
  if (previousRotation === undefined) delete item.rotation;
  else item.rotation = previousRotation;
  return options;
}

function place(state: EncounterState, item: CombatItem, option: PlacementOption): boolean {
  if (option.rotation === 0) delete item.rotation;
  else item.rotation = option.rotation;
  return moveItem(state, item.id, option.heroId, option.cell);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other]!, items[index]!];
  }
  return items;
}

function rebuildGear(state: EncounterState, agent: BalanceAgent, random: () => number, randomizeStarterGear = false): void {
  if (agent !== 'synergy') {
    if (agent === 'random' && randomizeStarterGear) {
      // Keep the generated class signature item; randomly redistribute the rest of each full starter pack.
      for (const hero of state.heroes) for (const item of [...hero.items.slice(1)]) storeItem(state, item.id);
    }
    const looseItems = shuffle([...state.stash, ...state.floor], random);
    for (const item of looseItems) {
      if (agent === 'balanced') placeBalanced(state, item, random);
      else placeRandomly(state, item, random);
    }
    return;
  }

  for (const hero of state.heroes) for (const item of [...hero.items]) storeItem(state, item.id);
  const looseItems = [...state.stash, ...state.floor].sort((a, b) => singleItemValue(b) - singleItemValue(a));
  for (const item of looseItems) {
    const options = placementOptions(state, item);
    if (!options.length) continue;
    options.sort((a, b) => b.balancedScore - a.balancedScore);
    place(state, item, options[0]!);
  }
}

/** The middle policy favors useful items and weaker owners but does not optimize adjacency. */
function placeBalanced(state: EncounterState, item: CombatItem, random: () => number): boolean {
  const allLiving = state.heroes.filter(hero => hero.status !== 'dead');
  const matching = allLiving.filter(hero => item.classAffinity === HERO_CLASSES[hero.slot]);
  const candidates = matching.length ? matching : allLiving;
  const ranked = shuffle([...candidates], random).sort((a, b) =>
    loadoutPower(a.items, HERO_CLASSES[a.slot]) - loadoutPower(b.items, HERO_CLASSES[b.slot]));
  const rotations = shuffle([0, 1, 2, 3], random);
  const cells = shuffle(Array.from({ length: 36 }, (_, cell) => cell), random);
  const tryPlace = (hero: EncounterState['heroes'][number]): boolean => {
    if (hero.items.length >= 10) return false;
    for (const rotation of rotations) {
      if (rotation === 0) delete item.rotation;
      else item.rotation = rotation;
      for (const cell of cells) if (canPlaceItem(state, item, hero.id, cell)) {
        if (moveItem(state, item.id, hero.id, cell)) return true;
      }
    }
    return false;
  };
  for (const hero of ranked) if (tryPlace(hero)) return true;

  // A middle-tier planner upgrades the weakest single item if a reward is clearly better.
  const upgradeOrder = shuffle([...candidates], random).sort((a, b) =>
    loadoutPower(a.items, HERO_CLASSES[a.slot]) - loadoutPower(b.items, HERO_CLASSES[b.slot]));
  for (const hero of upgradeOrder) {
    const weakest = hero.items.reduce<CombatItem | undefined>((current, other) =>
      !current || singleItemValue(other, HERO_CLASSES[hero.slot]) < singleItemValue(current, HERO_CLASSES[hero.slot]) ? other : current, undefined);
    if (!weakest || singleItemValue(item, HERO_CLASSES[hero.slot]) < singleItemValue(weakest, HERO_CLASSES[hero.slot]) * 1.1) continue;
    if (storeItem(state, weakest.id) && tryPlace(hero)) return true;
  }
  return false;
}

function placeRandomly(state: EncounterState, item: CombatItem, random: () => number, maxItemsPerHero = Number.POSITIVE_INFINITY): boolean {
  const heroes = shuffle(state.heroes.filter(hero => hero.status !== 'dead' && hero.items.length < maxItemsPerHero), random);
  const rotations = shuffle([0, 1, 2, 3], random);
  const cells = shuffle(Array.from({ length: 36 }, (_, cell) => cell), random);
  for (const hero of heroes) for (const rotation of rotations) {
    if (rotation === 0) delete item.rotation;
    else item.rotation = rotation;
    for (const cell of cells) if (canPlaceItem(state, item, hero.id, cell)) {
      return moveItem(state, item.id, hero.id, cell);
    }
  }
  return false;
}

function chooseReward(state: EncounterState, offers: CombatItem[], agent: BalanceAgent, random: () => number): CombatItem {
  if (agent === 'random') return offers[Math.floor(random() * offers.length)]!;
  if (agent === 'balanced') return [...offers].sort((a, b) => singleItemValue(b) - singleItemValue(a))[0]!;
  const ranked = offers.map(item => {
    const options = placementOptions(state, item);
    const best = options.reduce((score, option) => Math.max(score, option.balancedScore), 0);
    return { item, score: best + singleItemValue(item) * 0.01 };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]!.item;
}

function windMostUrgentDoll(state: EncounterState): void {
  const stopped = state.heroes.filter(hero => hero.status === 'stopped' && hero.durability > 0)
    .sort((a, b) => a.wind / Math.max(1, a.maxWind) - b.wind / Math.max(1, b.maxWind) || a.slot - b.slot);
  if (stopped[0]) queueWinding(state, stopped[0].id);
}

function simulateBattle(state: EncounterState): BattleResult {
  if (!startBattle(state)) return { outcome: 'timeout', elapsedMs: 0 };
  let elapsedMs = 0;
  let nextClickAt = 0;
  while (elapsedMs < MAX_BATTLE_MS && state.outcome === 'ongoing') {
    if (elapsedMs >= nextClickAt) {
      windMostUrgentDoll(state);
      nextClickAt = elapsedMs + WIND_CLICK_INTERVAL_MS;
    }
    stepEncounter(state, FRAME_MS);
    elapsedMs += FRAME_MS;
  }
  return { outcome: state.outcome === 'ongoing' ? 'timeout' : state.outcome, elapsedMs };
}

/** Plays the ten-room route with a repeatable loot policy and attentive manual winding. */
export function simulateBalanceRun(agent: BalanceAgent, seed: number): BalanceRunResult {
  const random = seededRandom(seed);
  const state = createFullEncounter({ fullStartingInventory: true, random });
  prepareEncounter(state);
  const run = createRun(state, random);
  const rooms: BalanceRoomResult[] = [];
  let roomsCleared = 0;
  let durationSeconds = 0;
  rebuildGear(state, agent, random, agent === 'random');
  beginRun(run);

  for (let room = 1; room <= 10; room++) {
    if (room > 1) {
      if (!openRoute(run)) break;
      const choices = nextRoomChoices(run);
      const choice = room === 10 ? choices.find(candidate => candidate.kind === 'boss')
        : choices.find(candidate => candidate.kind === 'battle' && candidate.variant === 2) ?? choices.find(candidate => candidate.kind === 'battle');
      if (!choice || !enterRoom(run, choice.id)) break;
    }

    const enemyHealth = state.enemies.reduce((sum, enemy) => sum + enemy.maxHp, 0);
    const enemyDamage = state.enemies.reduce((sum, enemy) => sum + enemy.attackDamage, 0);
    const battle = simulateBattle(state);
    durationSeconds += battle.elapsedMs / 1000;
    syncRun(run);
    rooms.push({ room, kind: run.current === 'boss' ? 'boss' : 'battle', outcome: battle.outcome === 'timeout' ? 'ongoing' : battle.outcome, durationSeconds: battle.elapsedMs / 1000, enemyHealth, enemyDamage });

    if (battle.outcome === 'timeout') return result('timeout');
    if (battle.outcome === 'defeat') return result('defeat');
    roomsCleared++;
    if (run.stage === 'victory') return result('victory');

    const reward = chooseReward(state, run.offers, agent, random);
    if (!claimReward(run, reward.id)) return result('timeout');
    rebuildGear(state, agent, random);
  }
  return result(run.stage === 'victory' ? 'victory' : 'timeout');

  function result(outcome: BalanceOutcome): BalanceRunResult {
    return {
      agent,
      seed,
      outcome,
      roomsCleared,
      durationSeconds,
      permanentlyLostHeroes: state.heroes.filter(hero => hero.status === 'dead').length,
      rooms: [...rooms],
    };
  }
}

export function summarizeBalanceRuns(results: BalanceRunResult[]) {
  const wins = results.filter(result => result.outcome === 'victory').length;
  const losses = results.filter(result => result.outcome === 'defeat').length;
  const timeouts = results.filter(result => result.outcome === 'timeout').length;
  const averageRooms = results.reduce((sum, result) => sum + result.roomsCleared, 0) / Math.max(1, results.length);
  const averageSeconds = results.reduce((sum, result) => sum + result.durationSeconds, 0) / Math.max(1, results.length);
  const bossAttempts = results.filter(result => result.rooms.some(room => room.kind === 'boss')).length;
  const bossWins = results.filter(result => result.outcome === 'victory').length;
  const bossRooms = results.flatMap(result => result.rooms.filter(room => room.kind === 'boss'));
  const averageBossSeconds = bossRooms.reduce((sum, room) => sum + room.durationSeconds, 0) / Math.max(1, bossRooms.length);
  return { runs: results.length, wins, losses, timeouts, averageRooms, averageSeconds, bossAttempts, bossWins, averageBossSeconds };
}
