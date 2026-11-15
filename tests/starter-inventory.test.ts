import { describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI.ts';
import { areAdjacent, itemBonuses } from '../src/combat/inventory.ts';

describe('starting inventory', () => {
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
