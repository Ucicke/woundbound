import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { beginRun, createRun } from '../src/combat/run.ts';
import { prepareEncounter, queueWinding, startBattle, stepEncounter } from '../src/combat/simulation.ts';

function randomFor(seed: number): () => number {
  seed = Math.imul(seed ^ seed >>> 16, 0x45d9f3b) >>> 0;
  return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
}

describe('opening fight pacing', () => {
  it('typically lasts at least 20 seconds with realistic winding and varied item rarities', () => {
    const times: number[] = [];
    let wins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const state = createFullEncounter({ random: randomFor(seed) });
      prepareEncounter(state);
      const run = createRun(state, randomFor(seed));
      expect(beginRun(run)).toBe(true);
      expect(startBattle(state)).toBe(true);
      let ms = 0;
      for (; ms < 90000 && state.outcome === 'ongoing'; ms += 50) {
        const doll = state.heroes.find(hero => hero.status === 'stopped');
        if (ms % 200 === 0 && doll) queueWinding(state, doll.id);
        stepEncounter(state, 50);
      }
      if (state.outcome === 'victory') wins++;
      times.push(ms / 1000);
    }
    times.sort((a, b) => a - b);
    expect(times[20]).toBeGreaterThanOrEqual(20);
    expect(times[100]).toBeGreaterThanOrEqual(20);
    expect(times[100]).toBeLessThan(45);
    expect(wins).toBeGreaterThanOrEqual(190);
  });
});
