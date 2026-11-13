import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { queueWinding, stepEncounter } from '../src/combat/simulation.ts';

describe('manual winding', () => {
  it('activates at exactly 20 accepted clicks and rejects active, invalid and dead targets', () => {
    const state = createFullEncounter();
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    const doll = state.heroes[0]; doll.status = 'stopped'; doll.wind = 0;
    for (let n = 0; n < 19; n++) queueWinding(state, doll.id);
    stepEncounter(state, 50);
    expect(doll.status).toBe('stopped'); expect(doll.wind).toBe(95);
    queueWinding(state, doll.id); stepEncounter(state, 50);
    expect(doll.status).toBe('active'); expect(doll.wind).toBe(100);
    queueWinding(state, doll.id); queueWinding(state, 'missing');
    state.heroes[1].status = 'dead'; queueWinding(state, state.heroes[1].id);
    stepEncounter(state, 50);
    expect(doll.wind).toBeLessThan(100); expect(state.heroes[1].wind).toBe(0);
  });

  it('keeps enemy actions running while winding and freezes cooldown on later stop', () => {
    const state = createFullEncounter();
    const doll = state.heroes[0]; doll.status = 'stopped'; doll.wind = 0;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    const enemy = state.enemies[0]; enemy.attackDamage = 1; enemy.attackRemainingMs = 50;
    queueWinding(state, doll.id); stepEncounter(state, 50);
    expect(state.events.some(event => event.kind === 'enemy')).toBe(true);
    enemy.attackDamage = 0;
    doll.status = 'active'; doll.wind = 0.1; doll.items[0].remainingMs = 450;
    stepEncounter(state, 50);
    expect(doll.status).toBe('stopped');
    const frozen = doll.items[0].remainingMs;
    for (let n = 0; n < 20; n++) queueWinding(state, doll.id);
    stepEncounter(state, 50);
    expect(doll.status).toBe('active'); expect(doll.items[0].remainingMs).toBe(frozen);
  });
});
