import { areAdjacent } from '../combat/inventory.ts';
import type { CombatEvent, CombatItem, EncounterState } from '../combat/simulation.ts';

export type DialogueTrigger = 'kill' | 'ownerDeath' | 'neighbor' | 'reply' | 'player';
export interface ItemSpeech { itemId: string; heroId: string; text: string; trigger: DialogueTrigger; expiresAt: number; formerCell?: number }

const phrases: Record<DialogueTrigger, readonly string[]> = {
  kill: ['Ещё одна душа...', 'Ну вот, стало тише.'],
  ownerDeath: ['Хозяин? Не уходи...', 'Держись, я ещё здесь.'],
  neighbor: ['О, у меня сосед!', 'Надеюсь, ты не кусаешься?'],
  reply: ['Смотря кто спрашивает.', 'Не наступай на меня.'],
  player: ['Эй, осторожнее там!', 'Ты точно знаешь, что делаешь?'],
};
const characterPhrases: Record<string, Partial<Record<DialogueTrigger, readonly string[]>>> = {
  blade: { kill: ['Ещё крови!', 'Хороший удар, хозяин.'], ownerDeath: ['Вставай! Я ещё голоден.', 'Кто теперь меня понесёт?'] },
  lantern: { neighbor: ['Опять кто-то заслоняет свет!', 'Не подходи так близко.'], player: ['Эй, не тряси меня!', 'Думаешь, я тебя не вижу?'] },
};

/** Small rule-based personalities; dialogue is presentation only and never changes combat. */
export class ItemDialogue {
  active?: ItemSpeech;
  private lastSpokenAt = -Infinity;
  private itemLastSpoken = new Map<string, number>();
  private reply?: { heroId: string; itemId: string; neighborId: string; dueAt: number };

  constructor(private readonly random: () => number = Math.random) {}

  private randomValue(): number {
    let value: number;
    try { value = this.random(); } catch { return .5; }
    if (!Number.isFinite(value)) return .5;
    return Math.max(0, Math.min(1 - Number.EPSILON, value));
  }

  reset(): void { this.active = undefined; this.reply = undefined; this.lastSpokenAt = -Infinity; this.itemLastSpoken.clear(); }

  private say(item: CombatItem, heroId: string, trigger: DialogueTrigger, now: number, urgent = false): boolean {
    if (!urgent && (now - this.lastSpokenAt < 6500 || now - (this.itemLastSpoken.get(item.id) ?? -Infinity) < 12000)) return false;
    const choices = characterPhrases[item.definitionId ?? '']?.[trigger] ?? phrases[trigger];
    this.active = { itemId: item.id, heroId, trigger, text: choices[Math.floor(this.randomValue() * choices.length)]!, expiresAt: now + 3000 };
    this.lastSpokenAt = now; this.itemLastSpoken.set(item.id, now);
    return true;
  }

  onCombatEvent(event: CombatEvent, state: EncounterState, now: number): void {
    if (event.kind === 'state' && event.transition === 'rebirth') {
      const hero = state.heroes.find(candidate => candidate.id === event.actorId);
      const item = hero?.items[0];
      if (hero && item) { this.reply = undefined; this.say(item, hero.id, 'ownerDeath', now, true); }
    } else if (event.kind === 'state' && event.transition === 'permadeath') {
      const dropped = event.droppedItems?.[0];
      const item = state.floor.find(candidate => candidate.id === dropped?.id);
      if (item && dropped) {
        this.reply = undefined;
        if (this.say(item, event.actorId, 'ownerDeath', now, true) && this.active) this.active.formerCell = dropped.cell;
      }
    } else if (event.kind === 'item' && event.defeatedTarget && this.randomValue() < .55) {
      const hero = state.heroes.find(candidate => candidate.id === event.actorId);
      const item = hero?.items.find(candidate => candidate.id === event.sourceId);
      if (hero && item) this.say(item, hero.id, 'kill', now);
    }
  }

  onPlacement(item: CombatItem, heroId: string, oldNeighbors: Set<string>, state: EncounterState, now: number): void {
    const hero = state.heroes.find(candidate => candidate.id === heroId);
    const neighbor = hero?.items.find(other => other.id !== item.id && !oldNeighbors.has(other.id) && areAdjacent(item, other));
    if (neighbor && this.say(neighbor, heroId, 'neighbor', now)) {
      this.reply = { heroId, itemId: item.id, neighborId: neighbor.id, dueAt: now + 3200 };
    } else if (!neighbor && this.randomValue() < .35) this.say(item, heroId, 'player', now);
  }

  onPlayerInteraction(item: CombatItem, heroId: string, now: number): void {
    if (this.randomValue() < .35) this.say(item, heroId, 'player', now);
  }

  tick(state: EncounterState, now: number): void {
    if (this.active && this.active.expiresAt <= now) this.active = undefined;
    if (!this.reply || now < this.reply.dueAt) return;
    const { heroId, itemId, neighborId } = this.reply; this.reply = undefined;
    const hero = state.heroes.find(candidate => candidate.id === heroId);
    const item = hero?.items.find(candidate => candidate.id === itemId);
    const neighbor = hero?.items.find(candidate => candidate.id === neighborId);
    if (item && neighbor && areAdjacent(item, neighbor)) this.say(item, heroId, 'reply', now, true);
  }
}
