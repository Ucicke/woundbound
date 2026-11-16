import { describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI.ts';
import { areAdjacent, itemBonuses, occupiedCells } from '../src/combat/inventory.ts';
import { createFullEncounter } from '../src/combat/encounter.ts';

describe('starting inventory', () => {
  it('places every starting item within its backpack without overlapping', () => {
    for (const roll of [0, .25, .5, .75, .999]) {
      const state = createFullEncounter({ random: () => roll });
      for (const hero of state.heroes) {
        const cells = hero.items.flatMap(item => {
          const occupied = occupiedCells(item, item.cell);
          expect(occupied).not.toBeNull();
          return occupied ?? [];
        });
        expect(new Set(cells).size).toBe(cells.length);
      }
    }
  });

  it('can generate full inventories across different random runs', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let value = seed;
      const random = () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 0x1_0000_0000;
      };
      const state = createFullEncounter({ fullStartingInventory: true, random });
      expect(state.heroes.every(hero => hero.items.length === 10)).toBe(true);
    }
  });

  it('defaults to themed two or three item loadouts, allows full kits, and preserves the choice on restart', () => {
    const game = new GameUI();
    const expected = [['blade', 'whetstone', 'graveward-buckler'], ['hunter-bow', 'glass-eye', 'dagger'], ['desperate', 'ashen-censer'], ['lantern', 'spring', 'mercy']];
    const check = () => {
      expect(game.state.heroes.map(hero => hero.items.map(item => item.definitionId))).toEqual(expected);
    };
    expect(game.startingLoadout).toBe('starter');
    check();
    const [guard, huntress, , clockmaker] = game.state.heroes;
    expect(areAdjacent(guard.items[0], guard.items[1])).toBe(true);
    expect(itemBonuses(guard.items[0], guard.items).damage).toBeGreaterThanOrEqual(2);
    expect(areAdjacent(huntress.items[0], huntress.items[1])).toBe(true);
    expect(areAdjacent(clockmaker.items[0], clockmaker.items[1])).toBe(true);

    game.action('toggle-start-loadout');
    expect(game.startLoadoutMenuOpen).toBe(true);
    game.action('set-start-loadout', 'full');
    expect(game.startingLoadout).toBe('full');
    expect(game.startLoadoutMenuOpen).toBe(false);
    expect(game.state.heroes.every(hero => hero.items.length > 1)).toBe(true);

    game.action('toggle-start-loadout');
    game.action('set-start-loadout', 'starter');
    check();
    game.state.heroes[0]!.items.length = 0;
    game.action('restart');
    game.action('confirm-reset');
    check();
  });
});
