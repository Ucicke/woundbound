import { COMBAT_CONFIG } from './config.ts';

export type ActorStatus = 'human' | 'enemy' | 'rebirthing' | 'stopped' | 'active' | 'dead';
export type TargetPolicy = 'front' | 'lowest';
export interface CombatItem { id: string; name: string; damage: number; cooldownMs: number; remainingMs: number; targetPolicy: TargetPolicy; trigger: 'always' | 'ownerBelowHalf' }
export interface Combatant {
  id: string; name: string; side: 'hero' | 'enemy'; slot: number;
  hp: number; maxHp: number; status: ActorStatus; items: CombatItem[];
  targetPolicy: TargetPolicy; attackDamage: number; attackCooldownMs: number; attackRemainingMs: number;
  durability: number; maxDurability: number; wind: number; maxWind: number; rebirthMs: number;
}
export interface CombatEvent { kind: 'item' | 'enemy' | 'state'; actorId: string; sourceId: string; sourceName: string; targetId: string; targetName: string; amount: number; message: string }
export interface EncounterState { heroes: Combatant[]; enemies: Combatant[]; enemy: Combatant; item: CombatItem | null; events: CombatEvent[]; floor: string[]; outcome: 'ongoing' | 'victory' | 'defeat'; commands: string[] }
export interface CombatClock { accumulator: number; interrupted?: boolean }

export function createActor(id: string, name: string, side: 'hero' | 'enemy', slot: number, hp: number, policy: TargetPolicy = 'front'): Combatant {
  return { id, name, side, slot, hp, maxHp: hp, status: side === 'hero' ? 'human' : 'enemy', items: [], targetPolicy: policy, attackDamage: side === 'enemy' ? 6 : 0, attackCooldownMs: 1800, attackRemainingMs: 1800, durability: 100, maxDurability: 100, wind: 0, maxWind: 100, rebirthMs: 0 };
}

export function createState(heroes: Combatant[], enemies: Combatant[]): EncounterState {
  return { heroes, enemies, enemy: enemies[0], item: heroes[0]?.items[0] ?? null, events: [], floor: [], outcome: 'ongoing', commands: [] };
}

export function createEncounter(equipped = true): EncounterState {
  const hero = createActor('hero-1', 'Герой', 'hero', 0, 100);
  if (equipped) hero.items.push({ id: 'blade', name: 'Клинок', damage: 6, cooldownMs: 1000, remainingMs: 1000, targetPolicy: 'front', trigger: 'always' });
  const enemy = createActor('rat', 'Крыса', 'enemy', 0, 120);
  enemy.attackDamage = 0;
  return createState([hero], [enemy]);
}

export function chooseHeroTarget(heroes: Combatant[], policy: TargetPolicy): Combatant | undefined {
  const alive = heroes.filter(actor => actor.status === 'human' || actor.status === 'stopped' || actor.status === 'active');
  const health = (actor: Combatant): number => actor.status === 'human' ? actor.hp : actor.durability;
  return [...alive].sort((a, b) => policy === 'lowest' ? health(a) - health(b) || a.slot - b.slot : a.slot - b.slot)[0];
}

export function chooseEnemyTarget(enemies: Combatant[], policy: TargetPolicy): Combatant | undefined {
  const alive = enemies.filter(actor => actor.status === 'enemy' && actor.hp > 0);
  return [...alive].sort((a, b) => policy === 'lowest' ? a.hp - b.hp || a.slot - b.slot : a.slot - b.slot)[0];
}

function record(state: EncounterState, event: CombatEvent): void {
  state.events.push(event);
  if (state.events.length > 50) state.events.shift();
}

function resolveOutcome(state: EncounterState): void {
  if (state.outcome !== 'ongoing') return;
  if (state.enemies.length > 0 && state.enemies.every(enemy => enemy.status === 'dead')) state.outcome = 'victory';
  else if (state.heroes.length > 0 && state.heroes.every(hero => hero.status === 'dead')) state.outcome = 'defeat';
  if (state.outcome !== 'ongoing') state.commands.length = 0;
}

export function queueWinding(state: EncounterState, actorId: string): void {
  if (state.outcome === 'ongoing') state.commands.push(actorId);
}

export function applyEffect(state: EncounterState, targetId: string, kind: 'damage' | 'heal' | 'poison' | 'bleeding' | 'fear', amount: number): boolean {
  const target = [...state.heroes, ...state.enemies].find(actor => actor.id === targetId);
  if (!target || target.status === 'dead' || target.status === 'rebirthing' || state.outcome !== 'ongoing') return false;
  const isDoll = target.status === 'stopped' || target.status === 'active';
  if (isDoll && kind !== 'damage') return false;
  if (kind === 'heal') { target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount)); return true; }
  if (kind !== 'damage') return true;
  const damage = Math.max(0, amount);
  if (isDoll) {
    target.durability = Math.max(0, target.durability - damage);
    target.wind = Math.max(0, target.wind - damage);
    if (target.durability === 0) {
      target.status = 'dead';
      for (const item of target.items) if (!state.floor.includes(item.id)) state.floor.push(item.id);
      record(state, { kind: 'state', actorId: target.id, sourceId: target.id, sourceName: target.name, targetId: target.id, targetName: target.name, amount: 0, message: `${target.name}: окончательная гибель` });
      resolveOutcome(state);
    } else if (target.wind === 0) target.status = 'stopped';
    return true;
  }
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp === 0 && target.side === 'hero') {
    target.status = 'rebirthing';
    target.rebirthMs = COMBAT_CONFIG.rebirthMs;
    for (const item of target.items) item.remainingMs = item.cooldownMs;
    record(state, { kind: 'state', actorId: target.id, sourceId: target.id, sourceName: target.name, targetId: target.id, targetName: target.name, amount: 0, message: `${target.name}: перерождение` });
  } else if (target.hp === 0) { target.status = 'dead'; resolveOutcome(state); }
  return true;
}

export function stepEncounter(state: EncounterState, deltaMs: number): void {
  if (state.outcome !== 'ongoing') return;
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
      item.remainingMs = Math.max(0, item.remainingMs - deltaMs);
      if (item.remainingMs > 0) continue;
      if (item.trigger === 'ownerBelowHalf' && (hero.status === 'human' ? hero.hp / hero.maxHp : hero.durability / hero.maxDurability) >= 0.5) continue;
      const target = chooseEnemyTarget(state.enemies, item.targetPolicy);
      if (!target) continue;
      const healthBefore = target.hp;
      applyEffect(state, target.id, 'damage', item.damage);
      const dealt = healthBefore - target.hp;
      record(state, { kind: 'item', actorId: hero.id, sourceId: item.id, sourceName: item.name, targetId: target.id, targetName: target.name, amount: dealt, message: `${item.name} → ${target.name}: ${dealt} урона` });
      item.remainingMs = item.cooldownMs;
      if (state.outcome !== 'ongoing') return;
    }
  }
  for (const enemy of [...state.enemies].sort((a, b) => a.slot - b.slot)) {
    if (enemy.status !== 'enemy' || enemy.attackDamage <= 0) continue;
    enemy.attackRemainingMs = Math.max(0, enemy.attackRemainingMs - deltaMs);
    if (enemy.attackRemainingMs > 0) continue;
    const target = chooseHeroTarget(state.heroes, enemy.targetPolicy);
    if (!target) continue;
    const isDoll = target.status === 'stopped' || target.status === 'active';
    const healthBefore = isDoll ? target.durability : target.hp;
    applyEffect(state, target.id, 'damage', enemy.attackDamage);
    const dealt = healthBefore - (isDoll ? target.durability : target.hp);
    record(state, { kind: 'enemy', actorId: enemy.id, sourceId: enemy.id, sourceName: enemy.name, targetId: target.id, targetName: target.name, amount: dealt, message: `${enemy.name} → ${target.name}: ${dealt} урона` });
    enemy.attackRemainingMs = enemy.attackCooldownMs;
    if (state.outcome !== 'ongoing') return;
  }
  for (const actorId of state.commands.splice(0)) {
    const doll = state.heroes.find(hero => hero.id === actorId);
    if (!doll || doll.status !== 'stopped' || doll.durability <= 0) continue;
    doll.wind = Math.min(doll.maxWind, doll.wind + doll.maxWind / COMBAT_CONFIG.clicksToFull);
    if (doll.wind >= doll.maxWind) doll.status = 'active';
  }
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

