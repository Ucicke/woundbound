import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { placeStashItem, prepareEncounter, startBattle, stepEncounter } from '../src/combat/simulation.ts';

describe('preparation and combat boundary', () => {
  it('places a real item and lets that item act only after combat starts', () => {
    const state = createFullEncounter();
    prepareEncounter(state);
    const itemId = state.stash[0].id;
    const hero = state.heroes[0];
    stepEncounter(state, 5000);
    expect(state.events).toHaveLength(0);
    expect(placeStashItem(state, itemId, hero.id, 0)).toBe(true);
    expect(state.stash.some(item => item.id === itemId)).toBe(false);
    expect(startBattle(state)).toBe(true);
    for (let n = 0; n < 40; n++) stepEncounter(state, 50);
    expect(state.events.some(event => event.sourceId === itemId && event.kind === 'item')).toBe(true);
  });

  it('rejects invalid placements and all preparation changes during combat', () => {
    const state = createFullEncounter();
    prepareEncounter(state);
    const itemId = state.stash[0].id;
    const before = JSON.stringify(state);
    expect(placeStashItem(state, itemId, state.heroes[0].id, 16)).toBe(false);
    expect(placeStashItem(state, itemId, state.heroes[1].id, 0)).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
    expect(startBattle(state)).toBe(true);
    const combat = JSON.stringify(state);
    expect(startBattle(state)).toBe(false);
    expect(placeStashItem(state, itemId, state.heroes[0].id, 0)).toBe(false);
    expect(JSON.stringify(state)).toBe(combat);
  });
});
