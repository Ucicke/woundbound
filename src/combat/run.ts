import { createItem, EXPANSION_ITEM_IDS, itemDefinitionIds } from './items.ts';
import { createActor, type CombatItem, type Combatant, type EncounterState } from './simulation.ts';
import { COMBAT_CONFIG } from './config.ts';

export type RoomKind = 'battle' | 'cache' | 'workshop' | 'event' | 'boss';
export type RunStage = 'opening' | 'battle' | 'reward' | 'cleared' | 'route' | 'cache' | 'workshop' | 'event' | 'victory' | 'defeat';
export interface RoomChoice { id: string; kind: RoomKind; label: string; variant?: number }
export interface RunState {
  encounter: EncounterState; room: number; stage: RunStage; current: RoomKind; roomLabel: string;
  offers: CombatItem[]; rewardClaimed: boolean; workshopCalmed: boolean; random: () => number;
}

function enemiesFor(room: number, variant: number, boss = false): Combatant[] {
  if (boss) {
    // The final encounter uses the same floor curve as ordinary enemies, with a steeper health slope.
    const roomsAfterOpening = Math.max(0, room - 1);
    const bossTier = Math.floor(roomsAfterOpening / 3);
    const leader = createActor(`room-${room}-boss`, 'Заводной архонт', 'enemy', 0, COMBAT_CONFIG.bossHealth + roomsAfterOpening * COMBAT_CONFIG.bossHealthPerRoom, 'lowest');
    leader.isBoss = true; leader.attackDamage = COMBAT_CONFIG.bossAttackDamage + bossTier;
    leader.attackCooldownMs = leader.attackRemainingMs = Math.max(1800, COMBAT_CONFIG.enemyAttackCooldownMs + 500 - roomsAfterOpening * COMBAT_CONFIG.enemyAttackCooldownReductionPerRoomMs); leader.reach = 'far';
    const guard = createActor(`room-${room}-guard`, 'Сломанный автоматон', 'enemy', 1, COMBAT_CONFIG.bossGuardHealth + roomsAfterOpening * COMBAT_CONFIG.bossGuardHealthPerRoom);
    guard.attackDamage = COMBAT_CONFIG.bossGuardAttackDamage + bossTier;
    guard.attackCooldownMs = guard.attackRemainingMs = Math.max(1800, COMBAT_CONFIG.enemyAttackCooldownMs + 800 - roomsAfterOpening * COMBAT_CONFIG.enemyAttackCooldownReductionPerRoomMs);
    return [leader, guard];
  }
  const names = ['Чумная крыса', 'Культист', 'Сломанный автоматон'];
  const count = 4;
  return Array.from({ length: count }, (_, slot) => {
    const kind = Math.max(0, Math.min(names.length - 1, variant));
    // Health rises every room; damage tiers and faster attacks make later acts pressure the whole party.
    const health = COMBAT_CONFIG.enemyStartingHealth + (room - 1) * COMBAT_CONFIG.enemyHealthPerRoom + kind * COMBAT_CONFIG.enemyHealthPerTier;
    const enemy = createActor(`room-${room}-enemy-${slot}`, names[kind], 'enemy', slot, health, kind === 1 ? 'lowest' : 'front');
    enemy.attackDamage = COMBAT_CONFIG.enemyStartingDamage + Math.floor((room - 1) / COMBAT_CONFIG.enemyDamageEveryRooms) + (kind === 2 ? 1 : 0);
    enemy.attackCooldownMs = enemy.attackRemainingMs = Math.max(1600, COMBAT_CONFIG.enemyAttackCooldownMs - (room - 1) * COMBAT_CONFIG.enemyAttackCooldownReductionPerRoomMs + slot * COMBAT_CONFIG.enemyAttackStaggerMs);
    enemy.reach = kind === 1 ? 'far' : 'near';
    return enemy;
  });
}

function setEnemies(encounter: EncounterState, enemies: Combatant[]): void {
  encounter.enemies = enemies; encounter.enemy = enemies[0]!;
  encounter.outcome = 'ongoing'; encounter.phase = 'preparation'; encounter.commands.length = 0;
}

/** The opening encounter is room one; all party and inventory objects remain owned by the encounter. */
export function createRun(encounter: EncounterState, random: () => number = Math.random): RunState {
  setEnemies(encounter, enemiesFor(1, 0));
  return { encounter, room: 1, stage: 'opening', current: 'battle', roomLabel: 'Крысиные катакомбы', offers: [], rewardClaimed: false, workshopCalmed: false, random };
}

/** Opens the first named encounter exactly once; later rooms use enterRoom directly. */
export function beginRun(run: RunState): boolean {
  if (run.stage !== 'opening' || run.encounter.phase !== 'preparation') return false;
  run.stage = 'battle';
  return true;
}

export function syncRun(run: RunState): void {
  if (run.stage !== 'battle' || run.encounter.outcome === 'ongoing') return;
  if (run.encounter.outcome === 'defeat') run.stage = 'defeat';
  else if (run.current === 'boss') run.stage = 'victory';
  else { makeOffers(run); run.stage = 'reward'; }
}

function makeOffers(run: RunState): void {
  const ids = [...itemDefinitionIds()];
  const expansionIds = [...EXPANSION_ITEM_IDS];
  run.offers = [];
  for (let index = 0; index < 3; index++) {
    const roll = Math.max(0, Math.min(0.999999, run.random()));
    const pool = index === 0 ? expansionIds : ids;
    const [id] = pool.splice(Math.floor(roll * pool.length), 1);
    if (index === 0) ids.splice(ids.indexOf(id!), 1);
    run.offers.push(createItem(id!, `reward-${run.room}-${index}`, run.random));
  }
}

export function nextRoomChoices(run: RunState): RoomChoice[] {
  if (run.stage !== 'route') return [];
  const next = run.room + 1;
  if (next === 10) return [{ id: 'boss', kind: 'boss', label: 'Трон Последнего Архонта' }];
  if (next > 10) return [];
  const position = (next - 1) % 3;
  if (position === 0) return [
    { id: 'battle-0', kind: 'battle', label: 'Крысиные катакомбы', variant: 0 },
    next >= 7 ? { id: 'battle-1', kind: 'battle', label: 'Литейная автоматонов', variant: 2 } : { id: 'battle-1', kind: 'battle', label: 'Капище культистов', variant: 1 },
  ];
  const choices: RoomChoice[] = [
    next <= 3 ? { id: 'battle-0', kind: 'battle', label: 'Крысиные катакомбы', variant: 0 } : next <= 6 ? { id: 'battle-0', kind: 'battle', label: 'Капище культистов', variant: 1 } : { id: 'battle-0', kind: 'battle', label: 'Литейная автоматонов', variant: 2 },
    position === 1 ? { id: 'cache', kind: 'cache', label: 'Тайник звонаря' } : { id: 'workshop', kind: 'workshop', label: 'Часовая мастерская' },
  ];
  if (next === 5) choices.push({ id: 'event', kind: 'event', label: 'Лазарет забытого братства' });
  return choices;
}

export function openRoute(run: RunState): boolean {
  syncRun(run);
  if (run.stage !== 'cleared') return false;
  run.stage = 'route'; return true;
}

export function enterRoom(run: RunState, choiceId: string): boolean {
  const choice = nextRoomChoices(run).find(candidate => candidate.id === choiceId);
  if (!choice) return false;
  run.room++; run.current = choice.kind; run.roomLabel = choice.label; run.rewardClaimed = false; run.workshopCalmed = false; run.offers = [];
  run.encounter.phase = 'preparation'; run.encounter.outcome = 'ongoing'; run.encounter.commands.length = 0;
  if (choice.kind === 'battle' || choice.kind === 'boss') {
    setEnemies(run.encounter, enemiesFor(run.room, choice.variant ?? 0, choice.kind === 'boss'));
    run.stage = 'battle';
  } else if (choice.kind === 'cache') {
    makeOffers(run);
    run.stage = 'cache';
  } else run.stage = choice.kind === 'event' ? 'event' : 'workshop';
  return true;
}

export function claimReward(run: RunState, itemId: string): boolean {
  if ((run.stage !== 'cache' && run.stage !== 'reward') || run.rewardClaimed) return false;
  const item = run.offers.find(candidate => candidate.id === itemId);
  if (!item) return false;
  run.encounter.stash.push(item); run.offers = []; run.rewardClaimed = true; run.stage = 'cleared';
  return true;
}

export function windWorkshop(run: RunState): boolean {
  if (run.stage !== 'workshop') return false;
  for (const hero of run.encounter.heroes) if (hero.status === 'active' || hero.status === 'stopped') {
    hero.wind = hero.maxWind;
    if (hero.durability > 0) hero.status = 'active';
  }
  return true;
}

export function calmWorkshopItem(run: RunState, itemId: string): boolean {
  if (run.stage !== 'workshop' || run.workshopCalmed) return false;
  const item = [...run.encounter.stash, ...run.encounter.floor, ...run.encounter.heroes.flatMap(hero => hero.items)].find(candidate => candidate.id === itemId);
  if (!item || item.definitionId !== 'lantern' || item.calmed) return false;
  item.calmed = true; run.workshopCalmed = true; return true;
}

export function leaveWorkshop(run: RunState): boolean {
  if (run.stage !== 'workshop') return false;
  run.stage = 'cleared'; return true;
}

/** The infirmary offers one mutually exclusive benefit, once per visit. */
export function resolveInfirmary(run: RunState, choice: string): boolean {
  if (run.stage !== 'event' || (choice !== 'heal' && choice !== 'repair')) return false;
  for (const hero of run.encounter.heroes) {
    if (choice === 'heal' && hero.status === 'human') hero.hp = Math.min(hero.maxHp, hero.hp + 15);
    if (choice === 'repair' && (hero.status === 'stopped' || hero.status === 'active')) hero.durability = Math.min(hero.maxDurability, hero.durability + 15);
  }
  run.stage = 'cleared'; return true;
}
