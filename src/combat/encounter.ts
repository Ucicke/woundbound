import { createActor, createState, type EncounterState } from './simulation.ts';

export function createFullEncounter(): EncounterState {
  const heroNames = ['Страж', 'Охотница', 'Паломник', 'Часовщица'];
  const itemNames = ['Кровожадный клинок', 'Ржавый кинжал', 'Проклятый молот', 'Ревнивый фонарь'];
  const heroes = heroNames.map((name, slot) => {
    const hero = createActor(`hero-${slot + 1}`, name, 'hero', slot, 85);
    hero.items.push({ id: `item-${slot + 1}`, name: itemNames[slot], damage: 8 + slot, cooldownMs: 1300 + slot * 200, remainingMs: 1300 + slot * 200, targetPolicy: slot % 2 ? 'lowest' : 'front', trigger: 'always', reach: slot < 2 ? 'near' : 'far', tags: slot < 2 ? ['blade'] : ['clockwork'] });
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
    { id: 'whetstone-1', name: 'Точильный камень', damage: 3, cooldownMs: 2200, remainingMs: 2200, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['whetstone'] },
    { id: 'spring-1', name: 'Заводная пружина', damage: 3, cooldownMs: 1900, remainingMs: 1900, targetPolicy: 'front', trigger: 'always', reach: 'far', tags: ['spring'] },
  );
  return state;
}
