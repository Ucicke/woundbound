/// <reference types="vite/client" />
import { createFullEncounter } from '../combat/encounter.ts';
import { areAdjacent, canPlaceItem, itemBonuses, moveItem, occupiedCells, rotateItemInInventory, storeItem } from '../combat/inventory.ts';
import { applyEffect, prepareEncounter, queueWinding, startBattle, type CombatEvent, type CombatItem, type Combatant, type EncounterState } from '../combat/simulation.ts';
import { beginRun, calmWorkshopItem, claimReward, createRun, enterRoom, leaveWorkshop, nextRoomChoices, openRoute, resolveInfirmary, syncRun, windWorkshop, type RunState } from '../combat/run.ts';
import { ITEM_CATEGORY_LABELS, ITEM_CLASS_LABELS } from '../combat/items.ts';
import { ItemDialogue } from '../presentation/itemDialogue.ts';

/** Game state and player commands. Phaser renders this model; this class has no DOM dependency. */
export class GameUI {
  state: EncounterState;
  readonly run: RunState;
  selectedItem: string | null = null;
  message = '';
  confirmReset = false;
  paused = false;
  latestAction?: CombatEvent;
  highlightUntil = 0;
  readonly dialogue = new ItemDialogue();
  private dialogueSequence = 0;
  private fastRun = false;

  constructor() {
    this.state = this.freshEncounter();
    this.run = createRun(this.state);
    if (import.meta.env.MODE === 'test' && typeof location !== 'undefined') this.loadTestScenario(new URLSearchParams(location.search).get('scenario'));
  }

  private freshEncounter(): EncounterState {
    const state = createFullEncounter();
    prepareEncounter(state);
    return state;
  }

  private loadTestScenario(scenario: string | null): void {
    if (!scenario) return;
    const hero = this.state.heroes[0]!;
    if (scenario === 'full-run') {
      this.fastRun = true;
      this.run.random = () => 0;
      this.state.heroes[3]!.status = 'stopped'; this.state.heroes[3]!.wind = 0;
      this.prepareFastEncounter();
      return;
    }
    if (scenario === 'empty-backpack') { hero.items.splice(0); return; }
    moveItem(this.state, 'item-1', hero.id, 0);
    if (scenario === 'busy' || scenario === 'busy-result' || scenario === 'overflow') {
      moveItem(this.state, 'whetstone-1', this.state.heroes[0]!.id, 1);
      moveItem(this.state, 'spring-1', this.state.heroes[1]!.id, 1);
      moveItem(this.state, 'mercy-1', this.state.heroes[2]!.id, 1);
      moveItem(this.state, 'heart-1', this.state.heroes[3]!.id, 1);
      if (scenario === 'overflow') this.state.heroes.forEach((candidate, slot) => {
        const source = candidate.items[candidate.items.length - 1]!;
        for (let copy = 0; copy < 2; copy++) candidate.items.push({ ...source, id: `test-extra-${slot}-${copy}`, name: `${source.name} ${copy + 1}`, cell: copy + 2, remainingMs: 60_000, cooldownMs: 60_000 });
      });
    }
    startBattle(this.state);
    if (scenario === 'busy' || scenario === 'busy-result' || scenario === 'overflow') {
      this.state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10000; });
      if (scenario === 'busy-result') {
        this.state.enemies.forEach(enemy => { enemy.hp = 0; enemy.status = 'dead'; });
        this.state.outcome = 'victory'; this.state.phase = 'result';
      }
    } else if (scenario === 'winding') {
      this.state.enemies.forEach(enemy => { enemy.attackDamage = 0; }); hero.status = 'stopped'; hero.wind = 0;
    } else if (scenario === 'drop') {
      hero.status = 'stopped'; hero.durability = 1;
      applyEffect(this.state, hero.id, 'damage', 1);
      this.state.enemies.forEach(enemy => applyEffect(this.state, enemy.id, 'damage', enemy.maxHp));
    } else if (scenario === 'defeat') {
      this.state.heroes.forEach(candidate => { candidate.status = 'stopped'; candidate.durability = 1; });
      this.state.heroes.forEach(candidate => applyEffect(this.state, candidate.id, 'damage', 1));
    } else if (scenario === 'log') {
      this.state.enemies.forEach(enemy => { enemy.attackDamage = 0; enemy.hp = enemy.maxHp = 10000; });
      this.state.heroes.forEach(candidate => candidate.items.forEach(item => { item.cooldownMs = 250; item.remainingMs = 250; item.trigger = 'always'; item.reach = 'far'; }));
      this.state.events = Array.from({ length: 50 }, (_, index) => ({ sequence: index + 1, kind: 'state' as const, actorId: hero.id, sourceId: hero.id, sourceName: hero.name, targetId: hero.id, targetName: hero.name, amount: 0, message: `Тестовое событие ${index + 1}` }));
      this.state.nextEventSequence = 51;
    }
  }

  private prepareFastEncounter(): void {
    if (!this.fastRun) return;
    this.state.enemies.forEach(enemy => { enemy.hp = enemy.maxHp = 1; enemy.attackDamage = 0; });
    this.state.heroes[1]!.items.forEach(item => { item.cooldownMs = item.remainingMs = 50; item.damage = 20; item.trigger = 'always'; item.reach = 'far'; });
  }

  get roomChoices() { return nextRoomChoices(this.run); }
  get allItems(): CombatItem[] { return [...this.state.stash, ...this.state.floor, ...this.state.heroes.flatMap(hero => hero.items)]; }

  tick(): void {
    const now = performance.now();
    for (const event of this.state.events) {
      if (!event.sequence || event.sequence <= this.dialogueSequence) continue;
      this.dialogueSequence = event.sequence;
      this.dialogue.onCombatEvent(event, this.state, now);
    }
    this.dialogue.tick(this.state, now);
    syncRun(this.run);
    const latest = [...this.state.events].reverse().find(event => event.kind === 'item' || event.kind === 'enemy');
    if (latest && latest !== this.latestAction) { this.latestAction = latest; this.highlightUntil = performance.now() + 700; }
  }

  setPaused(paused: boolean): void { this.paused = paused; }
  get dialogOpen(): boolean { return this.confirmReset; }

  itemDescription(item: CombatItem, hero?: Combatant): string {
    const bonuses = hero ? itemBonuses(item, hero.items) : { damage: 0, cooldownFactor: 1, healing: 0, wind: 0, descriptions: [] };
    const identity = item.classAffinity && item.category
      ? `Тема: ${ITEM_CLASS_LABELS[item.classAffinity]} · тип: ${ITEM_CATEGORY_LABELS[item.category].toLowerCase()}. `
      : '';
    if (item.trigger === 'passive' || item.effect === 'passive') {
      const passive = item.passiveBonuses;
      const stats = [
        ...(passive?.armor ? [`Броня: −${passive.armor} урона за удар`] : []),
        ...(passive?.damage ? [`Урон вещей: +${passive.damage}`] : []),
        ...(passive?.healing ? [`Лечение: +${passive.healing}`] : []),
        ...(passive?.wind ? [`Подзавод: +${passive.wind}`] : []),
        ...(passive?.cooldownFactor ? [`Кулдаун: −${Math.round((1 - passive.cooldownFactor) * 100)}%`] : []),
      ];
      return `${identity}${item.description ?? 'Пассивное свойство.'} ${stats.join('; ')}.`;
    }
    const cooldown = item.cooldownMs * bonuses.cooldownFactor / 1000;
    const amount = item.effect === 'wind'
      ? `Подзавод: ${(item.windAmount ?? item.damage) + bonuses.wind}.`
      : item.effect === 'heal'
        ? `Лечение: ${item.damage + bonuses.healing}.`
        : `Урон: ${item.damage + bonuses.damage}.`;
    const reach = (!item.effect || item.effect === 'damage') && item.reach === 'near' ? ' Владелец сам приближается к переднему врагу.' : '';
    return `${identity}${item.description ?? 'Автоматическое действие.'}${item.calmed ? ' Предмет успокоен.' : ''} ${amount}${reach} Кулдаун: ${(item.cooldownMs / 1000).toFixed(1)} с${bonuses.cooldownFactor !== 1 ? ` → ${cooldown.toFixed(1)} с` : ''}.${bonuses.descriptions.length ? ` ${bonuses.descriptions.join('; ')}.` : ''}`;
  }

  selectItem(itemId: string): void {
    this.selectedItem = this.selectedItem === itemId ? null : itemId;
    this.message = this.selectedItem ? 'Перетащите вещь в рюкзак' : '';
  }

  clickCell(heroId: string, cell: number): void {
    if (this.state.phase === 'combat' || this.confirmReset) return;
    const hero = this.state.heroes.find(candidate => candidate.id === heroId);
    if (!hero) return;
    const occupied = hero.items.find(item => occupiedCells(item, item.cell ?? 0)?.includes(cell));
    if (!this.selectedItem && occupied) this.selectItem(occupied.id);
    else if (this.selectedItem && occupied?.id === this.selectedItem) { this.selectedItem = null; this.message = 'Выбор снят'; }
    else if (this.selectedItem && this.dropItem(this.selectedItem, hero.id, cell)) { this.selectedItem = null; this.message = 'Предмет размещён'; }
    else this.message = 'Предмет не помещается: проверьте форму и занятые клетки.';
  }

  dropItem(itemId: string, heroId: string, anchor: number, reward = false): boolean {
    const item = reward ? this.run.offers.find(candidate => candidate.id === itemId) : this.allItems.find(candidate => candidate.id === itemId);
    if (!item || !canPlaceItem(this.state, item, heroId, anchor)) { this.message = 'Предмет не помещается: проверьте границы и занятые клетки.'; return false; }
    const oldOwner = this.state.heroes.find(hero => hero.items.includes(item));
    const oldNeighbors = new Set(oldOwner?.id === heroId ? oldOwner.items.filter(other => other !== item && areAdjacent(item, other)).map(other => other.id) : []);
    if (reward && !claimReward(this.run, itemId)) return false;
    if (!moveItem(this.state, itemId, heroId, anchor)) return false;
    this.dialogue.onPlacement(item, heroId, oldNeighbors, this.state, performance.now());
    this.selectedItem = null; this.message = 'Предмет размещён'; return true;
  }

  dropToStash(itemId: string): boolean {
    if (!storeItem(this.state, itemId)) return false;
    if (this.selectedItem === itemId) this.selectedItem = null;
    this.message = 'Предмет убран в запас'; return true;
  }

  rotateItem(itemId: string): boolean {
    const owner = this.state.heroes.find(hero => hero.items.some(item => item.id === itemId));
    const item = owner?.items.find(candidate => candidate.id === itemId);
    const oldNeighbors = new Set(item && owner ? owner.items.filter(other => other !== item && areAdjacent(item, other)).map(other => other.id) : []);
    const ok = rotateItemInInventory(this.state, itemId);
    if (ok && item && owner) {
      if (owner.items.some(other => other !== item && !oldNeighbors.has(other.id) && areAdjacent(item, other))) this.dialogue.onPlacement(item, owner.id, oldNeighbors, this.state, performance.now());
      else this.dialogue.onPlayerInteraction(item, owner.id, performance.now());
    }
    this.message = ok ? 'Поворот на 90°' : 'В таком положении предмет не помещается';
    return ok;
  }

  action(name: string, value = ''): void {
    if (this.confirmReset && name !== 'cancel-reset' && name !== 'confirm-reset') return;
    if (name === 'item') this.selectItem(value);
    else if (name === 'cell') { const [heroId, raw] = value.split(':'); this.clickCell(heroId ?? '', Number(raw)); }
    else if (name === 'rotate' && this.selectedItem) this.rotateItem(this.selectedItem);
    else if (name === 'begin-run') {
      if (beginRun(this.run) && startBattle(this.state)) { this.selectedItem = null; this.message = ''; }
    }
    else if (name === 'route') { if (openRoute(this.run)) { this.selectedItem = null; this.message = ''; } }
    else if (name === 'room') {
      if (enterRoom(this.run, value)) {
        this.selectedItem = null; this.message = '';
        if (this.run.stage === 'battle') { this.prepareFastEncounter(); startBattle(this.state); }
      }
    } else if (name === 'claim') { if (claimReward(this.run, value)) this.message = 'Предмет добавлен в запас'; }
    else if (name === 'workshop-wind') { if (windWorkshop(this.run)) this.message = 'Завод восстановлен; прочность не изменилась'; }
    else if (name === 'calm') { if (calmWorkshopItem(this.run, value)) this.message = 'Предмет успокоен'; }
    else if (name === 'leave-workshop') { if (leaveWorkshop(this.run)) this.message = 'Работа мастерской завершена'; }
    else if (name === 'event-choice') { if (resolveInfirmary(this.run, value)) this.message = value === 'heal' ? 'Люди получили лечение' : 'Куклы починены'; }
    else if (name === 'store') this.dropToStash(value);
    else if (name === 'wind') queueWinding(this.state, value);
    else if (name === 'restart') this.confirmReset = true;
    else if (name === 'cancel-reset') this.confirmReset = false;
    else if (name === 'confirm-reset') {
      this.state = this.freshEncounter();
      Object.assign(this.run, createRun(this.state));
      this.prepareFastEncounter(); this.selectedItem = null; this.confirmReset = false;
      this.message = ''; this.latestAction = undefined; this.highlightUntil = 0; this.paused = false;
      this.dialogue.reset(); this.dialogueSequence = 0;
    }
  }
}
