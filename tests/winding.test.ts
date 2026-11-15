import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { queueWinding, stepEncounter } from '../src/combat/simulation.ts';

describe('manual winding', () => {
  it('adds a seeded random 5–20 charge per click and rejects active, invalid and dead targets', () => {
    const state = createFullEncounter({ random: () => .5 });
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10_000; });
    const doll = state.heroes[0]; doll.status = 'stopped'; doll.windUpCharge = 0;
    const gains: number[] = [];
    for (let clicks = 0; clicks < 20 && doll.status === 'stopped'; clicks++) {
      queueWinding(state, doll.id); stepEncounter(state, 50);
      gains.push(state.events.filter(event => event.kind === 'wind').at(-1)!.amount);
    }
    expect(doll.status).toBe('active'); expect(doll.windUpCharge).toBe(100);
    expect(gains.length).toBeGreaterThanOrEqual(5); expect(gains.length).toBeLessThanOrEqual(20);
    expect(gains.slice(0, -1).every(amount => amount >= 5 && amount <= 20)).toBe(true);
    expect(gains.at(-1)).toBeGreaterThan(0); expect(gains.at(-1)).toBeLessThanOrEqual(20);
    expect(new Set(gains.slice(0, -1)).size).toBeGreaterThan(1);
    queueWinding(state, doll.id); queueWinding(state, 'missing');
    state.heroes[1].status = 'dead'; queueWinding(state, state.heroes[1].id);
    stepEncounter(state, 50);
    expect(doll.windUpCharge).toBeLessThan(100); expect(state.heroes[1].windUpCharge).toBe(0);
  });

  it('keeps enemy actions running while winding and freezes cooldown on later stop', () => {
    const state = createFullEncounter();
    const doll = state.heroes[0]; doll.status = 'stopped'; doll.windUpCharge = 0;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    const enemy = state.enemies[0]; enemy.attackDamage = 1; enemy.attackRemainingMs = 50;
    queueWinding(state, doll.id); stepEncounter(state, 50);
    expect(state.events.some(event => event.kind === 'enemy')).toBe(true);
    enemy.attackDamage = 0;
    doll.status = 'active'; doll.windUpCharge = 0.1; doll.items[0].remainingMs = 450;
    stepEncounter(state, 50);
    expect(doll.status).toBe('stopped');
    const frozen = doll.items[0].remainingMs;
    for (let n = 0; n < 20; n++) queueWinding(state, doll.id);
    stepEncounter(state, 50);
    expect(doll.status).toBe('active'); expect(doll.items[0].remainingMs).toBe(frozen);
  });
});
