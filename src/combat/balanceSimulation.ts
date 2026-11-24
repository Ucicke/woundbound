import { createFullEncounter } from './encounter.ts';
import { COMBAT_CONFIG } from './config.ts';
import { areAdjacent, canPlaceItem, itemBonuses, moveItem, storeItem } from './inventory.ts';
import { RUN_ROOM_COUNT, createRun, beginRun, calmWorkshopItem, canUseInfirmary, claimReward, enterRoom, leaveWorkshop, nextRoomChoices, openRoute, resolveInfirmary, syncRun, windWorkshop } from './run.ts';
import { heroClassForActor, MAX_ARMOR, prepareEncounter, queueWinding, stepEncounter, type CombatItem, type EncounterState, type ItemClassAffinity } from './simulation.ts';

export type BalanceAgent = 'random' | 'synergy' | 'balanced';
export type BalanceOutcome = 'victory' | 'defeat' | 'timeout';

export interface BalanceRoomResult {
  room: number;
  kind: 'battle' | 'boss' | 'cache' | 'workshop' | 'event';
  outcome: 'victory' | 'defeat' | 'ongoing' | 'cleared';
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

/** Balance runs must begin with the same small curated kit as a real new run. */
export function createBalanceSimulationStart(random: () => number) {
  return createFullEncounter({ fullStartingInventory: false, random });
}

const FRAME_MS = 100;
const MAX_BATTLE_MS = 360_000;
const WIND_CLICK_INTERVAL_MS = 200;
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
  const nativeFactor = (item: CombatItem): number => affinity && item.classAffinity === affinity ? COMBAT_CONFIG.classAffinityMultiplier : 1;
  const armor = Math.min(MAX_ARMOR, Math.round(items.reduce((sum, item) => sum + (item.passiveBonuses?.armor ?? 0) * nativeFactor(item), 0)));
  // Armor is unusually valuable in a long idle fight: it reduces every incoming hit.
  let score = armor * 20;
  for (const item of items) {
    if (item.effect === 'passive' || item.trigger === 'passive') continue;
    const bonus = itemBonuses(item, items, affinity);
    const cooldown = Math.max(300, item.cooldownMs * bonus.cooldownFactor);
    const amount = item.effect === 'wind' ? (item.windAmount ?? item.damage) + bonus.wind
      : item.effect === 'heal' ? item.damage + bonus.healing : item.damage + bonus.damage;
    score += amount * nativeFactor(item) * 1000 / cooldown * triggerWeight(item) * effectWeight(item);
  }
  return score;
}

function singleItemValue(item: CombatItem, affinity?: ItemClassAffinity): number {
  return loadoutPower([item], affinity) + (item.rarityMultiplier ?? 1) * 0.01;
}

function placementOptions(state: EncounterState, item: CombatItem): PlacementOption[] {
  const options: PlacementOption[] = [];
  const partyPower = state.heroes.reduce((sum, hero) => sum + loadoutPower(hero.items, heroClassForActor(hero)), 0);
  const partyMean = Math.max(1, partyPower / Math.max(1, state.heroes.filter(hero => hero.status !== 'dead').length));

  for (const hero of state.heroes) {
    if (hero.status === 'dead') continue;
    const affinity = heroClassForActor(hero);
    const before = loadoutPower(hero.items, affinity);
    for (let rotation = 0; rotation < 4; rotation++) {
      const candidate = { ...item };
      if (rotation === 0) delete candidate.rotation;
      else candidate.rotation = rotation;
      let firstFit = true;
      for (let cell = 0; cell < 36; cell++) {
        candidate.cell = cell;
        if (!canPlaceItem(state, candidate, hero.id, cell)) continue;
        const candidateItems = [...hero.items, candidate];
        const changesSynergy = hero.items.some(other => areAdjacent(candidate, other));
        if (!firstFit && !changesSynergy) {
          continue;
        }
        firstFit = false;
        const gain = Math.max(0, loadoutPower(candidateItems, affinity) - before);
        const classBonus = affinity && candidate.classAffinity === affinity ? singleItemValue(candidate, affinity) * 0.25 : 0;
        const synergyScore = gain + classBonus;
        const fairness = Math.max(0.72, Math.min(1.28, 1 + (partyMean - before) / partyMean * 0.35));
        options.push({ heroId: hero.id, cell, rotation, synergyScore, balancedScore: synergyScore * fairness });
      }
    }
  }
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
      // Model the stated novice policy: every starter item can land on any hero before the first fight.
      for (const hero of state.heroes) for (const item of [...hero.items]) storeItem(state, item.id);
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
    options.sort((a, b) => b.synergyScore - a.synergyScore);
    place(state, item, options[0]!);
  }
}

/** The middle policy favors useful items and weaker owners but does not optimize adjacency. */
function placeBalanced(state: EncounterState, item: CombatItem, random: () => number): boolean {
  const allLiving = state.heroes.filter(hero => hero.status !== 'dead');
  const matching = allLiving.filter(hero => item.classAffinity === heroClassForActor(hero));
  const candidates = matching.length && random() < 0.35 ? matching : allLiving;
  const ranked = shuffle([...candidates], random).sort((a, b) =>
    loadoutPower(a.items, heroClassForActor(a)) - loadoutPower(b.items, heroClassForActor(b)));
  if (ranked.length > 1 && random() < 0.35) [ranked[0], ranked[1]] = [ranked[1]!, ranked[0]!];
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
    loadoutPower(a.items, heroClassForActor(a)) - loadoutPower(b.items, heroClassForActor(b)));
  for (const hero of upgradeOrder) {
    const weakest = hero.items.reduce<CombatItem | undefined>((current, other) =>
      !current || singleItemValue(other, heroClassForActor(hero)) < singleItemValue(current, heroClassForActor(hero)) ? other : current, undefined);
    if (!weakest || singleItemValue(item, heroClassForActor(hero)) < singleItemValue(weakest, heroClassForActor(hero)) * 1.1) continue;
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

function chooseReward(state: EncounterState, offers: readonly CombatItem[], agent: BalanceAgent, random: () => number): CombatItem {
  if (agent === 'random') return offers[Math.floor(random() * offers.length)]!;
  if (agent === 'balanced') {
    const ranked = [...offers].sort((a, b) => singleItemValue(b) - singleItemValue(a));
    return ranked[random() < 0.25 || ranked.length < 2 ? 0 : 1]!;
  }
  const ranked = offers.map(item => {
    const options = placementOptions(state, item);
    const best = options.reduce((score, option) => Math.max(score, option.synergyScore), 0);
    return { item, score: best + singleItemValue(item) * 0.01 };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]!.item;
}

function teamNeedsWorkshop(state: EncounterState): boolean {
  const dollsNeedWinding = state.heroes.some(hero => (hero.status === 'stopped' || hero.status === 'active') &&
    hero.durability > 0 && hero.windUpCharge < hero.maxWindUp * 0.9);
  const hasUncalmedLantern = state.heroes.some(hero => hero.items.some(item => item.definitionId === 'lantern' && !item.calmed));
  return dollsNeedWinding || hasUncalmedLantern;
}

function infirmaryChoice(state: EncounterState): 'heal' | 'repair' {
  const missingHumanHp = state.heroes.reduce((sum, hero) => sum + (hero.status === 'human' ? hero.maxHp - hero.hp : 0), 0);
  const missingDollDurability = state.heroes.reduce((sum, hero) => sum +
    ((hero.status === 'active' || hero.status === 'stopped') ? hero.maxDurability - hero.durability : 0), 0);
  return missingDollDurability > missingHumanHp ? 'repair' : 'heal';
}

/** Choose between the actual route options instead of forcing every agent into an elite fight. */
function chooseRoute(state: EncounterState, choices: ReturnType<typeof nextRoomChoices>, agent: BalanceAgent, random: () => number) {
  if (choices.length === 1) return choices[0]!;

  const cache = choices.find(choice => choice.kind === 'cache');
  const workshop = choices.find(choice => choice.kind === 'workshop');
  const event = choices.find(choice => choice.kind === 'event');
  const battles = choices.filter(choice => choice.kind === 'battle').sort((a, b) => (a.variant ?? 0) - (b.variant ?? 0));

  if (agent === 'random') {
    return choices[Math.floor(random() * choices.length)]!;
  }

  if (agent === 'synergy') {
    const repairNeed = state.heroes.some(hero => (hero.status === 'active' || hero.status === 'stopped') && hero.durability < hero.maxDurability * 0.8);
    const healingNeed = state.heroes.some(hero => hero.status === 'human' && hero.hp < hero.maxHp * 0.6);
    if (event && (repairNeed || healingNeed)) return event;
    if (cache) return cache;
    if (workshop && teamNeedsWorkshop(state)) return workshop;
    return battles[0] ?? choices[0]!;
  }

  // The middle policy values safe rooms, but sometimes accepts the risk of a fight for extra loot.
  if (event && (state.heroes.some(hero => hero.status === 'active' || hero.status === 'stopped') || random() < 0.2) && random() < 0.15) return event;
  if (cache && random() < 0.15) return cache;
  if (workshop && teamNeedsWorkshop(state) && random() < 0.2) return workshop;
  if (battles.length > 1 && random() < 0.7) return battles[battles.length - 1]!;
  return battles[0] ?? choices[0]!;
}

function windMostUrgentDoll(state: EncounterState): void {
  const stopped = state.heroes.filter(hero => hero.status === 'stopped' && hero.durability > 0)
    .sort((a, b) => a.windUpCharge / Math.max(1, a.maxWindUp) - b.windUpCharge / Math.max(1, b.maxWindUp) || a.slot - b.slot);
  if (stopped[0]) queueWinding(state, stopped[0].id);
}

function simulateBattle(state: EncounterState): BattleResult {
  if (state.phase !== 'combat' || state.outcome !== 'ongoing') {
    throw new Error(`Cannot simulate battle from phase '${state.phase}' with outcome '${state.outcome}'.`);
  }
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

function requireSimulationStep(success: boolean, action: string, room: number): asserts success {
  if (!success) throw new Error(`Balance simulation failed to ${action} in room ${room}.`);
}

/** Plays the ten-room route with a repeatable loot policy and attentive manual winding. */
export function simulateBalanceRun(agent: BalanceAgent, seed: number): BalanceRunResult {
  const random = seededRandom(seed);
  const state = createBalanceSimulationStart(random);
  prepareEncounter(state);
  if (agent === 'random') rebuildGear(state, agent, random, true);
  const run = createRun(state, random);
  const rooms: BalanceRoomResult[] = [];
  let roomsCleared = 0;
  let durationSeconds = 0;
  beginRun(run);

  for (let room = 1; room <= RUN_ROOM_COUNT; room++) {
    let roomKind: BalanceRoomResult['kind'] = 'battle';
    if (room > 1) {
      requireSimulationStep(openRoute(run), 'open the route', room);
      const choices = nextRoomChoices(run);
      const choice = chooseRoute(state, choices, agent, random);
      if (!choice) throw new Error(`Balance simulation has no route choices in room ${room}.`);
      requireSimulationStep(enterRoom(run, choice.id), 'enter the selected room', room);
      roomKind = choice.kind;

      if (choice.kind === 'cache') {
        const reward = chooseReward(state, run.offers, agent, random);
        requireSimulationStep(claimReward(run, reward.id), 'claim the cache reward', room);
        rebuildGear(state, agent, random);
        roomsCleared++;
        rooms.push({ room, kind: 'cache', outcome: 'cleared', durationSeconds: 0, enemyHealth: 0, enemyDamage: 0 });
        continue;
      }

      if (choice.kind === 'workshop') {
        windWorkshop(run);
        const lantern = state.heroes.flatMap(hero => hero.items).find(item => item.definitionId === 'lantern' && !item.calmed);
        if (lantern && (agent !== 'random' || random() < 0.5)) calmWorkshopItem(run, lantern.id);
        requireSimulationStep(leaveWorkshop(run), 'leave the workshop', room);
        roomsCleared++;
        rooms.push({ room, kind: 'workshop', outcome: 'cleared', durationSeconds: 0, enemyHealth: 0, enemyDamage: 0 });
        continue;
      }

      if (choice.kind === 'event') {
        const preferred = agent === 'random' ? (random() < 0.5 ? 'heal' : 'repair') : infirmaryChoice(state);
        const alternative = preferred === 'heal' ? 'repair' : 'heal';
        const treatment = canUseInfirmary(run, preferred) ? preferred
          : canUseInfirmary(run, alternative) ? alternative : 'leave';
        requireSimulationStep(
          resolveInfirmary(run, treatment),
          'resolve the infirmary event', room,
        );
        roomsCleared++;
        rooms.push({ room, kind: 'event', outcome: 'cleared', durationSeconds: 0, enemyHealth: 0, enemyDamage: 0 });
        continue;
      }
    }

    const enemyHealth = state.enemies.reduce((sum, enemy) => sum + enemy.maxHp, 0);
    const enemyDamage = state.enemies.reduce((sum, enemy) => sum + enemy.attackDamage, 0);
    const battle = simulateBattle(state);
    durationSeconds += battle.elapsedMs / 1000;
    syncRun(run);
    rooms.push({ room, kind: run.current === 'boss' ? 'boss' : roomKind, outcome: battle.outcome === 'timeout' ? 'ongoing' : battle.outcome, durationSeconds: battle.elapsedMs / 1000, enemyHealth, enemyDamage });

    if (battle.outcome === 'timeout') return result('timeout');
    if (battle.outcome === 'defeat') return result('defeat');
    roomsCleared++;
    if (run.stage === 'victory') return result('victory');

    const reward = chooseReward(state, run.offers, agent, random);
    requireSimulationStep(claimReward(run, reward.id), 'claim the battle reward', room);
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
