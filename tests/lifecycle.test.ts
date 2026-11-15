import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { applyEffect, chooseHeroTarget, stepEncounter } from '../src/combat/simulation.ts';

describe('human to doll lifecycle', () => {
  it('makes a fallen human untargetable during rebirth, then creates a stopped doll in the same slot', () => {
    const state = createFullEncounter();
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    const hero = state.heroes[0];
    state.heroes.forEach(candidate => { candidate.items = candidate.items.slice(0, 1); });
    hero.items[0].remainingMs = 100;
    expect(applyEffect(state, hero.id, 'damage', hero.hp + 2)).toBe(true);
    expect(hero.status).toBe('rebirthing');
    expect(hero.items[0].remainingMs).toBe(hero.items[0].cooldownMs);
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(state.heroes[2].id);
    for (let n = 0; n < 59; n++) stepEncounter(state, 50);
    expect(hero.status).toBe('rebirthing');
    stepEncounter(state, 50);
    expect(hero.status).toBe('stopped');
    expect(hero.slot).toBe(0);
    expect(hero.durability).toBe(hero.maxDurability);
    expect(hero.windUpCharge).toBe(0);
    expect(hero.items[0].remainingMs).toBe(hero.items[0].cooldownMs);
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(state.heroes[2].id);
    state.heroes.slice(1).forEach(other => { other.status = 'dead'; });
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(hero.id);
  });

  it('reduces doll durability and wind together, accepts repair, and rejects status effects', () => {
    const state = createFullEncounter();
    const hero = state.heroes[0];
    hero.items = hero.items.slice(0, 1);
    hero.status = 'stopped'; hero.windUpCharge = 40; hero.durability = 80;
    expect(applyEffect(state, hero.id, 'damage', 10)).toBe(true);
    expect([hero.windUpCharge, hero.durability]).toEqual([32, 72]);
    expect(applyEffect(state, hero.id, 'heal', 10)).toBe(true);
    for (const kind of ['poison', 'bleeding', 'fear'] as const) expect(applyEffect(state, hero.id, kind, 10)).toBe(false);
    expect([hero.windUpCharge, hero.durability]).toEqual([32, 82]);
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(state.heroes[2].id);
    state.heroes.slice(1).forEach(other => { other.status = 'dead'; });
    expect(chooseHeroTarget(state.heroes, 'front')?.id).toBe(hero.id);
  });
});
