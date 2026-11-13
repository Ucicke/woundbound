import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { projectAction, projectHero, stepEncounter } from '../src/combat/simulation.ts';

describe('combat presentation projection', () => {
  it('projects the actual action source, target and result without changing model state', () => {
    const state = createFullEncounter();
    state.heroes[0].items[0].remainingMs = 0;
    stepEncounter(state, 50);
    const event = state.events.find(item => item.kind === 'item')!;
    const before = JSON.stringify(state);
    const view = projectAction(event);
    expect(view.sourceId).toBe(event.sourceId);
    expect(view.actorId).toBe(event.actorId);
    expect(view.targetId).toBe(event.targetId);
    expect(view.text).toContain(event.targetName);
    expect(view.text).toContain(String(event.amount));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('projects separate doll meters, cooldown and numeric rebirth without mutation', () => {
    const state = createFullEncounter();
    const hero = state.heroes[0]; hero.status = 'stopped'; hero.durability = 70; hero.wind = 35;
    const before = JSON.stringify(hero);
    expect(projectHero(hero)).toMatchObject({ durability: 70, wind: 35, cooldownMs: hero.items[0].remainingMs });
    hero.status = 'rebirthing'; hero.rebirthMs = 1250;
    expect(projectHero(hero).rebirthSeconds).toBe(1.25);
    hero.status = 'stopped'; hero.rebirthMs = 0;
    expect(JSON.stringify(hero)).toBe(before);
  });

  it('reports actual applied damage when the remaining target health is lower than the hit', () => {
    const state = createFullEncounter();
    state.enemies[0].hp = 3;
    state.heroes[0].items[0].remainingMs = 0;
    stepEncounter(state, 50);
    const event = state.events.find(item => item.sourceId === state.heroes[0].items[0].id)!;
    expect(event.amount).toBe(3);
    expect(projectAction(event).text).toContain('3 урона');
  });
});
