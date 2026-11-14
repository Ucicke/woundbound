import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { advanceClock, chooseHeroTarget, stepEncounter } from '../src/combat/simulation.ts';

describe('fixed encounter', () => {
  it('has four stable heroes and enemies, fixed items and distinct enemy policies', () => {
    const state = createFullEncounter();
    expect(state.heroes).toHaveLength(4);
    expect(state.enemies).toHaveLength(4);
    expect(new Set(state.heroes.map(hero => hero.id)).size).toBe(4);
    expect(new Set(state.enemies.map(enemy => enemy.targetPolicy)).size).toBeGreaterThanOrEqual(2);
    expect(state.heroes.every(hero => hero.items.length > 0)).toBe(true);
    expect(state.heroes.every(hero => hero.hp > 0)).toBe(true);
  });

  it('uses distinct target policies with stable tie breaking', () => {
    const state = createFullEncounter();
    state.heroes[3].hp = 1;
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(state.heroes[0].id);
    expect(chooseHeroTarget(state.heroes, 'lowest')?.id).toBe(state.heroes[3].id);
    state.heroes[0].status = 'dead';
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(state.heroes[2].id);
  });

  it('advances independently equipped items and never creates hero attacks without an item', () => {
    const state = createFullEncounter();
    state.heroes[1].items = [];
    for (let n = 0; n < 40; n++) stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === state.heroes[0].items[0].id)).toBe(true);
    expect(state.events.some(event => event.actorId === state.heroes[1].id)).toBe(false);
    expect(state.heroes.some(hero => hero.hp < hero.maxHp)).toBe(true);
  });

  it('does not spam events when items have no legal target', () => {
    const state = createFullEncounter();
    state.enemies.forEach(enemy => { enemy.hp = 0; enemy.status = 'dead'; });
    for (let n = 0; n < 100; n++) stepEncounter(state, 50);
    expect(state.events.filter(event => event.kind === 'item')).toHaveLength(0);
  });

  it('keeps a ready item waiting until its trigger condition is met', () => {
    const state = createFullEncounter();
    const hero = state.heroes[2];
    const item = hero.items[0];
    item.trigger = 'ownerBelowHalf';
    item.reach = 'far';
    item.remainingMs = 0;
    stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === item.id)).toBe(false);
    expect(item.remainingMs).toBe(0);
    hero.hp = Math.floor(hero.maxHp / 4);
    stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === item.id)).toBe(true);
  });
});

describe('browser combat clock', () => {
  it('produces equal fixed steps for equivalent frame partitions', () => {
    const a = { accumulator: 0 };
    const b = { accumulator: 0 };
    expect(advanceClock(a, 500, true, true)).toBe(advanceClock(b, 200, true, true) + advanceClock(b, 300, true, true));
  });
  it('discards hidden or unfocused elapsed time and resumes only when both return', () => {
    const clock = { accumulator: 25 };
    expect(advanceClock(clock, 5000, false, true)).toBe(0);
    expect(clock.accumulator).toBe(0);
    expect(advanceClock(clock, 5000, true, false)).toBe(0);
    expect(advanceClock(clock, 5000, true, true)).toBe(0);
    expect(advanceClock(clock, 50, true, true)).toBe(1);
  });
});
