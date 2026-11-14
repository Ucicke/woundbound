import { COMBAT_CONFIG } from './config.ts';
import { itemBonuses, moveItem } from './inventory.ts';

export type ActorStatus = 'human' | 'enemy' | 'rebirthing' | 'stopped' | 'active' | 'dead';
export type TargetPolicy = 'front' | 'lowest' | 'rear';
export type Reach = 'near' | 'far';
export type CombatRole = 'guard' | 'archer' | 'rogue' | 'mage' | 'enemy';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ItemClassAffinity = 'guard' | 'huntress' | 'pilgrim' | 'clockmaker';
export type ItemCategory = 'weapon' | 'protection' | 'jewelry' | 'relic' | 'tool' | 'consumable' | 'ammo';
export const HERO_ITEM_AFFINITIES: readonly ItemClassAffinity[] = ['guard', 'huntress', 'pilgrim', 'clockmaker'];
export interface ItemPassiveBonuses { armor?: number; damage?: number; cooldownFactor?: number; healing?: number; wind?: number }
export interface CombatItem { id: string; definitionId?: string; name: string; description?: string; rarity?: ItemRarity; rarityMultiplier?: number; classAffinity?: ItemClassAffinity; category?: ItemCategory; passiveBonuses?: ItemPassiveBonuses; damage: number; windAmount?: number; cooldownMs: number; remainingMs: number; targetPolicy: TargetPolicy; trigger: 'always' | 'ownerBelowHalf' | 'targetBelowHalf' | 'allyBelowHalf' | 'passive'; cell?: number; rotation?: number; reach?: Reach; shape?: readonly (readonly [number, number])[]; tags?: string[]; effect?: 'damage' | 'heal' | 'wind' | 'passive'; healTarget?: 'self' | 'lowest'; calmed?: boolean }
export interface Combatant {
  id: string; name: string; side: 'hero' | 'enemy'; slot: number;
  hp: number; maxHp: number; status: ActorStatus; items: CombatItem[];
  targetPolicy: TargetPolicy; attackDamage: number; attackCooldownMs: number; attackRemainingMs: number; reach?: Reach;
  durability: number; maxDurability: number; wind: number; maxWind: number; rebirthMs: number; isBoss?: boolean; role: CombatRole;
}
export interface CombatEvent { sequence?: number; kind: 'item' | 'enemy' | 'state' | 'wind'; actorId: string; sourceId: string; sourceName: string; targetId: string; targetName: string; amount: number; message: string; defeatedTarget?: boolean; transition?: 'rebirth' | 'permadeath' }
export interface EncounterState { heroes: Combatant[]; enemies: Combatant[]; enemy: Combatant; item: CombatItem | null; events: CombatEvent[]; nextEventSequence: number; floor: CombatItem[]; outcome: 'ongoing' | 'victory' | 'defeat'; commands: string[]; phase: 'preparation' | 'combat' | 'result'; stash: CombatItem[]; elapsedMs: number; bossEnraged: boolean }
export interface CombatClock { accumulator: number; interrupted?: boolean }

export function createActor(id: string, name: string, side: 'hero' | 'enemy', slot: number, hp: number, policy: TargetPolicy = 'front'): Combatant {
  const role: CombatRole = side === 'enemy' ? 'enemy' : id === 'hero-1' ? 'guard' : id === 'hero-2' ? 'archer' : id === 'hero-3' ? 'rogue' : 'mage';
  return { id, name, side, slot, hp, maxHp: hp, status: side === 'hero' ? 'human' : 'enemy', items: [], targetPolicy: policy, attackDamage: side === 'enemy' ? 6 : 0, attackCooldownMs: 1800, attackRemainingMs: 1800, durability: 100, maxDurability: 100, wind: 0, maxWind: 100, rebirthMs: 0, role };
}

/** Presentation reads intent only: combat targeting and damage never depend on Canvas coordinates. */
export function projectRoleIntent(actor: Combatant, target?: Combatant): { lane: 'front' | 'rear' | 'flank'; hidden: boolean; targetId?: string } {
  if (actor.side === 'enemy') return { lane: 'front', hidden: false };
  if (actor.role === 'rogue') return { lane: 'flank', hidden: actor.status === 'human' || actor.status === 'active', targetId: target?.id };
  return { lane: actor.role === 'guard' ? 'front' : 'rear', hidden: false, targetId: target?.id };
}

export function createState(heroes: Combatant[], enemies: Combatant[]): EncounterState {
  return { heroes, enemies, enemy: enemies[0], item: heroes[0]?.items[0] ?? null, events: [], nextEventSequence: 1, floor: [], outcome: 'ongoing', commands: [], phase: 'combat', stash: [], elapsedMs: 0, bossEnraged: false };
}

/** Prepare a fresh encounter without discarding item identities or cooldowns. */
export function prepareEncounter(state: EncounterState): void {
  state.phase = 'preparation';
  for (const hero of state.heroes) hero.items.forEach((item, index) => { item.cell ??= index; });
  state.item = state.heroes[0]?.items[0] ?? null;
}

export function placeStashItem(state: EncounterState, itemId: string, heroId: string, cell: number): boolean {
  return state.phase === 'preparation' && state.stash.some(item => item.id === itemId) && moveItem(state, itemId, heroId, cell);
}

export function startBattle(state: EncounterState): boolean {
  if (state.phase !== 'preparation' || state.outcome !== 'ongoing') return false;
  state.phase = 'combat';
  return true;
}

export function swapHeroPositions(state: EncounterState, firstSlot: number, secondSlot: number): boolean {
  if (state.phase !== 'preparation' || firstSlot === secondSlot) return false;
  const first = state.heroes.find(hero => hero.slot === firstSlot);
  const second = state.heroes.find(hero => hero.slot === secondSlot);
  if (!first || !second) return false;
  first.slot = secondSlot;
  second.slot = firstSlot;
  state.heroes.sort((a, b) => a.slot - b.slot);
  return true;
}

export function createEncounter(equipped = true): EncounterState {
  const hero = createActor('hero-1', 'Герой', 'hero', 0, 100);
  if (equipped) hero.items.push({ id: 'blade', name: 'Клинок', damage: 6, cooldownMs: 1000, remainingMs: 1000, targetPolicy: 'front', trigger: 'always' });
  const enemy = createActor('rat', 'Крыса', 'enemy', 0, 120);
  enemy.attackDamage = 0;
  return createState([hero], [enemy]);
}

function reachable(actors: Combatant[], slot: number, reach: Reach, rank: (actor: Combatant) => number = actor => actor.slot): Combatant[] {
  if (reach === 'far') return actors;
  const front = [...actors].sort((a, b) => rank(a) - rank(b))[0];
  return front ? [front] : [];
}

export function chooseHeroTarget(heroes: Combatant[], policy: TargetPolicy, slot = 0, reach: Reach = 'far'): Combatant | undefined {
  const targetable = heroes.filter(actor => actor.status === 'human' || actor.status === 'stopped' || actor.status === 'active');
  const living = targetable.filter(actor => actor.status === 'human');
  const alive = living.length ? living : targetable;
  const health = (actor: Combatant): number => actor.status === 'human' ? actor.hp : actor.durability;
  const rank = (actor: Combatant): number => ({ 'hero-1': 0, 'hero-3': 1, 'hero-2': 2, 'hero-4': 3 } as Record<string, number>)[actor.id] ?? actor.slot;
  return reachable(alive, slot, reach, rank).sort((a, b) => policy === 'lowest' ? health(a) - health(b) || rank(a) - rank(b) : policy === 'rear' ? rank(b) - rank(a) : rank(a) - rank(b))[0];
}

export function chooseEnemyTarget(enemies: Combatant[], policy: TargetPolicy, slot = 0, reach: Reach = 'far'): Combatant | undefined {
  const alive = enemies.filter(actor => actor.status === 'enemy' && actor.hp > 0);
  return reachable(alive, slot, reach).sort((a, b) => policy === 'lowest' ? a.hp - b.hp || a.slot - b.slot : policy === 'rear' ? b.slot - a.slot : a.slot - b.slot)[0];
}

/** Shared by combat and the interface so the explanation follows real rules. */
export function evaluateItem(state: EncounterState, hero: Combatant, item: CombatItem): { target?: Combatant; reason?: string } {
  if (item.trigger === 'passive' || item.effect === 'passive') return { reason: 'Пассивное свойство' };
  if (hero.status !== 'human' && hero.status !== 'active') return { reason: 'Владелец не действует' };
  if (item.trigger === 'ownerBelowHalf' && (hero.status === 'human' ? hero.hp / hero.maxHp : hero.durability / hero.maxDurability) >= 0.5) return { reason: 'Владелец должен быть ранен ниже половины' };
  let target: Combatant | undefined;
  if (item.effect === 'wind') {
    target = state.heroes.filter(candidate => (candidate.status === 'active' || candidate.status === 'stopped') && candidate.wind < candidate.maxWind)
      .sort((a, b) => a.wind / a.maxWind - b.wind / b.maxWind || a.slot - b.slot)[0];
    if (!target) return { reason: 'Нет куклы, которой нужен завод' };
  } else if (item.effect === 'heal') {
    const injured = state.heroes.filter(candidate => candidate.status === 'human' && candidate.hp < candidate.maxHp && (item.trigger !== 'allyBelowHalf' || candidate.hp / candidate.maxHp < 0.5));
    target = item.healTarget === 'self' ? injured.find(candidate => candidate.id === hero.id) : injured.sort((a, b) => a.hp - b.hp || a.slot - b.slot)[0];
    if (!target) return { reason: item.trigger === 'allyBelowHalf' ? 'Нет человека с критическим ранением' : 'Нет раненого человека' };
  } else {
    target = chooseEnemyTarget(state.enemies, item.targetPolicy, hero.slot, item.reach);
    if (!target) return { reason: 'Нет доступной цели' };
    if (item.trigger === 'targetBelowHalf' && target.hp / target.maxHp >= 0.5) return { target, reason: 'Цель должна быть ранена ниже половины' };
  }
  return { target };
}

function record(state: EncounterState, event: CombatEvent): void {
  event.sequence = state.nextEventSequence++;
  state.events.push(event);
  if (state.events.length > 50) state.events.shift();
}

export function partyCanContinue(state: EncounterState): boolean {
  return state.heroes.some(hero => hero.status === 'human' || hero.status === 'active' || hero.status === 'rebirthing');
}

function resolveOutcome(state: EncounterState): void {
  if (state.outcome !== 'ongoing') return;
  if (state.enemies.some(enemy => enemy.isBoss && enemy.status === 'dead') || (state.enemies.length > 0 && state.enemies.every(enemy => enemy.status === 'dead'))) state.outcome = 'victory';
  else if (state.heroes.length > 0 && !partyCanContinue(state)) state.outcome = 'defeat';
  if (state.outcome !== 'ongoing') { state.commands.length = 0; state.phase = 'result'; }
}

export function queueWinding(state: EncounterState, actorId: string): void {
  const doll = state.heroes.find(hero => hero.id === actorId);
  const hasWinder = state.heroes.some(hero => hero.status === 'human' || hero.status === 'active');
  if (state.phase === 'combat' && state.outcome === 'ongoing' && doll?.status === 'stopped' && doll.durability > 0 && hasWinder) state.commands.push(actorId);
}

export function applyEffect(state: EncounterState, targetId: string, kind: 'damage' | 'heal' | 'poison' | 'bleeding' | 'fear' | 'wind', amount: number): boolean {
  const target = [...state.heroes, ...state.enemies].find(actor => actor.id === targetId);
  if (!target || target.status === 'dead' || target.status === 'rebirthing' || state.outcome !== 'ongoing') return false;
  const isDoll = target.status === 'stopped' || target.status === 'active';
  if (kind === 'wind') {
    if (!isDoll) return false;
    target.wind = Math.min(target.maxWind, target.wind + Math.max(0, amount));
    if (target.wind >= target.maxWind && target.durability > 0) target.status = 'active';
    return true;
  }
  if (isDoll && kind !== 'damage') return false;
  if (kind === 'heal') { target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount)); return true; }
  if (kind !== 'damage') return true;
  const ownerAffinity = target.side === 'hero' ? HERO_ITEM_AFFINITIES[target.slot] : undefined;
  const armor = target.side === 'hero' ? Math.min(3, Math.round(target.items.reduce((sum, item) => sum + (item.passiveBonuses?.armor ?? 0) * (item.classAffinity === ownerAffinity ? COMBAT_CONFIG.classAffinityMultiplier : 1), 0))) : 0;
  const damage = Math.max(1, amount - armor);
  if (isDoll) {
    target.durability = Math.max(0, target.durability - damage);
    target.wind = Math.max(0, target.wind - damage);
    if (target.durability === 0) {
      target.status = 'dead';
      for (const item of target.items.splice(0)) { delete item.cell; state.floor.push(item); }
      state.item = state.heroes[0]?.items[0] ?? null;
      record(state, { kind: 'state', actorId: target.id, sourceId: target.id, sourceName: target.name, targetId: target.id, targetName: target.name, amount: 0, transition: 'permadeath', message: `${target.name}: окончательная гибель` });
      resolveOutcome(state);
    } else if (target.wind === 0) target.status = 'stopped';
    return true;
  }
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp === 0 && target.side === 'hero') {
    target.status = 'rebirthing';
    target.rebirthMs = COMBAT_CONFIG.rebirthMs;
    for (const item of target.items) item.remainingMs = item.cooldownMs;
    record(state, { kind: 'state', actorId: target.id, sourceId: target.id, sourceName: target.name, targetId: target.id, targetName: target.name, amount: 0, transition: 'rebirth', message: `${target.name}: перерождение` });
  } else if (target.hp === 0) { target.status = 'dead'; resolveOutcome(state); }
  return true;
}

export function stepEncounter(state: EncounterState, deltaMs: number): void {
  if (state.phase !== 'combat' || state.outcome !== 'ongoing') return;
  state.elapsedMs += deltaMs;
  const boss = state.enemies.find(enemy => enemy.isBoss);
  if (boss && !state.bossEnraged && state.elapsedMs >= COMBAT_CONFIG.bossEnrageMs) {
    state.bossEnraged = true;
    record(state, { kind: 'state', actorId: boss.id, sourceId: boss.id, sourceName: boss.name, targetId: boss.id, targetName: boss.name, amount: 0, message: `${boss.name} входит в ярость` });
  }
  for (const hero of state.heroes) {
    if (hero.status === 'rebirthing') {
      hero.rebirthMs = Math.max(0, hero.rebirthMs - deltaMs);
      if (hero.rebirthMs === 0) { hero.status = 'stopped'; hero.durability = hero.maxDurability = COMBAT_CONFIG.dollDurability; hero.wind = 0; hero.maxWind = COMBAT_CONFIG.maxWind; }
    } else if (hero.status === 'active') {
      hero.wind = Math.max(0, hero.wind - COMBAT_CONFIG.windPerSecond * deltaMs / 1000);
      if (hero.wind === 0) hero.status = 'stopped';
    }
  }
  for (const hero of [...state.heroes].sort((a, b) => a.slot - b.slot)) {
    if (hero.status !== 'human' && hero.status !== 'active') continue;
    for (const item of hero.items) {
      if (item.trigger === 'passive' || item.effect === 'passive') continue;
      item.remainingMs = Math.max(0, item.remainingMs - deltaMs);
      if (item.remainingMs > 0) continue;
      const { target, reason } = evaluateItem(state, hero, item);
      if (!target || reason) continue;
      const healthBefore = target.hp, windBefore = target.wind;
      const bonuses = itemBonuses(item, hero.items, HERO_ITEM_AFFINITIES[hero.slot]);
      const healing = item.effect === 'heal';
      const winding = item.effect === 'wind';
      const actionAmount = Math.round((winding ? (item.windAmount ?? item.damage) + bonuses.wind
        : healing ? item.damage + bonuses.healing
        : item.damage + bonuses.damage) * (item.classAffinity === HERO_ITEM_AFFINITIES[hero.slot] ? COMBAT_CONFIG.classAffinityMultiplier : 1));
      applyEffect(state, target.id, winding ? 'wind' : healing ? 'heal' : 'damage', actionAmount);
      const dealt = healing ? target.hp - healthBefore : winding ? target.wind - windBefore : healthBefore - target.hp;
      record(state, { kind: 'item', actorId: hero.id, sourceId: item.id, sourceName: item.name, targetId: target.id, targetName: target.name, amount: dealt,
        defeatedTarget: !healing && !winding && target.side === 'enemy' && target.status === 'dead',
        message: `${item.name} → ${target.name}: ${dealt} ${healing ? 'лечения' : winding ? 'завода' : 'урона'}` });
      item.remainingMs = item.cooldownMs * bonuses.cooldownFactor;
      if (state.outcome !== 'ongoing') return;
    }
  }
  for (const enemy of [...state.enemies].sort((a, b) => a.slot - b.slot)) {
    if (enemy.status !== 'enemy' || enemy.attackDamage <= 0) continue;
    enemy.attackRemainingMs = Math.max(0, enemy.attackRemainingMs - deltaMs);
    if (enemy.attackRemainingMs > 0) continue;
    const target = chooseHeroTarget(state.heroes, enemy.targetPolicy, enemy.slot, enemy.reach);
    if (!target) continue;
    const isDoll = target.status === 'stopped' || target.status === 'active';
    const healthBefore = isDoll ? target.durability : target.hp;
    const attackDamage = enemy.attackDamage + (enemy.isBoss && state.bossEnraged ? COMBAT_CONFIG.bossEnrageDamage : 0);
    applyEffect(state, target.id, 'damage', attackDamage);
    const dealt = healthBefore - (isDoll ? target.durability : target.hp);
    record(state, { kind: 'enemy', actorId: enemy.id, sourceId: enemy.id, sourceName: enemy.name, targetId: target.id, targetName: target.name, amount: dealt, message: `${enemy.name} → ${target.name}: ${dealt} урона` });
    enemy.attackRemainingMs = enemy.attackCooldownMs;
    if (state.outcome !== 'ongoing') return;
  }
  for (const actorId of state.commands.splice(0)) {
    const doll = state.heroes.find(hero => hero.id === actorId);
    if (!doll || doll.status !== 'stopped' || doll.durability <= 0) continue;
    const previousWind = doll.wind;
    doll.wind = Math.min(doll.maxWind, doll.wind + doll.maxWind / COMBAT_CONFIG.clicksToFull);
    const winder = state.heroes.find(hero => hero.status === 'human' || hero.status === 'active');
    if (!winder) continue;
    record(state, { kind: 'wind', actorId: winder.id, sourceId: winder.id, sourceName: winder.name, targetId: doll.id, targetName: doll.name, amount: doll.wind - previousWind, message: `${winder.name} заводит ${doll.name}` });
    if (doll.wind >= doll.maxWind) doll.status = 'active';
  }
  resolveOutcome(state);
}

export function projectEncounter(state: EncounterState): { enemyHp: number; cooldown: number; events: string[] } {
  return { enemyHp: state.enemy.hp, cooldown: state.item?.remainingMs ?? 0, events: state.events.map(event => event.message) };
}

export function projectAction(event: CombatEvent): { actorId: string; sourceId: string; targetId: string; text: string } {
  return { actorId: event.actorId, sourceId: event.sourceId, targetId: event.targetId, text: event.message };
}

export function projectHero(hero: Combatant): { durability: number; wind: number; cooldownMs: number; rebirthSeconds: number } {
  return { durability: hero.durability, wind: hero.wind, cooldownMs: hero.items[0]?.remainingMs ?? 0, rebirthSeconds: hero.rebirthMs / 1000 };
}

export function advanceClock(clock: CombatClock, deltaMs: number, visible: boolean, focused: boolean): number {
  if (!visible || !focused) { clock.accumulator = 0; clock.interrupted = true; return 0; }
  if (clock.interrupted) { clock.accumulator = 0; clock.interrupted = false; return 0; }
  clock.accumulator += Math.max(0, deltaMs);
  const steps = Math.floor(clock.accumulator / 50);
  clock.accumulator -= steps * 50;
  return steps;
}

