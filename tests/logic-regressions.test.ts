import { describe, expect, it } from 'vitest';
import { createItem } from '../src/combat/items.ts';
import { itemBonuses } from '../src/combat/inventory.ts';
import { applyEffect, createActor, createState, heroArmor, MAX_ARMOR, queueWinding, stepEncounter, transformHeroToPuppet } from '../src/combat/simulation.ts';
import { getPuppetItemRules, registerPuppetItemTrigger } from '../src/combat/puppets.ts';
import { ItemDialogue } from '../src/presentation/itemDialogue.ts';

describe('game logic regressions', () => {
  it('continues the rebirth timer after a victory and between rooms', () => {
    const hero = createActor('hero-1', 'Страж', 'hero', 0, 10);
    const enemy = createActor('rat', 'Крыса', 'enemy', 0, 1);
    const state = createState([hero], [enemy]);
    applyEffect(state, hero.id, 'damage', 20);
    applyEffect(state, enemy.id, 'damage', 1);
    expect(state.outcome).toBe('victory');
    const remaining = hero.rebirthMs;
    stepEncounter(state, remaining - 50);
    expect(hero.status).toBe('rebirthing');
    state.phase = 'preparation'; state.outcome = 'ongoing';
    stepEncounter(state, 50);
    expect(hero.status).toBe('stopped');
    expect(state.events.filter(event => event.transition === 'puppet')).toHaveLength(1);
  });

  it('makes the penitent gain 50% more from the same wind roll at a durability cost', () => {
    const makeState = (penitent: boolean) => {
      const doll = createActor('pilgrim', 'Паломник', 'hero', 2, 10);
      doll.status = 'rebirthing';
      transformHeroToPuppet(doll, penitent ? 'winding-penitent' : 'spring-pilgrim');
      const helper = createActor('guard', 'Страж', 'hero', 0, 10);
      const enemy = createActor('rat', 'Крыса', 'enemy', 0, 100); enemy.attackDamage = 0;
      const state = createState([helper, doll], [enemy], 1234);
      queueWinding(state, doll.id); stepEncounter(state, 50);
      return doll;
    };
    const ordinary = makeState(false), penitent = makeState(true);
    expect(penitent.windUpCharge).toBe(Math.round(ordinary.windUpCharge * 1.5));
    expect(penitent.durability).toBe(penitent.maxDurability - 1);
  });

  it('applies the quiver bonus only to ranged items after rarity generation', () => {
    const quiver = createItem('hunter-quiver', 'quiver', () => 0);
    const bow = createItem('hunter-bow', 'bow', () => 0);
    const blade = createItem('blade', 'blade', () => 0);
    expect(itemBonuses(bow, [quiver, bow, blade]).damage).toBe(1);
    expect(itemBonuses(blade, [quiver, bow, blade]).damage).toBe(0);
  });

  it('counts only mechanical-cell activations for the master overclock', () => {
    const hero = createActor('clockmaker', 'Часовщица', 'hero', 3, 10);
    hero.status = 'rebirthing'; transformHeroToPuppet(hero, 'automaton-master');
    hero.status = 'active'; hero.windUpCharge = hero.maxWindUp;
    const mechanical = createItem('blade', 'mechanical', () => 0); mechanical.cell = 0;
    const normal = createItem('blade', 'normal', () => 0); normal.cell = 2;
    hero.items = [mechanical, normal];
    registerPuppetItemTrigger(hero, mechanical);
    registerPuppetItemTrigger(hero, normal);
    expect(getPuppetItemRules(hero, mechanical).outputMultiplier).toBe(1);
    registerPuppetItemTrigger(hero, mechanical);
    expect(getPuppetItemRules(hero, mechanical).outputMultiplier).toBe(1.6);
  });

  it('caps displayed armor and lets a dropped item react to final death at its former cell', () => {
    const hero = createActor('hero-1', 'Страж', 'hero', 0, 10);
    const enemy = createActor('rat', 'Крыса', 'enemy', 0, 10);
    const item = createItem('watchman-cuirass', 'armor', () => 0); item.cell = 7;
    item.passiveBonuses!.armor = 100; hero.items.push(item);
    expect(heroArmor(hero)).toBe(MAX_ARMOR);
    const state = createState([hero], [enemy]);
    hero.status = 'active'; hero.durability = 1; hero.windUpCharge = 10;
    applyEffect(state, hero.id, 'damage', 1);
    const event = state.events.find(e => e.transition === 'permadeath')!;
    const dialogue = new ItemDialogue(() => 0);
    dialogue.onCombatEvent(event, state, 1000);
    expect(dialogue.active).toMatchObject({ itemId: item.id, formerCell: 7, trigger: 'ownerDeath' });
  });
});
