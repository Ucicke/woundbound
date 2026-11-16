import { describe, expect, it } from 'vitest';
import { createItem } from '../src/combat/items.ts';
import { applyEffect, createActor, createState, projectEncounter, transformHeroToPuppet } from '../src/combat/simulation.ts';

describe('combat model boundaries', () => {
  it('rejects a puppet form belonging to another class without changing the hero', () => {
    const hero = createActor('guard', 'Страж', 'hero', 0, 10);
    hero.status = 'rebirthing';
    const before = structuredClone(hero);
    expect(transformHeroToPuppet(hero, 'automaton-master')).toBe(false);
    expect(hero).toEqual(before);
    expect(transformHeroToPuppet(hero, 'tin-soldier')).toBe(true);
  });

  it('rejects unsupported effects for humans and puppets', () => {
    const hero = createActor('guard', 'Страж', 'hero', 0, 10);
    const enemy = createActor('enemy', 'Враг', 'enemy', 0, 10);
    const state = createState([hero], [enemy]);
    for (const effect of ['poison', 'bleeding', 'fear'] as const) expect(applyEffect(state, hero.id, effect, 10)).toBe(false);
    hero.status = 'rebirthing';
    expect(transformHeroToPuppet(hero, 'tin-soldier')).toBe(true);
    for (const effect of ['poison', 'bleeding', 'fear'] as const) expect(applyEffect(state, hero.id, effect, 10)).toBe(false);
  });

  it('requires an enemy and projects the current first enemy and item', () => {
    const hero = createActor('guard', 'Страж', 'hero', 0, 10);
    const first = createActor('enemy-1', 'Враг', 'enemy', 0, 10);
    const second = createActor('enemy-2', 'Враг', 'enemy', 1, 20);
    expect(() => createState([hero], [])).toThrow();
    const state = createState([hero], [first, second]);
    state.enemies = [second];
    const item = createItem('blade', 'new-item', () => 0);
    item.remainingMs = 321;
    hero.items.push(item);
    expect(projectEncounter(state).enemyHp).toBe(20);
    expect(projectEncounter(state).cooldown).toBe(321);
  });

  it('rejects inconsistent combatants at encounter creation', () => {
    const hero = createActor('guard', 'Страж', 'hero', 0, 10);
    const enemy = createActor('enemy', 'Враг', 'enemy', 0, 10);
    expect(() => createState([enemy], [hero])).toThrow();
    hero.status = 'active';
    expect(() => createState([hero], [enemy])).toThrow();
  });
});
