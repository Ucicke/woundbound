import { createActor, createState, type EncounterState } from './simulation.ts';
import { createItem, ITEM_CLASS_GROUPS } from './items.ts';
import { findPlacement } from './inventory.ts';
import { COMBAT_CONFIG } from './config.ts';
import { choosePuppetForm } from './puppets.ts';

const starterLoadouts = [
  { classId: 'guard', core: ['blade', 'graveward-buckler'] },
  { classId: 'huntress', core: ['hunter-bow', 'hunter-quiver'] },
  { classId: 'pilgrim', core: ['ashen-censer', 'leather-prayerbook'] },
  { classId: 'clockmaker', core: ['lantern', 'clockmaker-pendulum'] },
] as const;

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
    const loadout = starterLoadouts[slot]!;
    hero.items.length = 0;
    const selected: string[] = [...loadout.core];
    const coreItems = new Set<string>(loadout.core);
    const pool = ITEM_CLASS_GROUPS[loadout.classId].filter(definitionId => !coreItems.has(definitionId));
    while (selected.length < 10 && pool.length) {
      const index = Math.floor(random() * pool.length);
      selected.push(pool.splice(index, 1)[0]!);
    }

    const first = createItem(selected[0]!, `item-${slot + 1}`, random);
    first.cell = 0;
    hero.items.push(first);
    const remaining = selected.slice(1).map((definitionId, index) =>
      createItem(definitionId, `starter-${hero.id}-${index + 1}`, random));
    remaining.sort((a, b) => (b.shape?.length ?? 1) - (a.shape?.length ?? 1));
      for (const item of remaining) addPackedItem(state, hero, item, random);
  }
}

export function createFullEncounter(options: { fullStartingInventory?: boolean; random?: () => number } = {}): EncounterState {
  const random = options.random ?? Math.random;
  const heroNames = ['Страж', 'Охотница', 'Паломник', 'Часовщица'];
  const itemTypes = ['blade', 'hunter-bow', 'desperate', 'lantern'];
  const heroes = heroNames.map((name, slot) => {
    const hero = createActor(`hero-${slot + 1}`, name, 'hero', slot, COMBAT_CONFIG.humanHealth);
    hero.pendingPuppetFormId = choosePuppetForm(hero.heroClass!, random).id;
    hero.items.push(createItem(itemTypes[slot]!, `item-${slot + 1}`, random));
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
  const extraItems = [
    ['whetstone', 'graveward-buckler'],
    ['glass-eye', 'dagger'],
    ['ashen-censer'],
    ['spring', 'mercy'],
  ];
  heroes.forEach((hero, index) => extraItems[index]!.forEach((id, slot) => {
    const item = createItem(id, `initial-${hero.id}-${slot}`, random);
    const cell = findPlacement(state, item, hero.id);
    if (cell !== null) { item.cell = cell; hero.items.push(item); }
  }));
  if (options.fullStartingInventory) generateStarterInventory(state, random);
  return state;
}
