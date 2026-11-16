/// <reference types="vite/client" />
import { createFullEncounter } from '../combat/encounter.ts';
import { areAdjacent, canPlaceItem, INVENTORY_CELL_COUNT, itemBonuses, moveItem, occupiedCells, rotateItemInInventory, storeItem } from '../combat/inventory.ts';
import { attributeCooldownFactor, itemAttributeFactor, heroClassForActor, prepareEncounter, queueWinding, type CombatEvent, type CombatItem, type Combatant, type EncounterState } from '../combat/simulation.ts';
import { beginRun, calmWorkshopItem, claimReward, createRun, enterRoom, leaveWorkshop, nextRoomChoices, openRoute, resolveInfirmary, syncRun, windWorkshop, type RunState } from '../combat/run.ts';
import { ITEM_CATEGORY_LABELS, ITEM_CLASS_LABELS } from '../combat/items.ts';
import { ItemDialogue } from '../presentation/itemDialogue.ts';
import { COMBAT_CONFIG } from '../combat/config.ts';
import { formatItemNumber } from '../combat/formatNumber.ts';
import { getPuppetItemCellModifiers, getPuppetItemRules } from '../combat/puppets.ts';
import { loadAudioSettings, saveAudioSettings, type AudioChannel } from '../presentation/AudioSettings.ts';
import { loadTestScenario, prepareFastEncounter as prepareTestEncounter, tickTestScenario, type TestModulePreview } from './testScenarios.ts';

const gameActions = new Set([
  'item', 'cell', 'rotate', 'toggle-start-loadout', 'set-start-loadout', 'begin-run', 'route', 'room', 'claim',
  'workshop-wind', 'calm', 'leave-workshop', 'event-choice', 'store', 'wind', 'help', 'options', 'audio-mute',
  'hero-info', 'close-hero-info', 'restart', 'cancel-reset', 'confirm-reset',
]);

/** Game state and player commands. Phaser renders this model; this class has no DOM dependency. */
export class GameUI {
  state: EncounterState;
  readonly run: RunState;
  startingLoadout: 'starter' | 'full' = 'starter';
  startLoadoutMenuOpen = false;
  selectedItem: string | null = null;
  message = '';
  confirmReset = false;
  paused = false;
  helpOpen = false;
  optionsOpen = false;
  readonly audioSettings = loadAudioSettings();
  heroInfoId: string | null = null;
  latestAction?: CombatEvent;
  highlightUntil = 0;
  readonly dialogue = new ItemDialogue();
  private dialogueSequence = 0;
  private fastRun = false;
  private modulePreview: TestModulePreview = null;

  constructor() {
    this.state = this.freshEncounter();
    this.run = createRun(this.state);
    if (import.meta.env.MODE === 'test' && typeof location !== 'undefined') {
      const settings = loadTestScenario(this.state, this.run, new URLSearchParams(location.search).get('scenario'));
      this.fastRun = settings.fastRun;
      this.modulePreview = settings.modulePreview;
    }
  }

  private freshEncounter(): EncounterState {
    const state = createFullEncounter({ fullStartingInventory: this.startingLoadout === 'full' });
    prepareEncounter(state);
    return state;
  }

  private prepareFastEncounter(): void { prepareTestEncounter(this.state, this.fastRun); }

  get roomChoices() { return nextRoomChoices(this.run); }
  get allItems(): CombatItem[] { return [...this.state.stash, ...this.state.floor, ...this.state.heroes.flatMap(hero => hero.items)]; }

  tick(): void {
    tickTestScenario(this.state, this.modulePreview);
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
  get dialogOpen(): boolean { return this.confirmReset || this.helpOpen || this.optionsOpen || this.heroInfoId !== null; }

  setAudioVolume(channel: AudioChannel, value: number): void {
    this.audioSettings[channel] = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    this.audioSettings[`${channel}Muted`] = false;
    saveAudioSettings(this.audioSettings);
  }

  itemDescription(item: CombatItem, hero?: Combatant): string {
    const ownerAffinity = hero ? heroClassForActor(hero) : undefined;
    const nativeFactor = ownerAffinity && item.classAffinity === ownerAffinity ? COMBAT_CONFIG.classAffinityMultiplier : 1;
    const bonuses = hero ? itemBonuses(item, hero.items, ownerAffinity) : { damage: 0, cooldownFactor: 1, healing: 0, wind: 0, descriptions: [] };
    const puppetRules = hero ? getPuppetItemRules(hero, item) : { outputMultiplier: 1, cooldownMultiplier: 1, chargeCost: 0, chargeRefund: 0, adjacentCooldownReductionMs: 0, oracleCharge: 0, durabilityRepair: 0 };
    const puppetCells = hero ? getPuppetItemCellModifiers(hero, item).map(modifier => modifier.label) : [];
    const identity = item.classAffinity && item.category
      ? `Тема: ${ITEM_CLASS_LABELS[item.classAffinity]} · тип: ${ITEM_CATEGORY_LABELS[item.category].toLowerCase()}. Родное снаряжение усиливает эффект на ${Math.round((COMBAT_CONFIG.classAffinityMultiplier - 1) * 100)}%. `
      : '';
    if (item.trigger === 'passive' || item.effect === 'passive') {
      const passive = item.passiveBonuses;
      const stats = [
        ...(passive?.armor ? [`Броня: +${formatItemNumber(passive.armor * nativeFactor)} к общей броне`] : []),
        ...(passive?.damage ? [`Урон ${passive.damageReach === 'far' ? 'дальних вещей' : 'вещей'}: +${formatItemNumber(passive.damage * nativeFactor)}`] : []),
        ...(passive?.healing ? [`Лечение: +${formatItemNumber(passive.healing * nativeFactor)}`] : []),
        ...(passive?.wind ? [`Подзавод: +${formatItemNumber(passive.wind * nativeFactor)}`] : []),
        ...(passive?.cooldownFactor ? [`Кулдаун: −${Math.round(Math.min(.5, (1 - passive.cooldownFactor) * nativeFactor) * 100)}%`] : []),
      ];
      return `${identity}${item.description ?? 'Пассивное свойство.'} ${stats.join('; ')}.${puppetCells.length ? ` Ячейки формы: ${puppetCells.join(' ')}` : ''}`;
    }
    const statFactor = hero ? itemAttributeFactor(hero, item) : 1;
    const cooldownFactor = bonuses.cooldownFactor * puppetRules.cooldownMultiplier * (hero ? attributeCooldownFactor(hero) : 1);
    const cooldown = item.cooldownMs * cooldownFactor / 1000;
    const amount = item.effect === 'wind'
      ? `Подзавод: ${Math.round(((item.windAmount ?? item.damage) + bonuses.wind) * nativeFactor * puppetRules.outputMultiplier * statFactor)}.`
      : item.effect === 'heal'
        ? `Лечение: ${Math.round((item.damage + bonuses.healing) * nativeFactor * puppetRules.outputMultiplier * statFactor)}.`
        : `Урон: ${Math.round((item.damage + bonuses.damage) * nativeFactor * puppetRules.outputMultiplier * statFactor)}.`;
    const reach = (!item.effect || item.effect === 'damage') && item.reach === 'near' ? ' Владелец сам приближается к переднему врагу.' : '';
    return `${identity}${item.description ?? 'Автоматическое действие.'}${item.calmed ? ' Предмет успокоен.' : ''} ${amount}${reach} Кулдаун: ${(item.cooldownMs / 1000).toFixed(1)} с${cooldownFactor !== 1 ? ` → ${cooldown.toFixed(1)} с` : ''}.${bonuses.descriptions.length ? ` ${bonuses.descriptions.join('; ')}.` : ''}${puppetCells.length ? ` Ячейки формы: ${puppetCells.join(' ')}` : ''}`;
  }

  selectItem(itemId: string): void {
    if (!this.allItems.some(item => item.id === itemId)) return;
    this.selectedItem = this.selectedItem === itemId ? null : itemId;
    this.message = this.selectedItem ? 'Перетащите вещь в рюкзак' : '';
  }

  clickCell(heroId: string, cell: number): void {
    if (this.state.phase === 'combat' || this.confirmReset || !Number.isInteger(cell) || cell < 0 || cell >= INVENTORY_CELL_COUNT) return;
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
    if (reward ? !claimReward(this.run, itemId, { heroId, cell: anchor }) : !moveItem(this.state, itemId, heroId, anchor)) return false;
    this.dialogue.onPlacement(item, heroId, oldNeighbors, this.state, performance.now());
    this.selectedItem = null; this.message = 'Предмет размещён'; return true;
  }

  dropToStash(itemId: string): boolean {
    if (!storeItem(this.state, itemId)) return false;
    if (this.selectedItem === itemId) this.selectedItem = null;
    this.message = 'Предмет оставлен на полу'; return true;
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
    if (!gameActions.has(name)) return;
    if (name === 'set-start-loadout' && value !== 'starter' && value !== 'full') return;
    if (this.confirmReset && name !== 'cancel-reset' && name !== 'confirm-reset') return;
    if (name === 'item') this.selectItem(value);
    else if (name === 'cell') {
      const match = /^([^:]+):(\d+)$/.exec(value);
      const cell = match ? Number(match[2]) : NaN;
      if (match && Number.isSafeInteger(cell)) this.clickCell(match[1]!, cell);
    }
    else if (name === 'rotate' && this.selectedItem) this.rotateItem(this.selectedItem);
    else if (name === 'toggle-start-loadout' && this.run.stage === 'opening') this.startLoadoutMenuOpen = !this.startLoadoutMenuOpen;
    else if (name === 'set-start-loadout' && this.run.stage === 'opening') {
      const loadout = value === 'starter' ? 'starter' : 'full';
      if (loadout !== this.startingLoadout) {
        this.startingLoadout = loadout;
        this.state = this.freshEncounter();
        Object.assign(this.run, createRun(this.state));
        this.selectedItem = null; this.message = ''; this.latestAction = undefined; this.highlightUntil = 0;
      }
      this.startLoadoutMenuOpen = false;
    }
    else if (name === 'begin-run') {
      if (beginRun(this.run)) { this.selectedItem = null; this.message = ''; this.startLoadoutMenuOpen = false; }
    }
    else if (name === 'route') { if (openRoute(this.run)) { this.selectedItem = null; this.message = ''; } }
    else if (name === 'room') {
      if (enterRoom(this.run, value)) {
        this.selectedItem = null; this.message = '';
        if (this.run.stage === 'battle') this.prepareFastEncounter();
      }
    } else if (name === 'claim') { if (claimReward(this.run, value)) this.message = 'Предмет лежит на полу'; }
    else if (name === 'workshop-wind') { if (windWorkshop(this.run)) this.message = 'Завод восстановлен; прочность не изменилась'; }
    else if (name === 'calm') { if (calmWorkshopItem(this.run, value)) this.message = 'Предмет успокоен'; }
    else if (name === 'leave-workshop') { if (leaveWorkshop(this.run)) this.message = 'Работа мастерской завершена'; }
    else if (name === 'event-choice') { if (resolveInfirmary(this.run, value)) this.message = value === 'heal' ? 'Люди получили лечение' : 'Куклы починены'; }
    else if (name === 'store') this.dropToStash(value);
    else if (name === 'wind') queueWinding(this.state, value);
    else if (name === 'help') this.helpOpen = !this.helpOpen;
    else if (name === 'options') { this.optionsOpen = !this.optionsOpen; this.startLoadoutMenuOpen = false; }
    else if (name === 'audio-mute' && (value === 'music' || value === 'effects')) {
      const key = `${value}Muted` as const;
      this.audioSettings[key] = !this.audioSettings[key];
      saveAudioSettings(this.audioSettings);
    }
    else if (name === 'hero-info' && this.state.heroes.some(hero => hero.id === value)) this.heroInfoId = value;
    else if (name === 'close-hero-info') this.heroInfoId = null;
    else if (name === 'restart' && (this.run.stage === 'defeat' || this.run.stage === 'victory')) {
      this.action('confirm-reset'); this.action('begin-run');
    }
    else if (name === 'restart') this.confirmReset = true;
    else if (name === 'cancel-reset') this.confirmReset = false;
    else if (name === 'confirm-reset') {
      this.state = this.freshEncounter();
      Object.assign(this.run, createRun(this.state));
      this.prepareFastEncounter(); this.selectedItem = null; this.confirmReset = false;
      this.startLoadoutMenuOpen = false;
      this.heroInfoId = null; this.helpOpen = false; this.optionsOpen = false;
      this.message = ''; this.latestAction = undefined; this.highlightUntil = 0; this.paused = false;
      this.dialogue.reset(); this.dialogueSequence = 0;
    }
  }
}
