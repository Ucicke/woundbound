/// <reference types="vite/client" />
import { createFullEncounter } from '../combat/encounter.ts';
import { areAdjacent, itemBonuses, moveItem, occupiedCells, storeItem } from '../combat/inventory.ts';
import { applyEffect, chooseHeroTarget, evaluateItem, prepareEncounter, queueWinding, startBattle, swapHeroPositions, type CombatEvent, type CombatItem, type Combatant, type EncounterState } from '../combat/simulation.ts';
import { COMBAT_CONFIG } from '../combat/config.ts';

const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const action = (name: string, value = ''): string => `data-action="${name}" data-value="${escape(value)}" data-key="${name}-${escape(value)}"`;
const bar = (label: string, current: number, max: number, kind: string): string => `<div class="meter"><span>${escape(label)} <b>${Math.ceil(current)}/${Math.ceil(max)}</b></span><progress class="${kind}" value="${Math.max(0, current)}" max="${Math.max(1, max)}" aria-label="${escape(label)}"></progress></div>`;

export class GameUI {
  state: EncounterState;
  private readonly root: HTMLElement;
  private heroId: string;
  private selectedItem: string | null = null;
  private swapping = false;
  private message = '';
  private showingInventory = false;
  private confirmReset = false;
  private paused = false;
  private previousLog = '\0';
  private followsLog = true;
  private latestAction?: CombatEvent;
  private highlightUntil = 0;
  private inputHeld = false;

  constructor() {
    this.state = this.freshEncounter();
    if (import.meta.env.MODE === 'test') {
      const scenario = new URLSearchParams(location.search).get('scenario');
      if (scenario) {
        const state = this.state, hero = state.heroes[0];
        moveItem(state, 'item-1', hero.id, 0);
        startBattle(state);
        if (scenario === 'winding') {
          state.enemies.forEach(enemy => { enemy.attackDamage = 0; });
          hero.status = 'stopped'; hero.wind = 0;
        } else if (scenario === 'drop') {
          hero.status = 'stopped'; hero.durability = 1;
          applyEffect(state, hero.id, 'damage', 1);
          state.enemies.forEach(enemy => applyEffect(state, enemy.id, 'damage', enemy.maxHp));
        } else if (scenario === 'defeat') {
          state.heroes.forEach(candidate => { candidate.status = 'stopped'; candidate.durability = 1; });
          state.heroes.forEach(candidate => applyEffect(state, candidate.id, 'damage', 1));
        }
      }
    }
    this.heroId = this.state.heroes[0].id;
    this.root = document.getElementById('game-ui')!;
    this.root.innerHTML = '<main id="screen"></main><section class="history" aria-label="Журнал боя"><h2>Журнал боя</h2><div id="history-list" class="history-list" tabindex="0"></div></section>';
    this.root.addEventListener('click', event => this.onClick(event));
    // Do not replace an interactive button between press and release: doing so
    // drops clicks (especially rapid winding) and keyboard activation.
    this.root.addEventListener('pointerdown', () => { this.inputHeld = true; });
    this.root.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') this.inputHeld = true; });
    const release = (): void => { window.setTimeout(() => { this.inputHeld = false; this.render(); }, 0); };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') release(); });
    window.addEventListener('blur', release);
    const history = this.root.querySelector<HTMLElement>('#history-list')!;
    history.addEventListener('scroll', () => { this.followsLog = history.scrollHeight - history.scrollTop - history.clientHeight < 8; });
    this.render();
  }

  private freshEncounter(): EncounterState {
    const state = createFullEncounter();
    prepareEncounter(state);
    return state;
  }

  setPaused(paused: boolean): void { this.paused = paused; }

  private onClick(event: Event): void {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled) return;
    const name = button.dataset.action;
    const value = button.dataset.value ?? '';
    const state = this.state;
    if (name === 'hero') {
      const target = state.heroes.find(hero => hero.id === value);
      const previous = state.heroes.find(hero => hero.id === this.heroId);
      if (target && previous && this.swapping && target !== previous) {
        if (swapHeroPositions(state, previous.slot, target.slot)) this.message = 'Позиции изменены';
        this.swapping = false;
      }
      this.heroId = value;
    } else if (name === 'swap' && state.phase === 'preparation') {
      this.swapping = !this.swapping;
      this.message = this.swapping ? 'Выберите другую позицию' : '';
    } else if (name === 'item') {
      this.selectedItem = this.selectedItem === value ? null : value;
      this.message = this.selectedItem ? 'Выберите клетку рюкзака' : '';
    } else if (name === 'cell') {
      const hero = state.heroes.find(candidate => candidate.id === this.heroId);
      if (!hero) return;
      const cell = Number(value);
      const occupied = hero.items.find(item => occupiedCells(item, item.cell ?? 0)?.includes(cell));
      if (!this.selectedItem && occupied) { this.selectedItem = occupied.id; this.message = 'Выберите клетку рюкзака'; }
      else if (this.selectedItem && occupied?.id === this.selectedItem) { this.selectedItem = null; this.message = 'Выбор снят'; }
      else if (this.selectedItem && moveItem(state, this.selectedItem, hero.id, cell)) { this.selectedItem = null; this.message = 'Предмет размещён'; }
      else this.message = 'Предмет не помещается: проверьте границы и занятые клетки.';
    } else if (name === 'start') {
      if (startBattle(state)) { this.selectedItem = null; this.message = ''; }
    } else if (name === 'store' && this.selectedItem) {
      if (storeItem(state, this.selectedItem)) { this.selectedItem = null; this.message = 'Предмет убран в запас'; }
    } else if (name === 'wind') {
      queueWinding(state, value);
    } else if (name === 'manage' && state.outcome === 'victory') {
      this.showingInventory = true;
    } else if (name === 'result') {
      this.showingInventory = false;
    } else if (name === 'restart') {
      this.confirmReset = true;
    } else if (name === 'cancel-reset') {
      this.confirmReset = false;
    } else if (name === 'confirm-reset') {
      this.state = this.freshEncounter();
      this.heroId = this.state.heroes[0].id;
      this.selectedItem = null;
      this.swapping = false;
      this.showingInventory = false;
      this.confirmReset = false;
      this.message = '';
      this.previousLog = '\0';
      this.followsLog = true;
      this.latestAction = undefined;
    }
    this.render();
  }

  private itemDescription(item: CombatItem, hero?: Combatant): string {
    const bonuses = hero ? itemBonuses(item, hero.items) : { damage: 0, cooldownFactor: 1, descriptions: [] };
    const cooldown = item.cooldownMs * bonuses.cooldownFactor / 1000;
    return `${item.description ?? 'Автоматическое действие.'} Кулдаун: ${(item.cooldownMs / 1000).toFixed(1)} с${bonuses.cooldownFactor !== 1 ? ` → ${cooldown.toFixed(1)} с` : ''}.${bonuses.descriptions.length ? ` ${bonuses.descriptions.join('; ')}.` : ''}`;
  }

  private preparation(): string {
    const state = this.state;
    const hero = state.heroes.find(candidate => candidate.id === this.heroId) ?? state.heroes[0];
    const all = [...state.stash, ...state.floor, ...state.heroes.flatMap(candidate => candidate.items)];
    const selected = all.find(item => item.id === this.selectedItem);
    const cells = Array.from({ length: 16 }, (_, cell) => {
      const item = hero.items.find(candidate => occupiedCells(candidate, candidate.cell ?? 0)?.includes(cell));
      const related = item && hero.items.some(other => other.id !== item.id && areAdjacent(item, other) && ((item.tags?.includes('blade') && other.tags?.includes('whetstone')) || (item.tags?.includes('whetstone') && other.tags?.includes('blade')) || (item.tags?.includes('clockwork') && other.tags?.includes('spring')) || (item.tags?.includes('spring') && other.tags?.includes('clockwork'))));
      return `<button class="cell ${item ? 'occupied' : ''} ${related ? 'related' : ''} ${item?.id === this.selectedItem ? 'selected' : ''}" ${action('cell', String(cell))} aria-label="Клетка ${cell + 1}${item ? `: ${escape(item.name)}` : ': свободно'}">${item ? escape(item.name) : ''}</button>`;
    }).join('');
    const heroButtons = state.heroes.map(candidate => `<button class="hero-choice ${hero.id === candidate.id ? 'selected' : ''}" ${action('hero', candidate.id)}><span>${candidate.slot + 1}</span> ${escape(candidate.name)}${candidate.status === 'dead' ? ' †' : ''}</button>`).join('');
    const items = (list: CombatItem[], empty: string): string => list.length ? list.map(item => `<button class="stash-item ${item.id === this.selectedItem ? 'selected' : ''}" ${action('item', item.id)}>${escape(item.name)}</button>`).join('') : `<p class="muted">${escape(empty)}</p>`;
    const bonuses = hero.items.flatMap(item => itemBonuses(item, hero.items).descriptions.map(text => `<li>${escape(item.name)}: ${escape(text)}</li>`)).join('');
    return `<header class="screen-head"><div><span class="eyebrow">${this.showingInventory ? 'ПОСЛЕ БОЯ' : 'ПОДГОТОВКА'}</span><h1>Отряд</h1></div>${this.showingInventory ? `<button ${action('result')}>Вернуться к результату</button>` : `<button class="primary" ${action('start')}>Начать бой</button>`}</header>
      <div class="preparation"><section class="panel formation-panel"><h2>Строй</h2><div class="hero-list">${heroButtons}</div>${state.phase === 'preparation' ? `<button ${action('swap')} aria-pressed="${this.swapping}">${this.swapping ? 'Выберите другую позицию' : 'Переставить героя'}</button>` : ''}</section>
      <section class="panel backpack-panel"><h2>Рюкзак: ${escape(hero.name)}</h2><div class="grid">${cells}</div>${bonuses ? `<ul class="bonuses">${bonuses}</ul>` : ''}<p class="message" role="status">${escape(this.message)}</p>${selected ? `<div class="details"><strong>${escape(selected.name)}</strong><p>${escape(this.itemDescription(selected, hero.items.includes(selected) ? hero : undefined))}</p>${hero.items.includes(selected) ? `<button ${action('store')}>Убрать в запас</button>` : ''}</div>` : ''}</section>
      <section class="panel stash-panel"><h2>Запас</h2><div class="stash">${items(state.stash, 'Запас пуст')}</div>${state.phase === 'result' ? `<h2>На полу</h2><div class="stash">${items(state.floor, 'На полу нет предметов')}</div>` : ''}</section></div>`;
  }

  private combatant(hero: Combatant): string {
    const statuses: Record<Combatant['status'], [string, string]> = { human: ['●', 'Человек'], enemy: ['●', 'Враг'], rebirthing: ['◌', 'Перерождение'], stopped: ['■', 'Кукла остановлена'], active: ['◆', 'Кукла работает'], dead: ['✕', 'Окончательная гибель'] };
    const [symbol, defaultName] = statuses[hero.status];
    const name = hero.side === 'enemy' && hero.status === 'dead' ? 'Побеждён' : defaultName;
    const isDoll = hero.status === 'stopped' || hero.status === 'active';
    const health = hero.status === 'rebirthing' ? bar('Перерождение', COMBAT_CONFIG.rebirthMs - hero.rebirthMs, COMBAT_CONFIG.rebirthMs, 'rebirth') : isDoll ? bar('Прочность', hero.durability, hero.maxDurability, 'durability') + bar('Завод', hero.wind, hero.maxWind, 'wind') : hero.status === 'dead' ? '' : bar('Здоровье', hero.hp, hero.maxHp, 'health');
    const winding = hero.status === 'stopped' ? `<button class="wind-button" ${action('wind', hero.id)}>Завести · осталось ${Math.ceil((hero.maxWind - hero.wind) / (hero.maxWind / COMBAT_CONFIG.clicksToFull))}</button>` : '';
    const items = hero.side === 'hero' ? hero.items.map(item => {
      const evaluation = evaluateItem(this.state, hero, item);
      const effective = item.cooldownMs * itemBonuses(item, hero.items).cooldownFactor;
      const remaining = Math.max(0, item.remainingMs);
      return `<div class="equipped"><div><strong>${escape(item.name)}</strong> <span>${(remaining / 1000).toFixed(1)} с</span></div><progress class="cooldown" value="${Math.max(0, effective - remaining)}" max="${effective}" aria-label="Готовность: ${escape(item.name)}"></progress><small>${escape(evaluation.reason ?? (evaluation.target ? `Цель: ${evaluation.target.name}` : 'Нет доступной цели'))}</small><details><summary data-key="details-${escape(item.id)}">Правила предмета</summary><p>${escape(this.itemDescription(item, hero))}</p></details></div>`;
    }).join('') : '';
    const enemyTarget = hero.side === 'enemy' && hero.status === 'enemy' ? `<small>Цель: ${escape(chooseHeroTarget(this.state.heroes, hero.targetPolicy, hero.slot, hero.reach)?.name ?? 'нет доступной цели')}</small>` : '';
    const highlighted = performance.now() < this.highlightUntil && (this.latestAction?.actorId === hero.id ? 'action-source' : this.latestAction?.targetId === hero.id ? 'action-target' : '');
    return `<article class="combatant ${hero.status} ${highlighted}"><div class="combatant-title"><h3>${hero.slot + 1}. ${escape(hero.name)}</h3><span class="state">${symbol} ${name}</span></div>${health}${enemyTarget}${hero.status === 'rebirthing' ? `<small>Осталось ${(hero.rebirthMs / 1000).toFixed(1)} с</small>` : ''}${winding}${items || (hero.side === 'hero' && hero.status !== 'dead' ? '<small class="muted">Нет предметов</small>' : '')}</article>`;
  }

  private battle(): string {
    const state = this.state;
    const result = state.outcome !== 'ongoing';
    const notice = result ? `<section class="outcome" role="status"><h1>${state.outcome === 'victory' ? 'Победа' : 'Поражение'}</h1><div class="actions">${state.outcome === 'victory' ? `<button class="primary" ${action('manage')}>Распределить предметы</button>` : ''}<button ${action('restart')}>Начать заново</button></div></section>` : '';
    const confirmation = this.confirmReset ? `<section class="confirmation" role="alertdialog" aria-label="Подтвердить новый бой"><h2>Начать заново?</h2><p>Текущий бой и подготовка будут сброшены.</p><div class="actions"><button class="danger" ${action('confirm-reset')}>Сбросить и начать заново</button><button ${action('cancel-reset')}>Вернуться к бою</button></div></section>` : '';
    const cue = `<p class="action-cue">${performance.now() < this.highlightUntil && this.latestAction ? escape(this.latestAction.message) : ''}</p>`;
    return `<header class="screen-head"><h1>${this.paused && !result ? 'Пауза' : 'Бой'}</h1>${!result ? `<button ${action('restart')}>Начать заново</button>` : ''}</header>${notice}${confirmation}${cue}<div class="battle-grid"><section><h2>Отряд</h2><div class="combatants">${state.heroes.map(hero => this.combatant(hero)).join('')}</div></section><section><h2>Враги</h2><div class="combatants">${state.enemies.map(enemy => this.combatant(enemy)).join('')}</div></section></div>${state.floor.length ? `<p>На полу: ${state.floor.map(item => escape(item.name)).join(', ')}</p>` : ''}`;
  }

  render(): void {
    if (this.inputHeld) return;
    const screen = this.root.querySelector<HTMLElement>('#screen')!;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    const openDetails = [...screen.querySelectorAll<HTMLDetailsElement>('details[open]')].map(element => element.parentElement?.querySelector('strong')?.textContent);
    const latest = [...this.state.events].reverse().find(event => event.kind === 'item' || event.kind === 'enemy');
    if (latest && latest !== this.latestAction) { this.latestAction = latest; this.highlightUntil = performance.now() + 800; }
    screen.innerHTML = this.state.phase === 'preparation' || this.showingInventory ? this.preparation() : this.battle();
    screen.querySelectorAll<HTMLDetailsElement>('details').forEach(element => { if (openDetails.includes(element.parentElement?.querySelector('strong')?.textContent)) element.open = true; });
    if (focused) [...screen.querySelectorAll<HTMLElement>('[data-key]')].find(element => element.dataset.key === focused)?.focus({ preventScroll: true });
    const history = this.root.querySelector<HTMLElement>('#history-list')!;
    const text = this.state.events.map(event => event.message).join('\n');
    if (text !== this.previousLog) {
      const previousTop = history.scrollTop;
      history.textContent = text || 'Событий пока нет';
      history.scrollTop = this.followsLog ? history.scrollHeight : previousTop;
      this.previousLog = text;
    }
    this.root.querySelector<HTMLElement>('.history')!.hidden = this.state.phase === 'preparation' || this.showingInventory;
  }
}
