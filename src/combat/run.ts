import { createItem, EXPANSION_ITEM_IDS, itemDefinitionIds } from './items.ts';
import { createActor, startBattle, type CombatItem, type Combatant, type EncounterState } from './simulation.ts';
import { COMBAT_CONFIG } from './config.ts';
import { canPlaceItem } from './inventory.ts';

export const RUN_ROOM_COUNT = 10;

export type RoomKind = 'battle' | 'cache' | 'workshop' | 'event' | 'boss';
export type RunStage = 'opening' | 'battle' | 'reward' | 'cleared' | 'route' | 'cache' | 'workshop' | 'event' | 'victory' | 'defeat';
export interface RoomChoice { id: string; kind: RoomKind; label: string; variant?: number }
type Offers = [CombatItem, CombatItem, CombatItem];
type RunProgress = { roomLabel: string } & (
  | { stage: 'opening'; current: 'battle' }
  | { stage: 'battle' | 'defeat'; current: 'battle' | 'boss' }
  | { stage: 'reward'; current: 'battle'; offers: Offers }
  | { stage: 'cache'; current: 'cache'; offers: Offers }
  | { stage: 'workshop'; current: 'workshop'; workshopCalmed: boolean }
  | { stage: 'event'; current: 'event' }
  | { stage: 'victory'; current: 'boss' }
  | { stage: 'cleared' | 'route'; current: RoomKind }
);

export class RunState {
  room = 1;
  private progress: RunProgress = { stage: 'opening', current: 'battle', roomLabel: 'Крысиные катакомбы' };
  constructor(public encounter: EncounterState, public random: () => number) {}
  get stage(): RunStage { return this.progress.stage; }
  get current(): RoomKind { return this.progress.current; }
  get roomLabel(): string { return this.progress.roomLabel; }
  get offers(): readonly CombatItem[] { return 'offers' in this.progress ? this.progress.offers : []; }
  get workshopCalmed(): boolean { return this.progress.stage === 'workshop' && this.progress.workshopCalmed; }
  transition(progress: RunProgress): void { this.progress = progress; }
}

function enemiesFor(room: number, variant: number, boss = false): Combatant[] {
  if (boss) {
    // The final encounter uses the same floor curve as ordinary enemies, with a steeper health slope.
    const roomsAfterOpening = Math.max(0, room - 1);
    const bossTier = Math.floor(roomsAfterOpening / 3);
    const leader = createActor(`room-${room}-boss`, 'Заводной архонт', 'enemy', 0, COMBAT_CONFIG.bossHealth + roomsAfterOpening * COMBAT_CONFIG.bossHealthPerRoom, 'lowest');
    leader.isBoss = true; leader.attackDamage = COMBAT_CONFIG.bossAttackDamage + bossTier;
    const bossCooldownReduction = COMBAT_CONFIG.enemyAttackCooldownReductionPerRoomMs + COMBAT_CONFIG.bossAttackCooldownBonusReductionPerRoomMs;
    leader.attackCooldownMs = leader.attackRemainingMs = Math.max(1800, COMBAT_CONFIG.enemyAttackCooldownMs + 500 - roomsAfterOpening * bossCooldownReduction); leader.reach = 'far';
    const guard = createActor(`room-${room}-guard`, 'Сломанный автоматон', 'enemy', 1, COMBAT_CONFIG.bossGuardHealth + roomsAfterOpening * COMBAT_CONFIG.bossGuardHealthPerRoom);
    guard.attackDamage = COMBAT_CONFIG.bossGuardAttackDamage + bossTier;
    guard.attackCooldownMs = guard.attackRemainingMs = Math.max(1800, COMBAT_CONFIG.enemyAttackCooldownMs + 800 - roomsAfterOpening * bossCooldownReduction);
    return [leader, guard];
  }
  const names = ['Чумная крыса', 'Культист', 'Сломанный автоматон'];
  const count = 4;
  return Array.from({ length: count }, (_, slot) => {
    const kind = Math.max(0, Math.min(names.length - 1, variant));
    // Health rises every room; damage tiers and faster attacks make later acts pressure the whole party.
    const roomProgress = room - 1;
    const health = COMBAT_CONFIG.enemyStartingHealth + roomProgress * COMBAT_CONFIG.enemyHealthPerRoom
      + roomProgress * roomProgress * COMBAT_CONFIG.enemyHealthAcceleration + kind * COMBAT_CONFIG.enemyHealthPerTier;
    const enemy = createActor(`room-${room}-enemy-${slot}`, names[kind], 'enemy', slot, health, kind === 1 ? 'lowest' : 'front');
    enemy.attackDamage = COMBAT_CONFIG.enemyStartingDamage + Math.floor(roomProgress / COMBAT_CONFIG.enemyDamageEveryRooms)
      + Math.floor(roomProgress * roomProgress / COMBAT_CONFIG.enemyDamageAccelerationDivisor) + (kind === 2 ? 1 : 0);
    enemy.attackCooldownMs = enemy.attackRemainingMs = Math.max(1600, COMBAT_CONFIG.enemyAttackCooldownMs - (room - 1) * COMBAT_CONFIG.enemyAttackCooldownReductionPerRoomMs + slot * COMBAT_CONFIG.enemyAttackStaggerMs);
    enemy.reach = kind === 1 ? 'far' : 'near';
    return enemy;
  });
}

function setEnemies(encounter: EncounterState, enemies: Combatant[]): void {
  encounter.enemies = enemies;
  encounter.outcome = 'ongoing'; encounter.phase = 'preparation'; encounter.commands.length = 0; encounter.elapsedMs = 0; encounter.combatEnraged = false;
}

/** The opening encounter is room one; all party and inventory objects remain owned by the encounter. */
export function createRun(encounter: EncounterState, random: () => number = Math.random): RunState {
  setEnemies(encounter, enemiesFor(1, 0));
  return new RunState(encounter, random);
}

/** Opens the first named encounter exactly once; later rooms use enterRoom directly. */
export function beginRun(run: RunState): boolean {
  if (run.stage !== 'opening' || run.encounter.phase !== 'preparation') return false;
  if (!startBattle(run.encounter)) return false;
  run.transition({ stage: 'battle', current: 'battle', roomLabel: run.roomLabel });
  return true;
}

export function syncRun(run: RunState): void {
  if (run.stage !== 'battle' || run.encounter.outcome === 'ongoing') return;
  if (run.current !== 'battle' && run.current !== 'boss') throw new Error('Invalid battle room');
  if (run.encounter.outcome === 'defeat') run.transition({ stage: 'defeat', current: run.current, roomLabel: run.roomLabel });
  else if (run.current === 'boss') run.transition({ stage: 'victory', current: 'boss', roomLabel: run.roomLabel });
  else run.transition({ stage: 'reward', current: 'battle', roomLabel: run.roomLabel, offers: makeOffers(run.room, run.random) });
}

function makeOffers(room: number, random: () => number): Offers {
  const ids = [...new Set(itemDefinitionIds())];
  const expansionIds = [...new Set(EXPANSION_ITEM_IDS)];
  if (ids.length < 3 || expansionIds.length === 0 || expansionIds.some(id => !ids.includes(id))) {
    throw new Error('Reward catalog must contain at least three distinct items and valid expansion items');
  }
  const offers: CombatItem[] = [];
  const checkedRandom = (): number => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Reward RNG must return a finite number in [0, 1)');
    return value;
  };
  for (let index = 0; index < 3; index++) {
    const roll = checkedRandom();
    const pool = index === 0 ? expansionIds : ids;
    const id = pool[Math.floor(roll * pool.length)];
    if (id === undefined) throw new Error('Reward catalog was exhausted');
    ids.splice(ids.indexOf(id), 1);
    offers.push(createItem(id, `reward-${room}-${index}`, checkedRandom));
  }
  const [first, second, third] = offers;
  if (!first || !second || !third) throw new Error('Reward catalog did not produce three items');
  return [first, second, third];
}

export function nextRoomChoices(run: RunState): RoomChoice[] {
  if (run.stage !== 'route') return [];
  const next = run.room + 1;
  if (next === RUN_ROOM_COUNT) return [{ id: 'boss', kind: 'boss', label: 'Трон Последнего Архонта' }];
  if (next > RUN_ROOM_COUNT) return [];
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
  run.transition({ stage: 'route', current: run.current, roomLabel: run.roomLabel }); return true;
}

export function enterRoom(run: RunState, choiceId: string): boolean {
  const choice = nextRoomChoices(run).find(candidate => candidate.id === choiceId);
  if (!choice) return false;
  const room = run.room + 1;
  const enemies = choice.kind === 'battle' || choice.kind === 'boss' ? enemiesFor(room, choice.variant ?? 0, choice.kind === 'boss') : undefined;
  const progress: RunProgress = choice.kind === 'battle' || choice.kind === 'boss'
    ? { stage: 'battle', current: choice.kind, roomLabel: choice.label }
    : choice.kind === 'cache'
      ? { stage: 'cache', current: 'cache', roomLabel: choice.label, offers: makeOffers(room, run.random) }
      : choice.kind === 'event'
        ? { stage: 'event', current: 'event', roomLabel: choice.label }
        : { stage: 'workshop', current: 'workshop', roomLabel: choice.label, workshopCalmed: false };
  run.encounter.floor.length = 0;
  run.encounter.stash.length = 0;
  run.room = room;
  run.encounter.phase = 'preparation'; run.encounter.outcome = 'ongoing'; run.encounter.commands.length = 0;
  if (enemies) {
    setEnemies(run.encounter, enemies);
    startBattle(run.encounter);
  }
  run.transition(progress);
  return true;
}

export function claimReward(run: RunState, itemId: string, destination?: { heroId: string; cell: number }): boolean {
  if (run.stage !== 'cache' && run.stage !== 'reward') return false;
  const item = run.offers.find(candidate => candidate.id === itemId);
  if (!item) return false;
  const hero = destination && run.encounter.heroes.find(candidate => candidate.id === destination.heroId);
  if (destination && (!hero || !canPlaceItem(run.encounter, item, destination.heroId, destination.cell))) return false;
  if (destination && hero) { item.cell = destination.cell; hero.items.push(item); }
  else run.encounter.floor.push(item);
  run.transition({ stage: 'cleared', current: run.current, roomLabel: run.roomLabel });
  return true;
}

export function windWorkshop(run: RunState): boolean {
  if (run.stage !== 'workshop') return false;
  for (const hero of run.encounter.heroes) if (hero.status === 'active' || hero.status === 'stopped') {
    hero.windUpCharge = hero.maxWindUp;
    if (hero.durability > 0) hero.status = 'active';
  }
  return true;
}

export function calmWorkshopItem(run: RunState, itemId: string): boolean {
  if (run.stage !== 'workshop' || run.workshopCalmed) return false;
  const item = [...run.encounter.stash, ...run.encounter.floor, ...run.encounter.heroes.flatMap(hero => hero.items)].find(candidate => candidate.id === itemId);
  if (!item || item.definitionId !== 'lantern' || item.calmed) return false;
  item.calmed = true;
  run.transition({ stage: 'workshop', current: 'workshop', roomLabel: run.roomLabel, workshopCalmed: true }); return true;
}

export function leaveWorkshop(run: RunState): boolean {
  if (run.stage !== 'workshop') return false;
  run.transition({ stage: 'cleared', current: 'workshop', roomLabel: run.roomLabel }); return true;
}

/** The infirmary offers one mutually exclusive benefit, once per visit. */
function infirmaryTargets(run: RunState, choice: 'heal' | 'repair') {
  return run.encounter.heroes.filter(hero => choice === 'heal'
    ? hero.status === 'human' && hero.hp < hero.maxHp
    : (hero.status === 'stopped' || hero.status === 'active') && hero.durability < hero.maxDurability);
}

export function canUseInfirmary(run: RunState, choice: 'heal' | 'repair'): boolean {
  return run.stage === 'event' && infirmaryTargets(run, choice).length > 0;
}

export function resolveInfirmary(run: RunState, choice: string): boolean {
  if (run.stage !== 'event') return false;
  if (choice === 'heal' || choice === 'repair') {
    const targets = infirmaryTargets(run, choice);
    if (!targets.length) return false;
    for (const hero of targets) {
      if (choice === 'heal') hero.hp = Math.min(hero.maxHp, hero.hp + 15);
      else hero.durability = Math.min(hero.maxDurability, hero.durability + 15);
    }
  } else if (choice !== 'leave' || canUseInfirmary(run, 'heal') || canUseInfirmary(run, 'repair')) {
    return false;
  }
  run.transition({ stage: 'cleared', current: 'event', roomLabel: run.roomLabel }); return true;
}
