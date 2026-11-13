import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { chooseEnemyTarget, chooseHeroTarget, evaluateItem, prepareEncounter, startBattle, stepEncounter, swapHeroPositions } from '../src/combat/simulation.ts';

describe('formation and reach', () => {
  it('swaps identities and equipment atomically only during preparation', () => {
    const state = createFullEncounter();
    prepareEncounter(state);
    const first = state.heroes[0];
    const last = state.heroes[3];
    const lastItem = last.items[0];
    expect(swapHeroPositions(state, 0, 3)).toBe(true);
    expect(state.heroes[0]).toBe(last);
    expect(state.heroes[3]).toBe(first);
    expect(last.items[0]).toBe(lastItem);
    const snapshot = JSON.stringify(state);
    expect(swapHeroPositions(state, 0, 4)).toBe(false);
    expect(swapHeroPositions(state, 0, 0)).toBe(false);
    expect(JSON.stringify(state)).toBe(snapshot);
    startBattle(state);
    expect(swapHeroPositions(state, 0, 3)).toBe(false);
  });

  it('filters reach before target policy, skipping untargetable slots for both sides', () => {
    const state = createFullEncounter();
    state.heroes[0].status = 'rebirthing';
    state.heroes[1].status = 'stopped';
    state.heroes[3].hp = 1;
    expect(chooseHeroTarget(state.heroes, 'lowest', 0, 'near')).toBe(state.heroes[1]);
    expect(chooseHeroTarget(state.heroes, 'lowest', 2, 'near')).toBeUndefined();
    expect(chooseHeroTarget(state.heroes, 'lowest', 2, 'far')).toBe(state.heroes[3]);
    state.enemies[0].status = 'dead';
    state.enemies[3].hp = 1;
    expect(chooseEnemyTarget(state.enemies, 'lowest', 0, 'near')).toBe(state.enemies[1]);
    expect(chooseEnemyTarget(state.enemies, 'lowest', 3, 'near')).toBeUndefined();
    expect(chooseEnemyTarget(state.enemies, 'lowest', 3, 'far')).toBe(state.enemies[3]);
  });

  it('uses actor position for real attacks and keeps unreachable attacks ready', () => {
    const state = createFullEncounter();
    const hero = state.heroes[0];
    const item = hero.items[0];
    item.reach = 'near'; item.remainingMs = 0;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    hero.slot = 3;
    expect(evaluateItem(state, hero, item).reason).toContain('позиций 1–2');
    stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === item.id)).toBe(false);
    expect(item.remainingMs).toBe(0);
    hero.slot = 0;
    stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === item.id && event.targetId === state.enemies[0].id)).toBe(true);
    const enemy = state.enemies[0];
    enemy.reach = 'near'; enemy.slot = 2; enemy.attackDamage = 5; enemy.attackRemainingMs = 0;
    stepEncounter(state, 50);
    expect(state.events.some(event => event.actorId === enemy.id)).toBe(false);
    expect(enemy.attackRemainingMs).toBe(0);
    enemy.slot = 0;
    stepEncounter(state, 50);
    expect(state.events.some(event => event.actorId === enemy.id && event.targetId === hero.id)).toBe(true);
  });
});
