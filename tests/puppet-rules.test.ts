import { describe, expect, it } from 'vitest';
import { INVENTORY_CELL_COUNT, INVENTORY_GRID_SIZE, inventoryColumn, inventoryRow } from '../src/combat/inventory.ts';
import { createItem } from '../src/combat/items.ts';
import { choosePuppetForm, defaultPuppetForm, getPuppetForm, getPuppetItemRules, getPuppetWindDrain, PUPPET_FORMS } from '../src/combat/puppets.ts';
import { createActor, createState, stepEncounter, transformHeroToPuppet } from '../src/combat/simulation.ts';

function puppet(slot: number, form: Parameters<typeof transformHeroToPuppet>[1]) {
  const hero = createActor(`hero-${slot}`, 'Герой', 'hero', slot, 10);
  hero.status = 'rebirthing';
  expect(transformHeroToPuppet(hero, form)).toBe(true);
  hero.status = 'active'; hero.windUpCharge = hero.maxWindUp;
  return hero;
}

describe('puppet rules and descriptions', () => {
  it('requires the complete cost of the overclock and its mechanical cell', () => {
    const hero = puppet(3, 'automaton-master');
    const blade = createItem('blade', 'blade', () => 0); blade.cell = 0;
    hero.items = [blade]; hero.puppetPassiveState.mechanicalActivations = 2;
    hero.windUpCharge = 5;
    expect(getPuppetItemRules(hero, blade)).toMatchObject({ outputMultiplier: 1, chargeCost: 1 });
    hero.windUpCharge = 6;
    expect(getPuppetItemRules(hero, blade)).toMatchObject({ outputMultiplier: 1.6, chargeCost: 6 });
  });

  it('charges only the available cost when the third mechanical attack fires', () => {
    const attack = (charge: number) => {
      const hero = puppet(3, 'automaton-master');
      const blade = createItem('blade', 'blade', () => 0); blade.cell = 0; blade.remainingMs = 0;
      hero.items = [blade]; hero.puppetPassiveState.mechanicalActivations = 2; hero.windUpCharge = charge;
      const enemy = createActor('enemy', 'Враг', 'enemy', 0, 1000); enemy.attackDamage = 0;
      const state = createState([hero], [enemy]);
      stepEncounter(state, 0);
      return { hero, damage: 1000 - enemy.hp };
    };
    const insufficient = attack(5);
    const sufficient = attack(6);
    expect(insufficient.hero.windUpCharge).toBe(4);
    expect(insufficient.hero.status).toBe('active');
    expect(sufficient.hero.windUpCharge).toBe(0);
    expect(sufficient.hero.status).toBe('stopped');
    expect(sufficient.damage).toBeGreaterThan(insufficient.damage);
  });

  it('explains the spring refund and oracle ally bonus', () => {
    const spring = puppet(2, 'spring-pilgrim');
    const springItem = createItem('blade', 'blade', () => 0); springItem.cell = 5; spring.items = [springItem];
    expect(getPuppetItemRules(spring, springItem).chargeRefund).toBe(2);
    expect(getPuppetWindDrain(spring)).toBeCloseTo(3.5 * .88);
    expect(getPuppetForm('spring-pilgrim')!.passiveDescription).toContain('возвращает 2');
    const oracle = puppet(3, 'gear-oracle');
    const oracleItem = createItem('blade', 'blade', () => 0); oracleItem.cell = 5; oracle.items = [oracleItem];
    oracle.puppetPassiveState.itemActivations = 3;
    expect(getPuppetItemRules(oracle, oracleItem).oracleCharge).toBe(20);
    expect(getPuppetForm('gear-oracle')!.passiveDescription).toContain('20');
    expect(getPuppetForm('gear-oracle')!.passiveDescription).toContain('друг');
  });

  it('validates random values and exposes three distinct forms for each class', () => {
    for (const heroClass of ['guard', 'huntress', 'pilgrim', 'clockmaker'] as const) {
      const choices = [0, .34, .99].map(roll => choosePuppetForm(heroClass, () => roll));
      expect(new Set(choices.map(form => form.branch)).size).toBe(3);
      expect(defaultPuppetForm(heroClass).heroClass).toBe(heroClass);
      for (const value of [Number.NaN, -0.1, 1, Infinity]) expect(() => choosePuppetForm(heroClass, () => value)).toThrow();
    }
  });

  it('keeps special cells inside the current grid and follows its diagonals', () => {
    for (const form of PUPPET_FORMS) for (const modifier of form.cellModifiers) {
      expect(modifier.cells).toHaveLength(INVENTORY_GRID_SIZE);
      expect(new Set(modifier.cells).size).toBe(INVENTORY_GRID_SIZE);
      expect(modifier.cells.every(cell => cell >= 0 && cell < INVENTORY_CELL_COUNT)).toBe(true);
    }
    const cells = getPuppetForm('automaton-master')!.cellModifiers[0]!.cells;
    expect(cells.every(cell => inventoryRow(cell) === inventoryColumn(cell))).toBe(true);
    const reverse = getPuppetForm('automaton-bastion')!.cellModifiers[0]!.cells;
    expect(reverse.every(cell => inventoryRow(cell) + inventoryColumn(cell) === INVENTORY_GRID_SIZE - 1)).toBe(true);
  });
});
