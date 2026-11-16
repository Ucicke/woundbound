import { describe, expect, it } from 'vitest';
import { ITEM_CLASS_GROUPS, EXPANSION_ITEM_IDS, createItem, itemDefinitionIds } from '../src/combat/items.ts';
import { itemBonuses, synergyTargets } from '../src/combat/inventory.ts';
import { createActor, heroArmor } from '../src/combat/simulation.ts';
import { GameUI } from '../src/ui/GameUI.ts';

describe('item catalog consistency', () => {
  it('defines class, category and unique ids for every item', () => {
    const ids = itemDefinitionIds();
    const groups = Object.entries(ITEM_CLASS_GROUPS).flatMap(([heroClass, group]) => group.map(id => ({ id, heroClass })));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(groups.map(entry => entry.id))).toEqual(new Set(ids));
    for (const { id, heroClass } of groups) {
      const item = createItem(id, `test-${id}`, () => 0);
      expect(item.classAffinity).toBe(heroClass);
      expect(item.category).toBeDefined();
      expect(item.damageType).toBeDefined();
    }
    expect(new Set(EXPANSION_ITEM_IDS).size).toBe(EXPANSION_ITEM_IDS.length);
    expect(EXPANSION_ITEM_IDS.every(id => ids.includes(id))).toBe(true);
  });

  it('uses explicit damage types, independently of adjacency tags', () => {
    expect(createItem('clockwork-coil', 'coil', () => 0).damageType).toBe('arcane');
    expect(createItem('lantern', 'lantern', () => 0).damageType).toBe('fire');
  });

  it('rejects invalid random values instead of silently generating a common item', () => {
    for (const value of [NaN, Infinity, -0.1, 1]) expect(() => createItem('blade', 'invalid', () => value)).toThrow();
  });

  it('preserves rarity fractions until combat rounds the combined armor', () => {
    const common = createItem('hunter-cloak', 'common', () => 0);
    const rare = createItem('hunter-cloak', 'rare', () => .8);
    expect(common.passiveBonuses?.armor).toBe(1);
    expect(rare.passiveBonuses?.armor).toBeCloseTo(1.35);
    const hero = createActor('hero', 'Герой', 'hero', 0, 10);
    hero.items = [rare, { ...rare, id: 'rare-2' }];
    expect(heroArmor(hero)).toBe(5); // 1.35 + 1.35 plus constitution bonus 2.
    expect(new GameUI().itemDescription(rare)).toContain('1,35');
  });

  it('uses the same synergy amount in descriptions and calculations', () => {
    const stone = createItem('whetstone', 'stone', () => 0); stone.cell = 0;
    const blade = createItem('blade', 'blade', () => 0); blade.cell = 2;
    const bonus = itemBonuses(blade, [blade, stone]).damage;
    expect(stone.description).toContain(String(bonus));
    expect(synergyTargets(stone).find(rule => rule.tag === 'blade')?.text).toContain(String(bonus));
  });
});
