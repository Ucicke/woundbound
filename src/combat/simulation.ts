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
  return [...alive].sort((a, b) => policy === 'lowest' ? a.hp - b.hp || a.slot - b.slot : a.slot - b.slot)[0];
}

export function chooseEnemyTarget(enemies: Combatant[], policy: TargetPolicy): Combatant | undefined {
  const alive = enemies.filter(actor => actor.status === 'enemy' && actor.hp > 0);
  return [...alive].sort((a, b) => policy === 'lowest' ? a.hp - b.hp || a.slot - b.slot : a.slot - b.slot)[0];
}

function record(state: EncounterState, event: CombatEvent): void {
  state.events.push(event);
  if (state.events.length > 50) state.events.shift();
}

export function stepEncounter(state: EncounterState, deltaMs: number): void {
  if (state.outcome !== 'ongoing') return;
  for (const hero of [...state.heroes].sort((a, b) => a.slot - b.slot)) {
    if (hero.status !== 'human' && hero.status !== 'active') continue;
    for (const item of hero.items) {
      item.remainingMs = Math.max(0, item.remainingMs - deltaMs);
      if (item.remainingMs > 0) continue;
      if (item.trigger === 'ownerBelowHalf' && hero.hp >= hero.maxHp / 2) continue;
      const target = chooseEnemyTarget(state.enemies, item.targetPolicy);
      if (!target) continue;
      target.hp = Math.max(0, target.hp - item.damage);
      if (target.hp === 0) target.status = 'dead';
      record(state, { kind: 'item', actorId: hero.id, sourceId: item.id, sourceName: item.name, targetId: target.id, targetName: target.name, amount: item.damage, message: `${item.name} → ${target.name}: ${item.damage} урона` });
      item.remainingMs = item.cooldownMs;
    }
  }
  for (const enemy of [...state.enemies].sort((a, b) => a.slot - b.slot)) {
    if (enemy.status !== 'enemy' || enemy.attackDamage <= 0) continue;
    enemy.attackRemainingMs = Math.max(0, enemy.attackRemainingMs - deltaMs);
    if (enemy.attackRemainingMs > 0) continue;
    const target = chooseHeroTarget(state.heroes, enemy.targetPolicy);
    if (!target) continue;
    target.hp = Math.max(0, target.hp - enemy.attackDamage);
    if (target.hp === 0) target.status = 'dead';
    record(state, { kind: 'enemy', actorId: enemy.id, sourceId: enemy.id, sourceName: enemy.name, targetId: target.id, targetName: target.name, amount: enemy.attackDamage, message: `${enemy.name} → ${target.name}: ${enemy.attackDamage} урона` });
    enemy.attackRemainingMs = enemy.attackCooldownMs;
  }
}

export function projectEncounter(state: EncounterState): { enemyHp: number; cooldown: number; events: string[] } {
  return { enemyHp: state.enemy.hp, cooldown: state.item?.remainingMs ?? 0, events: state.events.map(event => event.message) };
}

export function advanceClock(clock: CombatClock, deltaMs: number, visible: boolean, focused: boolean): number {
  if (!visible || !focused) { clock.accumulator = 0; clock.interrupted = true; return 0; }
  if (clock.interrupted) { clock.accumulator = 0; clock.interrupted = false; return 0; }
  clock.accumulator += Math.max(0, deltaMs);
  const steps = Math.floor(clock.accumulator / 50);
  clock.accumulator -= steps * 50;
  return steps;
}
