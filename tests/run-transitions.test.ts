import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { findPlacement } from '../src/combat/inventory.ts';
import { beginRun, claimReward, createRun, enterRoom, nextRoomChoices, openRoute, RUN_ROOM_COUNT, syncRun } from '../src/combat/run.ts';
import { applyEffect } from '../src/combat/simulation.ts';
import { GameUI } from '../src/ui/GameUI.ts';

function clearedFirstFight(random: () => number = () => 0) {
  const state = createFullEncounter({ random: () => 0 });
  const run = createRun(state, random);
  expect(beginRun(run)).toBe(true);
  for (const enemy of state.enemies) applyEffect(state, enemy.id, 'damage', enemy.maxHp);
  syncRun(run);
  return { state, run };
}

describe('run transitions', () => {
  it('starts the first and next fights together with their run stage', () => {
    const { state, run } = clearedFirstFight();
    expect(claimReward(run, run.offers[0]!.id)).toBe(true);
    expect(openRoute(run)).toBe(true);
    expect(enterRoom(run, 'battle-0')).toBe(true);
    expect([run.stage, state.phase, state.outcome]).toEqual(['battle', 'combat', 'ongoing']);
    expect(beginRun(run)).toBe(false);
  });

  it('leaves an offered reward untouched on an invalid placement, then places it once', () => {
    const { state, run } = clearedFirstFight();
    const reward = run.offers[0]!;
    const hero = state.heroes[0]!;
    expect(claimReward(run, reward.id, { heroId: hero.id, cell: -1 })).toBe(false);
    expect(run.stage).toBe('reward');
    expect(run.offers).toContain(reward);
    expect(state.floor).not.toContain(reward);
    const cell = findPlacement(state, reward, hero.id)!;
    expect(claimReward(run, reward.id, { heroId: hero.id, cell })).toBe(true);
    expect(hero.items).toContain(reward);
    expect(state.floor).not.toContain(reward);
    expect(claimReward(run, reward.id)).toBe(false);
  });

  it('leaves the route and loose items intact if cache generation fails', () => {
    const { state, run } = clearedFirstFight();
    expect(claimReward(run, run.offers[0]!.id)).toBe(true);
    expect(openRoute(run)).toBe(true);
    const floor = [...state.floor];
    run.random = () => { throw new Error('RNG failed'); };
    expect(() => enterRoom(run, 'cache')).toThrow('RNG failed');
    expect(run.room).toBe(1);
    expect(run.stage).toBe('route');
    expect(state.floor).toEqual(floor);
    expect(nextRoomChoices(run).some(choice => choice.id === 'cache')).toBe(true);
  });

  it('rejects an invalid rarity roll without partially entering the cache', () => {
    const { state, run } = clearedFirstFight();
    expect(claimReward(run, run.offers[0]!.id)).toBe(true);
    expect(openRoute(run)).toBe(true);
    const floor = [...state.floor];
    let rolls = 0;
    run.random = () => ++rolls === 2 ? Number.NaN : 0;
    expect(() => enterRoom(run, 'cache')).toThrow('Reward RNG');
    expect(run.room).toBe(1);
    expect(run.stage).toBe('route');
    expect(state.floor).toEqual(floor);
  });

  it('places a reward via the player interface without first dropping it', () => {
    const ui = new GameUI();
    ui.run.random = () => 0;
    ui.action('begin-run');
    for (const enemy of ui.state.enemies) applyEffect(ui.state, enemy.id, 'damage', enemy.maxHp);
    syncRun(ui.run);
    const reward = ui.run.offers[0]!;
    const hero = ui.state.heroes[0]!;
    expect(ui.dropItem(reward.id, hero.id, -1, true)).toBe(false);
    expect(ui.run.offers).toContain(reward);
    const cell = findPlacement(ui.state, reward, hero.id)!;
    expect(ui.dropItem(reward.id, hero.id, cell, true)).toBe(true);
    expect(hero.items).toContain(reward);
    expect(ui.state.floor).not.toContain(reward);
    expect(ui.run.stage).toBe('cleared');
  });

  it('places the boss at the configured last room', () => {
    const { run } = clearedFirstFight();
    run.room = RUN_ROOM_COUNT - 1; run.transition({ stage: 'route', current: run.current, roomLabel: run.roomLabel });
    expect(nextRoomChoices(run).map(choice => choice.kind)).toEqual(['boss']);
  });
});
