import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { itemBonuses, moveItem, occupiedCells, storeItem } from '../src/combat/inventory.ts';
import { applyEffect, prepareEncounter, startBattle, stepEncounter } from '../src/combat/simulation.ts';

describe('inventory ownership and adjacency', () => {
  it('validates whole item shapes and keeps ownership unchanged after invalid moves', () => {
    const state = createFullEncounter();
    prepareEncounter(state);
    const item = state.stash[0];
    item.shape = [[0, 0], [1, 0]];
    expect(occupiedCells(item, 3)).toBeNull();
    const before = JSON.stringify(state);
    expect(moveItem(state, item.id, state.heroes[1].id, 0)).toBe(false);
    expect(moveItem(state, item.id, state.heroes[0].id, 3)).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
    expect(moveItem(state, item.id, state.heroes[0].id, 0)).toBe(true);
    expect(state.heroes[0].items[0]).toBe(item);
    expect(occupiedCells(item, 0)).toEqual([0, 1]);
    expect(moveItem(state, item.id, state.heroes[0].id, 4)).toBe(true);
    expect(storeItem(state, item.id)).toBe(true);
    expect(state.stash).toContain(item);
    expect(state.heroes[0].items).not.toContain(item);
    startBattle(state);
    expect(storeItem(state, state.heroes[1].items[0].id)).toBe(false);
  });

  it('derives both bonuses only from orthogonal neighbours and recomputes after moving', () => {
    const state = createFullEncounter();
    prepareEncounter(state);
    const blade = state.stash.find(item => item.tags?.includes('blade'))!;
    const stone = state.stash.find(item => item.tags?.includes('whetstone'))!;
    const spring = state.stash.find(item => item.tags?.includes('spring'))!;
    const hero = state.heroes[0];
    expect(moveItem(state, blade.id, hero.id, 0)).toBe(true);
    expect(moveItem(state, stone.id, hero.id, 1)).toBe(true);
    expect(itemBonuses(blade, hero.items).damage).toBe(2);
    expect(moveItem(state, stone.id, hero.id, 5)).toBe(true);
    expect(itemBonuses(blade, hero.items).damage).toBe(0);
    const clockwork = state.heroes[3].items[0];
    expect(moveItem(state, spring.id, state.heroes[3].id, 1)).toBe(true);
    expect(itemBonuses(clockwork, state.heroes[3].items).cooldownFactor).toBeCloseTo(0.85);
  });

  it('applies displayed adjacency bonuses to damage and cooldown in real combat', () => {
    const state = createFullEncounter();
    prepareEncounter(state);
    const hero = state.heroes[0];
    const blade = state.stash.find(item => item.tags?.includes('blade'))!;
    const stone = state.stash.find(item => item.tags?.includes('whetstone'))!;
    const spring = state.stash.find(item => item.tags?.includes('spring'))!;
    const clockwork = state.heroes[3].items[0];
    moveItem(state, blade.id, hero.id, 0);
    moveItem(state, stone.id, hero.id, 1);
    moveItem(state, spring.id, state.heroes[3].id, 1);
    blade.remainingMs = 0;
    clockwork.remainingMs = 0;
    clockwork.trigger = 'always';
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    startBattle(state);
    stepEncounter(state, 50);
    expect(state.events.find(event => event.sourceId === blade.id)?.amount).toBe(blade.damage + 2);
    expect(clockwork.remainingMs).toBeCloseTo(clockwork.cooldownMs * 0.85);
  });

  it('drops duplicate-type instances once and allows transfer only after battle', () => {
    const state = createFullEncounter();
    const dead = state.heroes[0];
    const original = dead.items[0];
    const second = { ...original, id: 'second-instance', cell: 1 };
    dead.items.push(second);
    dead.status = 'active'; dead.durability = 1; dead.wind = 10;
    applyEffect(state, dead.id, 'damage', 1);
    expect(dead.items).toHaveLength(0);
    expect(state.floor.map(item => item.id)).toEqual([original.id, second.id]);
    expect(applyEffect(state, dead.id, 'damage', 1)).toBe(false);
    expect(moveItem(state, original.id, state.heroes[1].id, 1)).toBe(false);
    state.enemies.forEach(enemy => { enemy.hp = 0; enemy.status = 'dead'; });
    state.phase = 'result'; state.outcome = 'victory';
    expect(moveItem(state, original.id, state.heroes[1].id, 1)).toBe(true);
    expect(state.floor.map(item => item.id)).toEqual([second.id]);
    expect(state.heroes[1].items.some(item => item.id === original.id)).toBe(true);
    expect(startBattle(state)).toBe(false);
  });

  it('allows post-defeat organizing of dropped items even when every recipient is dead', () => {
    const state = createFullEncounter();
    const fallen = state.heroes[0];
    const item = fallen.items[0];
    fallen.status = 'active'; fallen.durability = 1; fallen.wind = 10;
    applyEffect(state, fallen.id, 'damage', 1);
    state.heroes.slice(1).forEach(hero => { hero.status = 'dead'; });
    state.outcome = 'defeat'; state.phase = 'result';
    expect(state.floor).toContain(item);

    const recipient = state.heroes[1];
    const cell = Array.from({ length: 16 }, (_, index) => index).find(index => recipient.items.every(other => !occupiedCells(other, other.cell ?? 0)?.includes(index)))!;
    expect(moveItem(state, item.id, recipient.id, cell)).toBe(true);
    expect(state.floor).not.toContain(item);
    expect(recipient.items).toContain(item);
    expect(recipient.status).toBe('dead');
    expect(storeItem(state, item.id)).toBe(true);
    expect(state.stash).toContain(item);
    expect(recipient.items).not.toContain(item);
  });
});
