import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { applyEffect, attributeCooldownFactor, attributeModifier, heroArmorBreakdown, itemAttributeFactor, transformHeroToPuppet } from '../src/combat/simulation.ts';
import { createItem } from '../src/combat/items.ts';

describe('hero characteristics', () => {
  it('uses the usual score modifier and gives each class its own strengths', () => {
    expect(attributeModifier(9)).toBe(-1);
    expect(attributeModifier(16)).toBe(3);
    const state = createFullEncounter({ random: () => 0 });
    const [guard, huntress, pilgrim, clockmaker] = state.heroes;
    const weapon = createItem('blade', 'test-weapon', () => 0);
    expect(itemAttributeFactor(guard, weapon)).toBeCloseTo(1.15);
    expect(attributeCooldownFactor(huntress)).toBeCloseTo(.94);
    expect(itemAttributeFactor(pilgrim, { ...weapon, effect: 'heal' })).toBeCloseTo(1.15);
    expect(itemAttributeFactor(clockmaker, { ...weapon, category: 'relic' })).toBeCloseTo(1.15);
    expect(itemAttributeFactor(pilgrim, { ...weapon, effect: 'wind' })).toBeCloseTo(1.1);
  });

  it('reduces an incoming hit by the constitution modifier', () => {
    const state = createFullEncounter({ random: () => 0 });
    const guard = state.heroes[0];
    guard.items = [];
    expect(applyEffect(state, guard.id, 'damage', 5)).toBe(true);
    expect(guard.hp).toBe(guard.maxHp - 3);
  });

  it('shows armor sources and the same capped total that reduces damage', () => {
    const state = createFullEncounter({ random: () => 0 });
    const guard = state.heroes[0];
    guard.status = 'rebirthing';
    expect(transformHeroToPuppet(guard, 'automaton-bastion')).toBe(true);
    guard.items = [createItem('watchman-cuirass', 'test-armor', () => .99)];
    expect(heroArmorBreakdown(guard)).toEqual({ equipment: 7, constitution: 2, form: 3, total: 8 });
    expect(applyEffect(state, guard.id, 'damage', 13)).toBe(true);
    expect(guard.durability).toBe(guard.maxDurability - 5);
  });
});
