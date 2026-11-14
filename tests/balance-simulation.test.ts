import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { createRun, enterRoom } from '../src/combat/run.ts';
import { prepareEncounter } from '../src/combat/simulation.ts';
import { simulateBalanceRun, summarizeBalanceRuns, type BalanceAgent } from '../src/combat/balanceSimulation.ts';

const agents: BalanceAgent[] = ['random', 'synergy', 'balanced'];

describe('run balance simulation', () => {
  it('raises enemy pressure by floor and gives the boss a higher final profile', () => {
    const state = createFullEncounter({ random: () => 0.25 });
    prepareEncounter(state);
    const run = createRun(state, () => 0.25);
    run.stage = 'route';
    let previousHealth = 0;
    let previousRoomHealth = 0;
    let previousDamage = 0;
    let previousCooldown = Number.POSITIVE_INFINITY;

    for (let room = 1; room <= 9; room++) {
      if (room > 1) {
        run.room = room - 1;
        run.stage = 'route';
        expect(enterRoom(run, 'battle-0')).toBe(true);
      }
      const first = state.enemies[0]!;
      const roomHealth = state.enemies.reduce((sum, enemy) => sum + enemy.maxHp, 0);
      expect(first.maxHp).toBeGreaterThan(previousHealth);
      expect(roomHealth).toBeGreaterThan(previousRoomHealth);
      expect(first.attackDamage).toBeGreaterThanOrEqual(previousDamage);
      expect(first.attackCooldownMs).toBeLessThanOrEqual(previousCooldown);
      previousHealth = first.maxHp;
      previousRoomHealth = roomHealth;
      previousDamage = first.attackDamage;
      previousCooldown = first.attackCooldownMs;
    }

    run.room = 9;
    run.stage = 'route';
    expect(enterRoom(run, 'boss')).toBe(true);
    expect(state.enemies[0]!.isBoss).toBe(true);
    expect(state.enemies[0]!.maxHp).toBeGreaterThan(previousHealth * 2);
    expect(state.enemies[0]!.attackDamage).toBeGreaterThan(previousDamage);
    expect(state.enemies[1]!.maxHp).toBeGreaterThan(previousHealth);
  });

  it('plays complete seeded runs with random, synergy, and balanced loadout agents', () => {
    const sampleSizes: Record<BalanceAgent, number> = { random: 20, synergy: 6, balanced: 6 };
    const seedBases: Record<BalanceAgent, number> = { random: 10_000, synergy: 20_000, balanced: 30_000 };
    const summaries = new Map<BalanceAgent, ReturnType<typeof summarizeBalanceRuns>>();

    for (const agent of agents) {
      const results = Array.from({ length: sampleSizes[agent] }, (_, index) => simulateBalanceRun(agent, seedBases[agent] + index));
      const summary = summarizeBalanceRuns(results);
      const winRate = summary.wins / summary.runs;
      summaries.set(agent, summary);
      console.info(`[balance] ${agent}: ${(winRate * 100).toFixed(1)}% (${summary.wins}/${summary.runs}), boss ${summary.bossAttempts}/${summary.runs}, rooms ${summary.averageRooms.toFixed(1)}, run ${summary.averageSeconds.toFixed(0)}s, boss ${summary.averageBossSeconds.toFixed(0)}s, timeouts ${summary.timeouts}`);
      expect(results).toHaveLength(sampleSizes[agent]);
      expect(summary.timeouts, `${agent} simulator timeouts`).toBe(0);
      expect(results.every(result => result.rooms.length > 0)).toBe(true);
    }

    const randomRate = summaries.get('random')!.wins / sampleSizes.random;
    const bestRate = summaries.get('synergy')!.wins / sampleSizes.synergy;
    const middleRate = summaries.get('balanced')!.wins / sampleSizes.balanced;
    expect(randomRate).toBeGreaterThanOrEqual(0.005); // 1–2 wins in 200 runs (0.5–1%).
    expect(randomRate).toBeLessThanOrEqual(0.01);
    expect(bestRate).toBeGreaterThanOrEqual(0.75);
    expect(bestRate).toBeLessThanOrEqual(0.85);
    expect(middleRate).toBeGreaterThanOrEqual(0.15);
    expect(middleRate).toBeLessThanOrEqual(0.3);
  }, 300_000);
});
