import { createActor, createState, type EncounterState } from './simulation.ts';
import { createItem, ITEM_CLASS_GROUPS } from './items.ts';
import { findPlacement } from './inventory.ts';
import { COMBAT_CONFIG } from './config.ts';
import { choosePuppetForm, type HeroClass } from './puppets.ts';

const starterLoadouts: Record<HeroClass, { name: string; initial: readonly string[]; core: readonly string[] }> = {
  guard: { name: 'Страж', initial: ['blade', 'whetstone', 'graveward-buckler'], core: ['blade', 'graveward-buckler'] },
  huntress: { name: 'Охотница', initial: ['hunter-bow', 'glass-eye', 'dagger'], core: ['hunter-bow', 'hunter-quiver'] },
  pilgrim: { name: 'Паломник', initial: ['desperate', 'ashen-censer'], core: ['ashen-censer', 'leather-prayerbook'] },
  clockmaker: { name: 'Часовщица', initial: ['lantern', 'spring', 'mercy'], core: ['lantern', 'clockmaker-pendulum'] },
};
const partyClasses: readonly HeroClass[] = ['guard', 'huntress', 'pilgrim', 'clockmaker'];

function validatedRandom(source: () => number): () => number {
  return () => {
    const value = source();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError(`Random source must return a finite number in [0, 1); received ${value}`);
    }
    return value;
  };
}

function addPackedItem(state: EncounterState, hero: EncounterState['heroes'][number], item: ReturnType<typeof createItem>, random: () => number): boolean {
  const previousRotation = item.rotation;
  const firstTurn = Math.floor(random() * 4);
  for (let offset = 0; offset < 4; offset++) {
    const rotation = (firstTurn + offset) % 4;
    if (rotation === 0) delete item.rotation;
    else item.rotation = rotation;
    const cell = findPlacement(state, item, hero.id);
    if (cell === null) continue;
    item.cell = cell;
    hero.items.push(item);
    return true;
  }
  if (previousRotation === undefined) delete item.rotation;
  else item.rotation = previousRotation;
  return false;
}

function generateStarterInventory(state: EncounterState, random: () => number): void {
  for (const [slot, hero] of state.heroes.entries()) {
    const heroClass = hero.heroClass;
    if (!heroClass) throw new Error(`Cannot generate starter inventory for hero without a class: ${hero.id}`);
    const loadout = starterLoadouts[heroClass];
    hero.items.length = 0;
    const selected: string[] = [...loadout.core];
    const coreItems = new Set<string>(loadout.core);
    const pool = ITEM_CLASS_GROUPS[heroClass].filter(definitionId => !coreItems.has(definitionId));
    while (selected.length < 10 && pool.length) {
      const index = Math.floor(random() * pool.length);
      selected.push(pool.splice(index, 1)[0]!);
    }

    if (selected.length < 10) throw new Error(`Class ${heroClass} does not have enough items for a full starter inventory`);
    const first = createItem(selected[0]!, `item-${slot + 1}`, random);
    first.cell = 0;
    hero.items.push(first);
    const remaining = selected.slice(1).map((definitionId, index) =>
      createItem(definitionId, `starter-${hero.id}-${index + 1}`, random));
    remaining.sort((a, b) => (b.shape?.length ?? 1) - (a.shape?.length ?? 1));
    let replacementIndex = 0;
    for (const item of remaining) {
      if (addPackedItem(state, hero, item, random)) continue;
      if (item.definitionId && loadout.core.includes(item.definitionId)) {
        throw new Error(`Could not fit core item ${item.name} in ${loadout.name}'s full starter inventory`);
      }

      let replaced = false;
      while (pool.length && !replaced) {
        const index = Math.floor(random() * pool.length);
        const [definitionId] = pool.splice(index, 1);
        const replacement = createItem(definitionId!, `starter-${hero.id}-replacement-${++replacementIndex}`, random);
        replaced = addPackedItem(state, hero, replacement, random);
      }
      if (!replaced) throw new Error(`Could not fit ten items in ${loadout.name}'s full starter inventory`);
    }
  }
}

export function createFullEncounter(options: { fullStartingInventory?: boolean; random?: () => number } = {}): EncounterState {
  const random = validatedRandom(options.random ?? Math.random);
  const heroes = partyClasses.map((heroClass, slot) => {
    const loadout = starterLoadouts[heroClass];
    const hero = createActor(`hero-${slot + 1}`, loadout.name, 'hero', slot, COMBAT_CONFIG.humanHealth);
    hero.pendingPuppetFormId = choosePuppetForm(heroClass, random).id;
    hero.items.push(createItem(loadout.initial[0]!, `item-${slot + 1}`, random));
    return hero;
  });
  const enemies = ['Чумная крыса', 'Культист', 'Чумная крыса', 'Культист'].map((name, slot) => {
    const enemy = createActor(`enemy-${slot + 1}`, name, 'enemy', slot, 100, slot % 2 ? 'lowest' : 'front');
    enemy.attackDamage = slot % 2 ? 7 : 6;
    enemy.reach = slot % 2 ? 'far' : 'near';
    enemy.attackCooldownMs = 1500 + slot * 150;
    enemy.attackRemainingMs = enemy.attackCooldownMs;
    return enemy;
  });
  const state = createState(heroes, enemies, Math.floor(random() * 0x1_0000_0000));
  heroes.forEach(hero => {
    const heroClass = hero.heroClass;
    if (!heroClass) throw new Error(`Cannot place starting items for hero without a class: ${hero.id}`);
    const loadout = starterLoadouts[heroClass];
    loadout.initial.slice(1).forEach((id, slot) => {
      const item = createItem(id, `initial-${hero.id}-${slot}`, random);
      const cell = findPlacement(state, item, hero.id);
      if (cell === null) throw new Error(`Could not fit ${item.name} in ${loadout.name}'s starting inventory`);
      item.cell = cell;
      hero.items.push(item);
    });
  });
  if (options.fullStartingInventory) generateStarterInventory(state, random);
  return state;
}
