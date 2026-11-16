import { COMBAT_CONFIG } from './config.ts';
import { areAdjacent, itemBonuses, moveItem } from './inventory.ts';
import { defaultPuppetForm, getPuppetForm, getPuppetItemRules, getPuppetWindDrain, PUPPET_RULES, registerPuppetItemTrigger, type HeroClass, type PuppetBranch, type PuppetFormId, type PuppetPassiveState } from './puppets.ts';

export type ActorStatus = 'human' | 'enemy' | 'rebirthing' | 'stopped' | 'active' | 'dead';
export type TargetPolicy = 'front' | 'lowest' | 'rear';
export type Reach = 'near' | 'far';
export type CombatRole = 'guard' | 'archer' | 'support' | 'mechanic' | 'enemy';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ItemClassAffinity = HeroClass;
export type ItemCategory = 'weapon' | 'protection' | 'jewelry' | 'relic' | 'tool' | 'consumable' | 'ammo';
export const HERO_ITEM_AFFINITIES: readonly ItemClassAffinity[] = ['guard', 'huntress', 'pilgrim', 'clockmaker'];
const CLASS_ROLES: Record<HeroClass, CombatRole> = { guard: 'guard', huntress: 'archer', pilgrim: 'support', clockmaker: 'mechanic' };
export interface ItemPassiveBonuses { armor?: number; damage?: number; damageReach?: Reach; cooldownFactor?: number; healing?: number; wind?: number }
export interface HeroAttributes { strength: number; dexterity: number; constitution: number; intellect: number; wisdom: number; presence: number }
const CLASS_ATTRIBUTES: Record<HeroClass, HeroAttributes> = {
  guard: { strength: 16, dexterity: 10, constitution: 14, intellect: 10, wisdom: 10, presence: 10 },
  huntress: { strength: 12, dexterity: 16, constitution: 10, intellect: 10, wisdom: 12, presence: 10 },
  pilgrim: { strength: 10, dexterity: 10, constitution: 12, intellect: 10, wisdom: 16, presence: 14 },
  clockmaker: { strength: 10, dexterity: 14, constitution: 10, intellect: 16, wisdom: 10, presence: 12 },
};
export const attributeModifier = (score: number): number => Math.floor((score - 10) / 2);
export function itemAttributeFactor(hero: Combatant, item: CombatItem): number {
  if (hero.side !== 'hero') return 1;
  const stats = hero.attributes;
  const score = item.effect === 'heal' ? stats.wisdom : item.effect === 'wind' ? stats.presence : item.category === 'weapon' || item.category === 'ammo' ? stats.strength : stats.intellect;
  return 1 + attributeModifier(score) * .05;
}
export function attributeCooldownFactor(hero: Combatant): number { return 1 - attributeModifier(hero.attributes.dexterity) * .02; }
export interface CombatItem { id: string; definitionId?: string; name: string; description?: string; rarity?: ItemRarity; rarityMultiplier?: number; classAffinity?: ItemClassAffinity; category?: ItemCategory; damageType?: 'physical' | 'fire' | 'arcane'; passiveBonuses?: ItemPassiveBonuses; damage: number; windAmount?: number; cooldownMs: number; remainingMs: number; targetPolicy: TargetPolicy; trigger: 'always' | 'ownerBelowHalf' | 'targetBelowHalf' | 'allyBelowHalf' | 'passive'; cell?: number; rotation?: number; reach?: Reach; shape?: readonly (readonly [number, number])[]; tags?: string[]; effect?: 'damage' | 'heal' | 'wind' | 'passive'; healTarget?: 'self' | 'lowest'; calmed?: boolean }
export interface Combatant {
  id: string; name: string; side: 'hero' | 'enemy'; slot: number;
  hp: number; maxHp: number; status: ActorStatus; items: CombatItem[];
  attributes: HeroAttributes;
  targetPolicy: TargetPolicy; attackDamage: number; attackCooldownMs: number; attackRemainingMs: number; reach?: Reach;
  durability: number; maxDurability: number; windUpCharge: number; maxWindUp: number; rebirthMs: number; isBoss?: boolean; role: CombatRole;
  heroClass?: HeroClass; isPuppet: boolean; puppetBranch: PuppetBranch | null; puppetFormId: PuppetFormId | null;
  pendingPuppetFormId: PuppetFormId | null; puppetPassiveState: PuppetPassiveState;
}
export interface CombatEvent { sequence?: number; kind: 'item' | 'enemy' | 'state' | 'wind'; actorId: string; sourceId: string; sourceName: string; targetId: string; targetName: string; amount: number; message: string; defeatedTarget?: boolean; transition?: 'rebirth' | 'puppet' | 'permadeath'; droppedItems?: Array<{ id: string; cell: number }> }
export interface EncounterState { heroes: Combatant[]; enemies: Combatant[]; events: CombatEvent[]; nextEventSequence: number; floor: CombatItem[]; outcome: 'ongoing' | 'victory' | 'defeat'; commands: string[]; phase: 'preparation' | 'combat' | 'result'; stash: CombatItem[]; elapsedMs: number; bossEnraged: boolean; combatEnraged: boolean; windRandomState: number }
export interface CombatClock { accumulator: number; interrupted?: boolean }

export function createActor(id: string, name: string, side: 'hero' | 'enemy', slot: number, hp: number, policy: TargetPolicy = 'front'): Combatant {
  const heroClass = side === 'hero' ? HERO_ITEM_AFFINITIES[slot] ?? 'guard' : undefined;
  const role: CombatRole = heroClass ? CLASS_ROLES[heroClass] : 'enemy';
  return { id, name, side, slot, hp, maxHp: hp, status: side === 'hero' ? 'human' : 'enemy', items: [], targetPolicy: policy, attackDamage: side === 'enemy' ? 6 : 0, attackCooldownMs: 1800, attackRemainingMs: 1800, durability: 100, maxDurability: 100, windUpCharge: 0, maxWindUp: COMBAT_CONFIG.maxWind, rebirthMs: 0, role,
    attributes: { ...(heroClass ? CLASS_ATTRIBUTES[heroClass] : { strength: 10, dexterity: 10, constitution: 10, intellect: 10, wisdom: 10, presence: 10 }) }, heroClass, isPuppet: false, puppetBranch: null, puppetFormId: null, pendingPuppetFormId: heroClass ? defaultPuppetForm(heroClass).id : null,
    puppetPassiveState: { itemActivations: 0, mechanicalActivations: 0, hitsTaken: 0, repeatedTargetId: null, repeatedTargetCount: 0 } };
}

export function heroClassForActor(actor: Combatant): ItemClassAffinity | undefined {
  return actor.side === 'hero' ? actor.heroClass ?? HERO_ITEM_AFFINITIES[actor.slot] : undefined;
}

export function transformHeroToPuppet(hero: Combatant, formId: PuppetFormId | null = hero.pendingPuppetFormId): boolean {
  const form = getPuppetForm(formId);
  if (!form || hero.side !== 'hero' || hero.status !== 'rebirthing' || form.heroClass !== heroClassForActor(hero)) return false;
  hero.heroClass = form.heroClass;
  hero.isPuppet = true;
  hero.puppetBranch = form.branch;
  hero.puppetFormId = form.id;
  hero.pendingPuppetFormId = null;
  hero.maxDurability = hero.durability = form.maxDurability;
  hero.maxWindUp = form.maxWindUp;
  hero.windUpCharge = 0;
  hero.puppetPassiveState = { itemActivations: 0, mechanicalActivations: 0, hitsTaken: 0, repeatedTargetId: null, repeatedTargetCount: 0 };
  hero.status = 'stopped';
  return true;
}

/** Presentation reads intent only: combat targeting and damage never depend on Canvas coordinates. */
export function projectRoleIntent(actor: Combatant, target?: Combatant): { lane: 'front' | 'rear'; hidden: boolean; targetId?: string } {
  if (actor.side === 'enemy') return { lane: 'front', hidden: false };
  return { lane: actor.role === 'guard' ? 'front' : 'rear', hidden: false, targetId: target?.id };
}

export function createState(heroes: Combatant[], enemies: Combatant[], windRandomSeed = Math.floor(Math.random() * 0x1_0000_0000)): EncounterState {
  if (!enemies.length) throw new Error('An encounter requires at least one enemy');
  if (heroes.some(hero => hero.side !== 'hero' || hero.status === 'enemy') ||
      enemies.some(enemy => enemy.side !== 'enemy' || (enemy.status !== 'enemy' && enemy.status !== 'dead') || enemy.isPuppet)) {
    throw new Error('Encounter contains combatants on the wrong side');
  }
  for (const hero of heroes) {
    const puppetStatus = hero.status === 'active' || hero.status === 'stopped';
    const form = getPuppetForm(hero.puppetFormId);
    if ((puppetStatus && !hero.isPuppet) || (hero.isPuppet && (!form || form.heroClass !== heroClassForActor(hero) || form.branch !== hero.puppetBranch)) ||
        (hero.isPuppet && (hero.status === 'human' || hero.status === 'rebirthing')) || (!hero.isPuppet && (hero.puppetFormId !== null || hero.puppetBranch !== null))) {
      throw new Error(`Inconsistent puppet state for ${hero.id}`);
    }
  }
  return { heroes, enemies, events: [], nextEventSequence: 1, floor: [], outcome: 'ongoing', commands: [], phase: 'combat', stash: [], elapsedMs: 0, bossEnraged: false, combatEnraged: false, windRandomState: windRandomSeed >>> 0 || 0x6d2b79f5 };
}

/** Prepare a fresh encounter without discarding item identities or cooldowns. */
export function prepareEncounter(state: EncounterState): void {
  state.phase = 'preparation';
  for (const hero of state.heroes) hero.items.forEach((item, index) => { item.cell ??= index; });
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
  // A functioning guard holds the frontline; a stopped doll cannot intercept living allies.
  const activeGuard = targetable.find(actor => actor.role === 'guard' && actor.status === 'active');
  const humans = targetable.filter(actor => actor.status === 'human');
  const candidates = reach === 'near' && activeGuard ? [activeGuard] : humans.length && reach === 'near' ? humans : targetable;
  const health = (actor: Combatant): number => actor.status === 'human' ? actor.hp : actor.durability;
  const rank = (actor: Combatant): number => ({ guard: 0, support: 1, archer: 2, mechanic: 3, enemy: 4 })[actor.role] * 10 + actor.slot;
  return reachable(candidates, slot, reach, rank).sort((a, b) => policy === 'lowest' ? health(a) - health(b) || rank(a) - rank(b) : policy === 'rear' ? rank(b) - rank(a) : rank(a) - rank(b))[0];
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
    target = state.heroes.filter(candidate => (candidate.status === 'active' || candidate.status === 'stopped') && candidate.windUpCharge < candidate.maxWindUp)
      .sort((a, b) => a.windUpCharge / a.maxWindUp - b.windUpCharge / b.maxWindUp || a.slot - b.slot)[0];
    if (!target) return { reason: 'Нет куклы, которой нужен завод' };
  } else if (item.effect === 'heal') {
    const ratio = (candidate: Combatant): number => candidate.status === 'human' ? candidate.hp / candidate.maxHp : candidate.durability / candidate.maxDurability;
    const injured = state.heroes.filter(candidate => (candidate.status === 'human' || candidate.status === 'active' || candidate.status === 'stopped') && ratio(candidate) < 1 && (item.trigger !== 'allyBelowHalf' || ratio(candidate) < 0.5));
    target = item.healTarget === 'self' ? injured.find(candidate => candidate.id === hero.id) : injured.sort((a, b) => ratio(a) - ratio(b) || a.slot - b.slot)[0];
    if (!target) return { reason: item.trigger === 'allyBelowHalf' ? 'Нет союзника с критическим повреждением' : 'Нет раненого союзника' };
  } else {
    const targetPolicy = hero.isPuppet && getPuppetForm(hero.puppetFormId)?.passiveId === 'fate-streak' ? 'lowest' : item.targetPolicy;
    target = chooseEnemyTarget(state.enemies, targetPolicy, hero.slot, item.reach);
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
  return state.heroes.some(hero => hero.status !== 'dead');
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

function rollManualWindAmount(state: EncounterState, doll: Combatant): number {
  let random = state.windRandomState || 0x6d2b79f5;
  random ^= random << 13;
  random ^= random >>> 17;
  random ^= random << 5;
  state.windRandomState = random >>> 0;
  const roll = 5 + state.windRandomState % 16;
  return getPuppetForm(doll.puppetFormId)?.passiveId === 'penitent-winding' ? Math.round(roll * (1 + PUPPET_RULES.penitentWindBonus)) : roll;
}

export const MAX_ARMOR = 8;
export function heroArmor(target: Combatant): number {
  if (target.side !== 'hero') return 0;
  const affinity = heroClassForActor(target);
  const equipment = Math.round(target.items.reduce((sum, item) => sum + (item.passiveBonuses?.armor ?? 0) * (affinity && item.classAffinity === affinity ? COMBAT_CONFIG.classAffinityMultiplier : 1), 0));
  return Math.max(0, Math.min(MAX_ARMOR, equipment + (target.isPuppet ? getPuppetForm(target.puppetFormId)?.armor ?? 0 : 0) + attributeModifier(target.attributes.constitution)));
}

function dropDeadHeroItems(state: EncounterState, hero: Combatant): Array<{ id: string; cell: number }> {
  const dropped = hero.items.map(item => ({ id: item.id, cell: item.cell ?? 0 }));
  for (const item of hero.items.splice(0)) { delete item.cell; state.floor.push(item); }
  return dropped;
}

export function applyEffect(state: EncounterState, targetId: string, kind: 'damage' | 'heal' | 'poison' | 'bleeding' | 'fear' | 'wind', amount: number): boolean {
  const target = [...state.heroes, ...state.enemies].find(actor => actor.id === targetId);
  if (!target || target.status === 'dead' || target.status === 'rebirthing' || state.outcome !== 'ongoing') return false;
  const isDoll = target.status === 'stopped' || target.status === 'active';
  if (kind === 'wind') {
    if (!isDoll) return false;
    target.windUpCharge = Math.min(target.maxWindUp, target.windUpCharge + Math.max(0, amount));
    if (target.windUpCharge >= target.maxWindUp && target.durability > 0) target.status = 'active';
    return true;
  }
  if (kind === 'heal') {
    if (isDoll) target.durability = Math.min(target.maxDurability, target.durability + Math.max(0, amount));
    else target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount));
    return true;
  }
  if (kind !== 'damage') return false;
  const form = target.isPuppet ? getPuppetForm(target.puppetFormId) : undefined;
  const armor = heroArmor(target);
  const damage = Math.max(1, Math.round(Math.max(0, amount - armor) * (isDoll ? form?.damageTakenMultiplier ?? 1 : 1)));
  if (isDoll) {
    target.durability = Math.max(0, target.durability - damage);
    target.windUpCharge = Math.max(0, target.windUpCharge - damage);
    if (target.durability === 0) {
      target.status = 'dead';
      target.windUpCharge = 0;
      const droppedItems = dropDeadHeroItems(state, target);
      record(state, { kind: 'state', actorId: target.id, sourceId: target.id, sourceName: target.name, targetId: target.id, targetName: target.name, amount: 0, transition: 'permadeath', droppedItems, message: `${target.name}: окончательная гибель` });
      resolveOutcome(state);
    } else {
      if (form?.passiveId === 'bastion-counterwind') {
        target.puppetPassiveState.hitsTaken++;
        if (target.puppetPassiveState.hitsTaken % PUPPET_RULES.bastionEveryHits === 0) target.windUpCharge = Math.min(target.maxWindUp, target.windUpCharge + PUPPET_RULES.bastionWindRefund);
      }
      if (target.windUpCharge === 0) target.status = 'stopped';
      else if (target.windUpCharge >= target.maxWindUp) target.status = 'active';
    }
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

function advanceRebirth(state: EncounterState, deltaMs: number): void {
  for (const hero of state.heroes) {
    if (hero.status !== 'rebirthing') continue;
    hero.rebirthMs = Math.max(0, hero.rebirthMs - Math.max(0, deltaMs));
    if (hero.rebirthMs === 0 && transformHeroToPuppet(hero)) {
      const form = getPuppetForm(hero.puppetFormId)!;
      record(state, { kind: 'state', actorId: hero.id, sourceId: hero.id, sourceName: form.name, targetId: hero.id, targetName: hero.name, amount: 0, transition: 'puppet', message: `${hero.name} перерождается: ${form.name}` });
    }
  }
}

function advanceEnrage(state: EncounterState, deltaMs: number): void {
  state.elapsedMs += deltaMs;
  const boss = state.enemies.find(enemy => enemy.isBoss);
  if (!boss && !state.combatEnraged && state.elapsedMs >= COMBAT_CONFIG.combatEnrageMs) {
    state.combatEnraged = true;
    const first = state.enemies[0];
    if (first) record(state, { kind: 'state', actorId: first.id, sourceId: first.id, sourceName: first.name, targetId: first.id, targetName: first.name, amount: 0, message: 'Враги входят в ярость' });
  }
  if (boss && !state.bossEnraged && state.elapsedMs >= COMBAT_CONFIG.bossEnrageMs) {
    state.bossEnraged = true;
    record(state, { kind: 'state', actorId: boss.id, sourceId: boss.id, sourceName: boss.name, targetId: boss.id, targetName: boss.name, amount: 0, message: `${boss.name} входит в ярость` });
  }
}

function drainPuppetWind(state: EncounterState, deltaMs: number): void {
  for (const hero of state.heroes) {
    if (hero.status === 'active') {
      hero.windUpCharge = Math.max(0, hero.windUpCharge - getPuppetWindDrain(hero) * deltaMs / 1000);
      if (hero.windUpCharge === 0) hero.status = 'stopped';
    }
  }
}

function advanceItems(state: EncounterState, deltaMs: number): void {
  for (const hero of [...state.heroes].sort((a, b) => a.slot - b.slot)) {
    if (hero.status !== 'human' && hero.status !== 'active') continue;
    for (const item of hero.items) {
      if (item.trigger === 'passive' || item.effect === 'passive') continue;
      item.remainingMs = Math.max(0, item.remainingMs - deltaMs);
      if (item.remainingMs > 0) continue;
      const { target, reason } = evaluateItem(state, hero, item);
      if (!target || reason) continue;
      const healthBefore = target.hp, durabilityBefore = target.durability, windBefore = target.windUpCharge;
      const affinity = heroClassForActor(hero);
      const bonuses = itemBonuses(item, hero.items, affinity);
      const puppetRules = getPuppetItemRules(hero, item, target.id);
      const healing = item.effect === 'heal';
      const winding = item.effect === 'wind';
      const actionAmount = Math.round((winding ? (item.windAmount ?? item.damage) + bonuses.wind
        : healing ? item.damage + bonuses.healing
        : item.damage + bonuses.damage) * (affinity && item.classAffinity === affinity ? COMBAT_CONFIG.classAffinityMultiplier : 1) * puppetRules.outputMultiplier * itemAttributeFactor(hero, item));
      const triggered = applyEffect(state, target.id, winding ? 'wind' : healing ? 'heal' : 'damage', actionAmount);
      const dealt = healing ? (target.status === 'human' ? target.hp - healthBefore : target.durability - durabilityBefore) : winding ? target.windUpCharge - windBefore : healthBefore - target.hp;
      record(state, { kind: 'item', actorId: hero.id, sourceId: item.id, sourceName: item.name, targetId: target.id, targetName: target.name, amount: dealt,
        defeatedTarget: !healing && !winding && target.side === 'enemy' && target.status === 'dead',
        message: `${item.name} → ${target.name}: ${dealt} ${healing ? 'лечения' : winding ? 'завода' : 'урона'}` });
      item.remainingMs = item.cooldownMs * bonuses.cooldownFactor * puppetRules.cooldownMultiplier * attributeCooldownFactor(hero);
      if (triggered && hero.isPuppet) {
        registerPuppetItemTrigger(hero, item, !healing && !winding && target.side === 'enemy' ? target.id : undefined);
        hero.windUpCharge = Math.max(0, hero.windUpCharge - puppetRules.chargeCost);
        hero.windUpCharge = Math.min(hero.maxWindUp, hero.windUpCharge + puppetRules.chargeRefund);
        if (puppetRules.durabilityRepair) hero.durability = Math.min(hero.maxDurability, hero.durability + puppetRules.durabilityRepair);
        if (hero.windUpCharge === 0) hero.status = 'stopped';
        else if (hero.windUpCharge >= hero.maxWindUp && hero.durability > 0) hero.status = 'active';
        if (puppetRules.adjacentCooldownReductionMs > 0) for (const other of hero.items) {
          if (other.id !== item.id && areAdjacent(item, other)) {
            other.remainingMs = Math.max(0, other.remainingMs - puppetRules.adjacentCooldownReductionMs);
          }
        }
        if (puppetRules.oracleCharge > 0) {
          const recipient = state.heroes.filter(candidate => candidate.id !== hero.id && candidate.isPuppet &&
            (candidate.status === 'active' || candidate.status === 'stopped') && candidate.windUpCharge < candidate.maxWindUp)
            .sort((a, b) => a.windUpCharge / a.maxWindUp - b.windUpCharge / b.maxWindUp || a.slot - b.slot)[0];
          if (recipient) applyEffect(state, recipient.id, 'wind', puppetRules.oracleCharge);
        }
      }
      if (state.outcome !== 'ongoing') return;
    }
  }
}

function advanceEnemies(state: EncounterState, deltaMs: number): void {
  for (const enemy of [...state.enemies].sort((a, b) => a.slot - b.slot)) {
    if (enemy.status !== 'enemy' || enemy.attackDamage <= 0) continue;
    enemy.attackRemainingMs = Math.max(0, enemy.attackRemainingMs - deltaMs);
    if (enemy.attackRemainingMs > 0) continue;
    const target = chooseHeroTarget(state.heroes, enemy.targetPolicy, enemy.slot, enemy.reach);
    if (!target) continue;
    const isDoll = target.status === 'stopped' || target.status === 'active';
    const healthBefore = isDoll ? target.durability : target.hp;
    const enrage = enemy.isBoss && state.bossEnraged
      ? COMBAT_CONFIG.bossEnrageDamage + Math.floor((state.elapsedMs - COMBAT_CONFIG.bossEnrageMs) / 10_000) * 8
      : state.combatEnraged ? Math.floor((state.elapsedMs - COMBAT_CONFIG.combatEnrageMs) / COMBAT_CONFIG.combatEnrageDamageStepMs) * COMBAT_CONFIG.combatEnrageDamage : 0;
    const attackDamage = enemy.attackDamage + enrage;
    applyEffect(state, target.id, 'damage', attackDamage);
    const dealt = healthBefore - (isDoll ? target.durability : target.hp);
    record(state, { kind: 'enemy', actorId: enemy.id, sourceId: enemy.id, sourceName: enemy.name, targetId: target.id, targetName: target.name, amount: dealt, message: `${enemy.name} → ${target.name}: ${dealt} урона` });
    if (dealt > 0 && target.isPuppet && getPuppetForm(target.puppetFormId)?.passiveId === 'martyr-reflection' && enemy.status === 'enemy') {
      const reflected = Math.floor(dealt * PUPPET_RULES.martyrReflection);
      if (reflected > 0) {
        applyEffect(state, enemy.id, 'damage', reflected);
        record(state, { kind: 'state', actorId: target.id, sourceId: target.id, sourceName: getPuppetForm(target.puppetFormId)!.name, targetId: enemy.id, targetName: enemy.name, amount: reflected, defeatedTarget: state.enemies.some(candidate => candidate.id === enemy.id && candidate.status === 'dead'), message: `${target.name} отражает ${reflected} урона` });
      }
    }
    enemy.attackRemainingMs = enemy.attackCooldownMs;
    if (state.outcome !== 'ongoing') return;
  }
}

function applyWindingCommands(state: EncounterState): void {
  for (const actorId of state.commands.splice(0)) {
    const doll = state.heroes.find(hero => hero.id === actorId);
    if (!doll || doll.status !== 'stopped' || doll.durability <= 0) continue;
    const winder = state.heroes.find(hero => hero.status === 'human' || hero.status === 'active');
    if (!winder) continue;
    const previousWind = doll.windUpCharge;
    if (getPuppetForm(doll.puppetFormId)?.passiveId === 'penitent-winding') {
      doll.durability = Math.max(0, doll.durability - PUPPET_RULES.penitentDurabilityCost);
      if (doll.durability === 0) {
        doll.status = 'dead'; doll.windUpCharge = 0;
        const droppedItems = dropDeadHeroItems(state, doll);
        record(state, { kind: 'state', actorId: doll.id, sourceId: doll.id, sourceName: doll.name, targetId: doll.id, targetName: doll.name, amount: 0, transition: 'permadeath', droppedItems, message: `${doll.name}: окончательная гибель` });
        resolveOutcome(state);
        if (state.outcome !== 'ongoing') break;
        continue;
      }
    }
    doll.windUpCharge = Math.min(doll.maxWindUp, doll.windUpCharge + rollManualWindAmount(state, doll));
    record(state, { kind: 'wind', actorId: winder.id, sourceId: winder.id, sourceName: winder.name, targetId: doll.id, targetName: doll.name, amount: doll.windUpCharge - previousWind, message: `${winder.name} заводит ${doll.name}` });
    if (doll.windUpCharge >= doll.maxWindUp) doll.status = 'active';
  }
}

export function stepEncounter(state: EncounterState, deltaMs: number): void {
  if (state.outcome === 'defeat') return;
  advanceRebirth(state, deltaMs);
  if (state.phase !== 'combat' || state.outcome !== 'ongoing') return;
  advanceEnrage(state, deltaMs);
  drainPuppetWind(state, deltaMs);
  advanceItems(state, deltaMs);
  if (state.outcome !== 'ongoing') return;
  advanceEnemies(state, deltaMs);
  if (state.outcome !== 'ongoing') return;
  applyWindingCommands(state);
  resolveOutcome(state);
}

export function projectEncounter(state: EncounterState): { enemyHp: number; cooldown: number; events: string[] } {
  return { enemyHp: state.enemies[0]?.hp ?? 0, cooldown: state.heroes[0]?.items[0]?.remainingMs ?? 0, events: state.events.map(event => event.message) };
}

export function projectAction(event: CombatEvent): { actorId: string; sourceId: string; targetId: string; text: string } {
  return { actorId: event.actorId, sourceId: event.sourceId, targetId: event.targetId, text: event.message };
}

export function projectHero(hero: Combatant): { durability: number; wind: number; cooldownMs: number; rebirthSeconds: number } {
  return { durability: hero.durability, wind: hero.windUpCharge, cooldownMs: hero.items[0]?.remainingMs ?? 0, rebirthSeconds: hero.rebirthMs / 1000 };
}

export function advanceClock(clock: CombatClock, deltaMs: number, visible: boolean, focused: boolean): number {
  if (!visible || !focused) { clock.accumulator = 0; clock.interrupted = true; return 0; }
  if (clock.interrupted) { clock.accumulator = 0; clock.interrupted = false; return 0; }
  clock.accumulator += Math.max(0, deltaMs);
  const steps = Math.floor(clock.accumulator / 50);
  clock.accumulator -= steps * 50;
  return steps;
}

