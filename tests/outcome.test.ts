import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { applyEffect, queueWinding, stepEncounter } from '../src/combat/simulation.ts';

describe('encounter outcomes', () => {
  it.each([50, 5])('permanently kills at zero durability even with starting wind %s and drops each item once', wind => {
    const state = createFullEncounter();
    const last = state.heroes[0];
    state.heroes.slice(1).forEach(hero => { hero.status = 'dead'; });
    last.status = 'active'; last.durability = 5; last.windUpCharge = wind;
    const itemId = last.items[0].id;
    applyEffect(state, last.id, 'damage', 10);
    expect(last.status).toBe('dead');
    expect(state.outcome).toBe('defeat');
    expect(state.floor.filter(item => item.id === itemId)).toHaveLength(1);
    expect(last.items).toHaveLength(0);
    expect(applyEffect(state, last.id, 'damage', 5)).toBe(false);
    expect(state.floor.filter(item => item.id === itemId)).toHaveLength(1);
  });

  it('does not defeat stopped or rebirthing survivors', () => {
    const state = createFullEncounter();
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    state.heroes.forEach(hero => { hero.status = 'dead'; });
    state.heroes[0].status = 'stopped'; state.heroes[0].durability = 50;
    state.heroes[1].status = 'rebirthing'; state.heroes[1].rebirthMs = 1000;
    stepEncounter(state, 50);
    expect(state.outcome).toBe('ongoing');
  });

  it('keeps fighting when all dolls are stopped, then loses when they are destroyed', () => {
    const state = createFullEncounter();
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    state.heroes.forEach(hero => { hero.status = 'stopped'; hero.windUpCharge = 0; hero.durability = 50; });
    queueWinding(state, state.heroes[0].id);
    stepEncounter(state, 50);
    expect(state.outcome).toBe('ongoing');
    expect(state.events.some(event => event.kind === 'wind')).toBe(false);
    state.enemies.forEach(enemy => { enemy.attackDamage = 1000; enemy.attackRemainingMs = 0; enemy.reach = 'far'; });
    stepEncounter(state, 50);
    expect(state.outcome).toBe('defeat');
  });

  it('declares victory on the last enemy and freezes subsequent actions and input', () => {
    const state = createFullEncounter();
    state.enemies.slice(1).forEach(enemy => { enemy.status = 'dead'; enemy.hp = 0; });
    applyEffect(state, state.enemies[0].id, 'damage', state.enemies[0].hp);
    expect(state.outcome).toBe('victory');
    const snapshot = JSON.stringify(state);
    queueWinding(state, state.heroes[0].id);
    stepEncounter(state, 5000);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
