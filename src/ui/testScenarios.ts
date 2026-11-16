import { moveItem } from '../combat/inventory.ts';
import { applyEffect, startBattle, transformHeroToPuppet, type EncounterState } from '../combat/simulation.ts';
import type { RunState } from '../combat/run.ts';
import { COMBAT_CONFIG } from '../combat/config.ts';

export type TestModulePreview = 'active' | 'rebirth' | null;
export interface TestScenarioSettings { fastRun: boolean; modulePreview: TestModulePreview }

/** Test-only setup for manual canvas fixtures. Never imported by production entry points. */
export function loadTestScenario(state: EncounterState, run: RunState, scenario: string | null): TestScenarioSettings {
  const settings: TestScenarioSettings = { fastRun: false, modulePreview: null };
  if (!scenario) return settings;
  const hero = state.heroes[0]!;
  if (scenario === 'full-run') {
    settings.fastRun = true;
    run.random = () => 0;
    state.heroes[3]!.status = 'stopped'; state.heroes[3]!.windUpCharge = 0;
    prepareFastEncounter(state, settings.fastRun);
    return settings;
  }
  if (scenario === 'visual-winding') {
    state.heroes[3]!.status = 'stopped'; state.heroes[3]!.windUpCharge = 0;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10000; });
    return settings;
  }
  if (scenario === 'visual-clockmaker') {
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10000; });
    return settings;
  }
  if (scenario.startsWith('visual-module-')) {
    const clockmaker = state.heroes[3]!;
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 100000; });
    if (scenario === 'visual-module-rebirth') {
      clockmaker.status = 'rebirthing'; clockmaker.hp = 0; clockmaker.rebirthMs = COMBAT_CONFIG.rebirthMs / 2;
      settings.modulePreview = 'rebirth';
    } else if (scenario === 'visual-module-dead') {
      clockmaker.status = 'rebirthing'; clockmaker.hp = 0;
      transformHeroToPuppet(clockmaker);
      clockmaker.status = 'active'; clockmaker.durability = 1; clockmaker.windUpCharge = clockmaker.maxWindUp * .2;
      applyEffect(state, clockmaker.id, 'damage', 1);
    } else if (scenario === 'visual-module-active' || scenario === 'visual-module-stopped') {
      clockmaker.status = 'rebirthing'; clockmaker.hp = 0;
      transformHeroToPuppet(clockmaker);
      if (scenario === 'visual-module-active') {
        clockmaker.status = 'active'; clockmaker.windUpCharge = clockmaker.maxWindUp * .68;
        settings.modulePreview = 'active';
      }
    }
    return settings;
  }
  if (scenario === 'empty-backpack') { hero.items.splice(0); return settings; }
  moveItem(state, 'item-1', hero.id, 0);
  if (scenario === 'busy' || scenario === 'busy-result' || scenario === 'overflow') {
    moveItem(state, 'whetstone-1', state.heroes[0]!.id, 1);
    moveItem(state, 'spring-1', state.heroes[1]!.id, 1);
    moveItem(state, 'mercy-1', state.heroes[2]!.id, 1);
    moveItem(state, 'heart-1', state.heroes[3]!.id, 1);
    if (scenario === 'overflow') state.heroes.forEach((candidate, slot) => {
      const source = candidate.items[candidate.items.length - 1]!;
      for (let copy = 0; copy < 2; copy++) candidate.items.push({ ...source, id: `test-extra-${slot}-${copy}`, name: `${source.name} ${copy + 1}`, cell: copy + 2, remainingMs: 60_000, cooldownMs: 60_000 });
    });
  }
  startBattle(state);
  if (scenario === 'busy' || scenario === 'busy-result' || scenario === 'overflow') {
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10000; });
    if (scenario === 'busy-result') {
      state.enemies.forEach(enemy => { enemy.hp = 0; enemy.status = 'dead'; });
      state.outcome = 'victory'; state.phase = 'result';
    }
  } else if (scenario === 'winding') {
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; }); hero.status = 'stopped'; hero.windUpCharge = 0;
  } else if (scenario === 'drop') {
    hero.status = 'stopped'; hero.durability = 1;
    applyEffect(state, hero.id, 'damage', 1);
    state.enemies.forEach(enemy => applyEffect(state, enemy.id, 'damage', enemy.maxHp));
  } else if (scenario === 'defeat') {
    state.heroes.forEach(candidate => { candidate.status = 'stopped'; candidate.durability = 1; });
    state.heroes.forEach(candidate => applyEffect(state, candidate.id, 'damage', 1));
  } else if (scenario === 'log') {
    state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10000; });
    state.heroes.forEach(candidate => candidate.items.forEach(item => { item.cooldownMs = 250; item.remainingMs = 250; item.trigger = 'always'; item.reach = 'far'; }));
    state.events = Array.from({ length: 50 }, (_, index) => ({ sequence: index + 1, kind: 'state' as const, actorId: hero.id, sourceId: hero.id, sourceName: hero.name, targetId: hero.id, targetName: hero.name, amount: 0, message: `Тестовое событие ${index + 1}` }));
    state.nextEventSequence = 51;
  }
  return settings;
}

export function prepareFastEncounter(state: EncounterState, enabled: boolean): void {
  if (!enabled) return;
  state.enemies.forEach(enemy => { enemy.hp = enemy.maxHp = 1; enemy.attackDamage = 0; });
  state.heroes[1]!.items.forEach(item => { item.cooldownMs = item.remainingMs = 50; item.damage = 20; item.trigger = 'always'; item.reach = 'far'; });
}

export function tickTestScenario(state: EncounterState, preview: TestModulePreview): void {
  if (preview === 'rebirth' && state.heroes[3]?.status === 'rebirthing') state.heroes[3]!.rebirthMs = COMBAT_CONFIG.rebirthMs / 2;
  if (preview === 'active' && state.heroes[3]?.status === 'active') state.heroes[3]!.windUpCharge = state.heroes[3]!.maxWindUp * .68;
}
