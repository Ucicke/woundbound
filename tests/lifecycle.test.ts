import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { applyEffect, chooseHeroTarget, stepEncounter } from '../src/combat/simulation.ts';

describe('human to doll lifecycle', () => {
  it('makes a fallen human untargetable during rebirth, then creates a stopped doll in the same slot', () => {
    const state = createFullEncounter();
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    const hero = state.heroes[0];
    hero.items[0].remainingMs = 100;
    expect(applyEffect(state, hero.id, 'damage', hero.hp)).toBe(true);
    expect(hero.status).toBe('rebirthing');
    expect(hero.items[0].remainingMs).toBe(hero.items[0].cooldownMs);
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(state.heroes[1].id);
    for (let n = 0; n < 59; n++) stepEncounter(state, 50);
    expect(hero.status).toBe('rebirthing');
    stepEncounter(state, 50);
    expect(hero.status).toBe('stopped');
    expect(hero.slot).toBe(0);
    expect(hero.durability).toBe(hero.maxDurability);
    expect(hero.wind).toBe(0);
    expect(hero.items[0].remainingMs).toBe(hero.items[0].cooldownMs);
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(hero.id);
  });

  it('reduces doll durability and wind together and rejects ordinary healing and statuses', () => {
    const state = createFullEncounter();
    const hero = state.heroes[0];
    hero.status = 'stopped'; hero.wind = 40; hero.durability = 80;
    expect(applyEffect(state, hero.id, 'damage', 10)).toBe(true);
    expect([hero.wind, hero.durability]).toEqual([30, 70]);
    for (const kind of ['heal', 'poison', 'bleeding', 'fear'] as const) expect(applyEffect(state, hero.id, kind, 10)).toBe(false);
    expect([hero.wind, hero.durability]).toEqual([30, 70]);
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(hero.id);
  });
});
