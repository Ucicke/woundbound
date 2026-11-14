import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { findPlacement, itemBonuses, moveItem } from '../src/combat/inventory.ts';
import { createItem } from '../src/combat/items.ts';
import { EXPANSION_ITEM_IDS } from '../src/combat/items.ts';
import { beginRun, calmWorkshopItem, claimReward, createRun, enterRoom, leaveWorkshop, nextRoomChoices, openRoute, resolveInfirmary, syncRun, windWorkshop } from '../src/combat/run.ts';
import { applyEffect, prepareEncounter, queueWinding, startBattle, stepEncounter, swapHeroPositions } from '../src/combat/simulation.ts';

function victory(run: ReturnType<typeof createRun>) {
  if (run.stage === 'opening') expect(beginRun(run)).toBe(true);
  expect(startBattle(run.encounter)).toBe(true);
  run.encounter.enemies.forEach(enemy => applyEffect(run.encounter, enemy.id, 'damage', enemy.maxHp));
  syncRun(run);
  if (run.stage === 'reward') {
    expect(run.offers).toHaveLength(3);
    expect(openRoute(run)).toBe(false);
    const rewardId = run.offers[0].id;
    expect(claimReward(run, rewardId)).toBe(true);
    expect(claimReward(run, rewardId)).toBe(false);
  }
}

describe('complete run', () => {
  it('guarantees the first post-battle reward contains a new playstyle item', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter, () => 0);
    expect(beginRun(run)).toBe(true); expect(startBattle(encounter)).toBe(true);
    encounter.enemies.forEach(enemy => applyEffect(encounter, enemy.id, 'damage', enemy.maxHp));
    syncRun(run);
    expect(run.stage).toBe('reward');
    expect(EXPANSION_ITEM_IDS).toContain(run.offers[0]?.definitionId);
  });

  it('starts fragile humans against rats and exposes every human to rebirth early', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    createRun(encounter);
    expect(encounter.heroes.every(hero => hero.maxHp * 10 === hero.maxDurability)).toBe(true);
    expect(encounter.enemies.every(enemy => enemy.name === 'Чумная крыса')).toBe(true);
    encounter.heroes.forEach(hero => { hero.items = []; });
    expect(startBattle(encounter)).toBe(true);
    const reborn = new Set<string>();
    for (let tick = 0; tick < 600 && encounter.outcome === 'ongoing'; tick++) {
      stepEncounter(encounter, 50);
      encounter.heroes.filter(hero => hero.status === 'rebirthing').forEach(hero => reborn.add(hero.id));
    }
    expect(reborn.size).toBe(4);
  });

  it('matches named combat rooms to their actual enemy types', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter); expect(beginRun(run)).toBe(true);
    run.room = 3; run.stage = 'route';
    expect(nextRoomChoices(run).find(choice => choice.id === 'battle-1')?.label).toBe('Капище культистов');
    expect(enterRoom(run, 'battle-1')).toBe(true);
    expect(encounter.enemies.every(enemy => enemy.name === 'Культист')).toBe(true);
    run.room = 6; run.stage = 'route';
    expect(nextRoomChoices(run).find(choice => choice.id === 'battle-1')?.label).toBe('Литейная автоматонов');
    expect(enterRoom(run, 'battle-1')).toBe(true);
    expect(encounter.enemies.every(enemy => enemy.name === 'Сломанный автоматон')).toBe(true);
  });

  it('preserves the party through choices, one reward, a workshop and the boss', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter, () => 0);
    const hero = encounter.heroes[3], lantern = hero.items[0];
    const blade = createItem('blade', 'test-blade'); blade.cell = 2; hero.items.push(blade);
    hero.status = 'stopped'; hero.wind = 0; hero.durability = 42;
    expect(itemBonuses(lantern, hero.items).cooldownFactor).toBe(1.5);
    victory(run); expect(run.stage).toBe('cleared');
    expect(openRoute(run)).toBe(true); expect(openRoute(run)).toBe(false);
    expect(enterRoom(run, 'cache')).toBe(true); expect(run.room).toBe(2);
    expect(new Set(run.offers.map(item => item.definitionId)).size).toBe(3);
    const reward = run.offers[0];
    expect(claimReward(run, reward.id)).toBe(true); expect(claimReward(run, reward.id)).toBe(false);
    expect(encounter.stash.filter(item => item.id === reward.id)).toHaveLength(1);
    expect(openRoute(run)).toBe(true); expect(enterRoom(run, 'workshop')).toBe(true);
    expect(windWorkshop(run)).toBe(true); expect(hero.wind).toBe(hero.maxWind); expect(hero.status).toBe('active');
    expect(calmWorkshopItem(run, lantern.id)).toBe(true); expect(calmWorkshopItem(run, lantern.id)).toBe(false);
    expect(itemBonuses(lantern, hero.items).cooldownFactor).toBe(1);
    expect(leaveWorkshop(run)).toBe(true); expect(leaveWorkshop(run)).toBe(false);
    for (let room = 4; room <= 10; room++) {
      expect(openRoute(run)).toBe(true);
      const choices = nextRoomChoices(run);
      expect(choices.length).toBe(room === 10 ? 1 : room === 5 ? 3 : 2);
      expect(enterRoom(run, room === 10 ? 'boss' : 'battle-0')).toBe(true);
      expect(run.room).toBe(room); expect(encounter.heroes[3]).toBe(hero);
      expect(hero.durability).toBe(42); expect(hero.items).toContain(lantern);
      if (room < 10) expect(encounter.enemies.length).toBeGreaterThanOrEqual(2);
      if (room === 10) {
        expect(startBattle(encounter)).toBe(true);
        const [boss, guard] = encounter.enemies;
        expect(boss.isBoss).toBe(true);
        expect(applyEffect(encounter, boss.id, 'damage', boss.maxHp)).toBe(true);
        expect(guard.status).toBe('enemy');
        syncRun(run);
      } else victory(run);
    }
    expect(run.stage).toBe('victory'); expect(openRoute(run)).toBe(false);
    expect(encounter.stash).toContain(reward);
  });

  it('ends when every surviving doll is stopped at zero wind and nobody can wind another', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter); expect(beginRun(run)).toBe(true);
    encounter.heroes.forEach(hero => { hero.status = 'stopped'; hero.durability = 1; hero.wind = 0; });
    expect(startBattle(encounter)).toBe(true);
    stepEncounter(encounter, 50);
    syncRun(run); expect(run.stage).toBe('defeat'); expect(openRoute(run)).toBe(false);
    expect(encounter.heroes.every(hero => hero.status === 'stopped')).toBe(true);
  });

  it('carries permanent deaths, floor items, injuries and rebirth timers into the next fight', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter); expect(beginRun(run)).toBe(true);
    const fallen = encounter.heroes[1], rebirthing = encounter.heroes[2];
    const dropped = fallen.items[0];
    fallen.status = 'active'; fallen.durability = 1; fallen.wind = 10;
    rebirthing.status = 'rebirthing'; rebirthing.rebirthMs = 1250;
    encounter.heroes[0].hp = 37;
    expect(startBattle(encounter)).toBe(true);
    applyEffect(encounter, fallen.id, 'damage', 1);
    encounter.enemies.forEach(enemy => applyEffect(encounter, enemy.id, 'damage', enemy.maxHp));
    syncRun(run);
    expect(run.stage).toBe('reward'); expect(claimReward(run, run.offers[0].id)).toBe(true);
    expect(openRoute(run)).toBe(true);
    expect(enterRoom(run, 'invalid')).toBe(false); expect(run.room).toBe(1);
    expect(enterRoom(run, 'battle-0')).toBe(true);
    expect(encounter.heroes[1]).toBe(fallen); expect(fallen.status).toBe('dead');
    expect(encounter.floor).toContain(dropped);
    expect(rebirthing.status).toBe('rebirthing'); expect(rebirthing.rebirthMs).toBe(1250);
    expect(encounter.heroes[0].hp).toBe(37); expect(encounter.phase).toBe('preparation');
  });

  it('allows exactly one infirmary choice and never repairs a permanently dead doll', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter, () => 0); expect(beginRun(run)).toBe(true);
    victory(run); openRoute(run); enterRoom(run, 'cache'); claimReward(run, run.offers[0].id);
    openRoute(run); enterRoom(run, 'workshop'); leaveWorkshop(run);
    openRoute(run); enterRoom(run, 'battle-0'); victory(run);
    openRoute(run); expect(enterRoom(run, 'event')).toBe(true);
    const human = encounter.heroes[0], doll = encounter.heroes[1], dead = encounter.heroes[2];
    human.hp = 40; doll.status = 'stopped'; doll.durability = 30; dead.status = 'dead'; dead.durability = 0;
    expect(resolveInfirmary(run, 'invalid')).toBe(false);
    expect(resolveInfirmary(run, 'repair')).toBe(true);
    expect(doll.durability).toBe(45); expect(human.hp).toBe(40); expect(dead.durability).toBe(0);
    expect(resolveInfirmary(run, 'heal')).toBe(false); expect(run.stage).toBe('cleared');
  });

  it('infirmary healing affects living humans only and never exceeds maximum health', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter); run.stage = 'event'; run.current = 'event';
    const human = encounter.heroes[0], doll = encounter.heroes[1], dead = encounter.heroes[2];
    human.hp = human.maxHp - 5; doll.status = 'stopped'; doll.hp = 0; dead.status = 'dead'; dead.hp = 0;
    expect(resolveInfirmary(run, 'heal')).toBe(true);
    expect(human.hp).toBe(human.maxHp); expect(doll.hp).toBe(0); expect(dead.hp).toBe(0);
  });

  it('can win a normal-number route using rewards, workshops and manual winding', () => {
    const encounter = createFullEncounter(); prepareEncounter(encounter);
    const run = createRun(encounter, () => 0); expect(beginRun(run)).toBe(true);
    expect(moveItem(encounter, 'item-1', 'hero-1', 0)).toBe(true);
    expect(swapHeroPositions(encounter, 1, 2)).toBe(true);
    const fight = () => {
      expect(startBattle(encounter)).toBe(true);
      for (let tick = 0; tick < 6000 && encounter.outcome === 'ongoing'; tick++) {
        for (const hero of encounter.heroes) if (hero.status === 'stopped') for (let click = 0; click < 20; click++) queueWinding(encounter, hero.id);
        stepEncounter(encounter, 50);
      }
      syncRun(run);
      expect(encounter.outcome, `room ${run.room}`).toBe('victory');
      if (run.stage === 'reward') {
        const reward = run.offers.find(item => item.definitionId === 'blade') ?? run.offers[0];
        expect(claimReward(run, reward.id)).toBe(true);
        const owner = encounter.heroes.find(hero => hero.status !== 'dead' && findPlacement(encounter, reward, hero.id) !== null);
        if (owner) expect(moveItem(encounter, reward.id, owner.id, findPlacement(encounter, reward, owner.id)!)).toBe(true);
      }
    };
    fight();
    for (let room = 2; room <= 10; room++) {
      expect(openRoute(run)).toBe(true);
      const position = (room - 1) % 3;
      const choice = room === 10 ? 'boss' : position === 1 ? 'cache' : position === 2 ? 'workshop' : 'battle-0';
      expect(enterRoom(run, choice)).toBe(true);
      if (choice === 'cache') {
        const reward = run.offers.find(item => item.definitionId === 'blade')!;
        expect(claimReward(run, reward.id)).toBe(true);
        const owner = encounter.heroes.find(hero => hero.status !== 'dead' && findPlacement(encounter, reward, hero.id) !== null)!;
        expect(moveItem(encounter, reward.id, owner.id, findPlacement(encounter, reward, owner.id)!)).toBe(true);
      } else if (choice === 'workshop') {
        expect(windWorkshop(run)).toBe(true);
        const lantern = encounter.heroes.flatMap(hero => hero.items).find(item => item.definitionId === 'lantern' && !item.calmed);
        if (lantern) expect(calmWorkshopItem(run, lantern.id)).toBe(true);
        expect(leaveWorkshop(run)).toBe(true);
      } else fight();
    }
    expect(run.stage).toBe('victory');
  });
});
