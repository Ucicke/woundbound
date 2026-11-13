import { createActor, createState, type EncounterState } from './simulation.ts';
import { createItem } from './items.ts';

export function createFullEncounter(): EncounterState {
  const heroNames = ['Страж', 'Охотница', 'Паломник', 'Часовщица'];
  const itemTypes = ['blade', 'dagger', 'desperate', 'lantern'];
  const heroes = heroNames.map((name, slot) => {
    const hero = createActor(`hero-${slot + 1}`, name, 'hero', slot, 85);
    hero.items.push(createItem(itemTypes[slot], `item-${slot + 1}`));
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
  const state = createState(heroes, enemies);
  state.stash.push(
    createItem('whetstone', 'whetstone-1'), createItem('spring', 'spring-1'),
    createItem('mercy', 'mercy-1'), createItem('heart', 'heart-1'),
  );
  return state;
}
