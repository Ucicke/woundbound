import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { areAdjacent, itemBonuses, synergyTargets } from '../src/combat/inventory.ts';
import { createItem } from '../src/combat/items.ts';
import { applyEffect, evaluateItem, stepEncounter } from '../src/combat/simulation.ts';
import { GameUI } from '../src/ui/GameUI.ts';

describe('puppet repair and inventory synergies', () => {
  it('repairs the most damaged puppet, never revives dead heroes, and records actual repair', () => {
    const state = createFullEncounter({ random: () => 0 });
    const healer = state.heroes[2]!;
    const potion = createItem('mercy', 'test-heal', () => 0);
    healer.items = [potion]; potion.remainingMs = 0;
    const puppet = state.heroes[1]!; puppet.status = 'stopped'; puppet.durability = 15; puppet.maxDurability = 100;
    state.heroes[3]!.status = 'dead'; state.heroes[3]!.durability = 0;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
    expect(evaluateItem(state, healer, potion).target).toBe(puppet);
    stepEncounter(state, 50);
    expect(puppet.durability).toBeGreaterThan(15);
    expect(state.events.find(event => event.sourceId === potion.id)?.amount).toBe(puppet.durability - 15);
    expect(applyEffect(state, state.heroes[3]!.id, 'heal', 100)).toBe(false);
  });

  it('offers the same tag links that activate the adjacency bonus', () => {
    const stone = createItem('whetstone', 'stone', () => 0);
    const blade = createItem('blade', 'blade', () => 0);
    stone.cell = 0; blade.cell = 2;
    expect(synergyTargets(stone).some(rule => rule.tag === 'blade')).toBe(true);
    expect(areAdjacent(stone, blade)).toBe(true);
    expect(itemBonuses(blade, [stone, blade]).damage).toBe(8);
    blade.cell = 5;
    expect(itemBonuses(blade, [stone, blade]).damage).toBe(0);
  });

  it('restarts directly into combat from defeat', () => {
    const ui = new GameUI();
    ui.run.stage = 'defeat'; ui.state.outcome = 'defeat'; ui.state.phase = 'result';
    ui.action('restart');
    expect(ui.confirmReset).toBe(false);
    expect(ui.run.stage).toBe('battle');
    expect(ui.state.phase).toBe('combat');
  });
});
