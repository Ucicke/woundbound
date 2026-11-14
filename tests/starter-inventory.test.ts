import { describe, expect, it } from 'vitest';
import { GameUI } from '../src/ui/GameUI.ts';

describe('starting inventory', () => {
  it('gives each hero their original item on a new run and after a restart', () => {
    const game = new GameUI();
    const expected = ['blade', 'dagger', 'desperate', 'lantern'];
    const check = () => {
      expect(game.state.heroes.map(hero => hero.items.map(item => item.definitionId))).toEqual(expected.map(id => [id]));
    };
    check();
    game.state.heroes[0]!.items.length = 0;
    game.action('restart');
    game.action('confirm-reset');
    check();
  });
});
