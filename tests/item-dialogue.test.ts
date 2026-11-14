import { describe, expect, it } from 'vitest';
import { createActor, createState, stepEncounter } from '../src/combat/simulation.ts';
import { createItem } from '../src/combat/items.ts';
import { ItemDialogue } from '../src/presentation/itemDialogue.ts';

function encounter() {
  const hero = createActor('hero-1', 'Страж', 'hero', 0, 10);
  const blade = createItem('blade', 'blade-1', () => 0); blade.cell = 0; blade.remainingMs = 0;
  const stone = createItem('whetstone', 'stone-1', () => 0); stone.cell = 4;
  hero.items.push(blade, stone);
  const enemy = createActor('rat', 'Крыса', 'enemy', 0, 1); enemy.attackDamage = 0;
  return { state: createState([hero], [enemy]), hero, blade, stone };
}

describe('item dialogue', () => {
  it('reacts to an actual killing blow and respects the global cooldown', () => {
    const { state, blade } = encounter();
    stepEncounter(state, 50);
    const event = state.events.find(e => e.kind === 'item')!;
    expect(event.defeatedTarget).toBe(true);
    const dialogue = new ItemDialogue(() => 0);
    dialogue.onCombatEvent(event, state, 1000);
    expect(dialogue.active).toMatchObject({ trigger: 'kill', itemId: blade.id });
    dialogue.onPlayerInteraction(blade, 'hero-1', 1100);
    expect(dialogue.active?.trigger).toBe('kill');
    dialogue.tick(state, 4000);
    expect(dialogue.active).toBeUndefined();
  });

  it('reacts to a new neighbor and lets it answer only while they remain adjacent', () => {
    const { state, blade, stone } = encounter();
    stone.cell = 1;
    const dialogue = new ItemDialogue(() => 0);
    dialogue.onPlacement(stone, 'hero-1', new Set(), state, 1000);
    expect(dialogue.active).toMatchObject({ trigger: 'neighbor', itemId: blade.id });
    dialogue.tick(state, 4200);
    expect(dialogue.active).toMatchObject({ trigger: 'reply', itemId: stone.id });
    dialogue.reset();
    dialogue.onPlacement(stone, 'hero-1', new Set(), state, 5000);
    stone.cell = 4;
    dialogue.tick(state, 8200);
    expect(dialogue.active).toBeUndefined();
  });

  it('responds to owner rebirth and clears speech on reset', () => {
    const { state, hero } = encounter();
    const dialogue = new ItemDialogue(() => 0);
    dialogue.onCombatEvent({ kind: 'state', transition: 'rebirth', actorId: hero.id, sourceId: hero.id, sourceName: hero.name, targetId: hero.id, targetName: hero.name, amount: 0, message: '' }, state, 1000);
    expect(dialogue.active?.trigger).toBe('ownerDeath');
    dialogue.reset();
    expect(dialogue.active).toBeUndefined();
  });
});
