import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { createItem, itemDefinitionIds } from '../src/combat/items.ts';
import { evaluateItem, stepEncounter } from '../src/combat/simulation.ts';

describe('autonomous item catalog', () => {
  it('offers eight distinct documented definitions and independent instances', () => {
    const ids = itemDefinitionIds();
    const state = createFullEncounter();
    const starting = [...state.heroes.flatMap(hero => hero.items), ...state.stash];
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    expect(new Set(starting.map(item => item.definitionId)).size).toBe(8);
    expect(starting.every(item => item.description && item.cooldownMs > 0)).toBe(true);
    const one = createItem('blade', 'one');
    const two = createItem('blade', 'two');
    one.remainingMs = 0;
    expect(two.remainingMs).toBe(two.cooldownMs);
    expect(one.id).not.toBe(two.id);
  });

  it('keeps conditional attacks ready and explains why they wait', () => {
    const state = createFullEncounter();
    const hero = state.heroes[0];
    const blade = createItem('desperate', 'desperate-test');
    blade.remainingMs = 0;
    hero.items = [blade];
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    expect(evaluateItem(state, hero, blade).reason).toContain('Владелец');
    stepEncounter(state, 50);
    expect(blade.remainingMs).toBe(0);
    hero.hp = 10;
    expect(evaluateItem(state, hero, blade).target).toBe(state.enemies[0]);
    stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === blade.id)).toBe(true);
    const lantern = createItem('lantern', 'lantern-test');
    expect(evaluateItem(state, hero, lantern).reason).toContain('Цель');
    state.enemies[0].hp = 10;
    expect(evaluateItem(state, hero, lantern).reason).toBeUndefined();
  });

  it('heals only injured humans and never dolls, with correct event values', () => {
    const state = createFullEncounter();
    const healer = state.heroes[0];
    const potion = createItem('mercy', 'potion-test');
    potion.remainingMs = 0;
    healer.items = [potion];
    state.heroes[1].hp = 20;
    state.heroes[2].status = 'stopped'; state.heroes[2].durability = 1;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    expect(evaluateItem(state, healer, potion).target).toBe(state.heroes[1]);
    stepEncounter(state, 50);
    expect(state.heroes[1].hp).toBe(30);
    expect(state.heroes[2].durability).toBe(1);
    expect(state.events.find(event => event.sourceId === potion.id)?.amount).toBe(10);
    const self = createItem('heart', 'heart-test');
    healer.hp = healer.maxHp;
    expect(evaluateItem(state, healer, self).reason).toBe('Нет раненого человека');
    healer.hp = 5;
    expect(evaluateItem(state, healer, self).target).toBe(healer);
  });
});
