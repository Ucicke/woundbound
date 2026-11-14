import { describe, expect, it } from 'vitest';
import { createFullEncounter } from '../src/combat/encounter.ts';
import { rotatedShape } from '../src/combat/inventory.ts';
import { createItem, itemDefinitionIds } from '../src/combat/items.ts';
import { ACTOR_ROWS, actorStateFrame, CLASS_ITEM_ART, ITEM_ATLAS_FRAME_SIZE } from '../src/presentation/ArtCatalog.ts';
import { itemFootprintBounds } from '../src/presentation/itemGeometry.ts';
import { projectAction, projectHero, stepEncounter } from '../src/combat/simulation.ts';

describe('item art geometry', () => {
  it('keeps the atlas frame order and footprint aligned with every item definition', () => {
    const catalog = CLASS_ITEM_ART;
    expect(new Set(Object.keys(catalog))).toEqual(new Set(itemDefinitionIds()));
    for (const id of itemDefinitionIds()) {
      const item = createItem(id, `test-${id}`);
      expect(item.shape?.length).toBeGreaterThan(0);
      const { content } = catalog[id as keyof typeof catalog];
      expect(content.x).toBeGreaterThanOrEqual(0);
      expect(content.y).toBeGreaterThanOrEqual(0);
      expect(content.x + content.width).toBeLessThanOrEqual(ITEM_ATLAS_FRAME_SIZE);
      expect(content.y + content.height).toBeLessThanOrEqual(ITEM_ATLAS_FRAME_SIZE);
    }
  });

  it('maps every actor archetype to six stable state frames', () => {
    expect(Object.keys(ACTOR_ROWS)).toHaveLength(8);
    expect(actorStateFrame('hero-1', 'idle')).toBe(0);
    expect(actorStateFrame('hero-1', 'death')).toBe(3);
    expect(actorStateFrame('hero-1', 'dollIdle')).toBe(4);
    expect(actorStateFrame('hero-4', 'dollAttack')).toBe(23);
    expect(actorStateFrame('rat', 'idle')).toBe(24);
    expect(actorStateFrame('boss', 'death')).toBe(45);
  });

  it('centers asymmetric footprints on their bounds and rotates their full shape', () => {
    const lShape = { id: 'l', name: 'L', damage: 1, cooldownMs: 1, remainingMs: 1, targetPolicy: 'front' as const, trigger: 'always' as const, shape: [[0, 0], [1, 0], [1, 1]] as const };
    const bounds = itemFootprintBounds(rotatedShape(lShape), 100, 200, 20);
    expect(bounds).toEqual({ left: 100, top: 200, right: 140, bottom: 240, centerX: 120, centerY: 220 });
    const turned = rotatedShape({ ...lShape, rotation: 1 });
    expect(turned).toEqual([[1, 0], [1, 1], [0, 1]]);
  });
});

describe('combat presentation projection', () => {
  it('projects the actual action source, target and result without changing model state', () => {
    const state = createFullEncounter();
    state.heroes[0].items[0].remainingMs = 0;
    stepEncounter(state, 50);
    const event = state.events.find(item => item.kind === 'item')!;
    const before = JSON.stringify(state);
    const view = projectAction(event);
    expect(view.sourceId).toBe(event.sourceId);
    expect(view.actorId).toBe(event.actorId);
    expect(view.targetId).toBe(event.targetId);
    expect(view.text).toContain(event.targetName);
    expect(view.text).toContain(String(event.amount));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('projects separate doll meters, cooldown and numeric rebirth without mutation', () => {
    const state = createFullEncounter();
    const hero = state.heroes[0]; hero.status = 'stopped'; hero.durability = 70; hero.wind = 35;
    const before = JSON.stringify(hero);
    expect(projectHero(hero)).toMatchObject({ durability: 70, wind: 35, cooldownMs: hero.items[0].remainingMs });
    hero.status = 'rebirthing'; hero.rebirthMs = 1250;
    expect(projectHero(hero).rebirthSeconds).toBe(1.25);
    hero.status = 'stopped'; hero.rebirthMs = 0;
    expect(JSON.stringify(hero)).toBe(before);
  });

  it('reports actual applied damage when the remaining target health is lower than the hit', () => {
    const state = createFullEncounter();
    state.enemies[0].hp = 3;
    state.heroes[0].items[0].remainingMs = 0;
    stepEncounter(state, 50);
    const event = state.events.find(item => item.sourceId === state.heroes[0].items[0].id)!;
    expect(event.amount).toBe(3);
    expect(projectAction(event).text).toContain('3 урона');
  });
});
