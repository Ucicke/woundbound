import Phaser from 'phaser';
import { createFullEncounter } from '../combat/encounter.ts';
import { advanceClock, chooseEnemyTarget, chooseHeroTarget, placeStashItem, prepareEncounter, projectAction, projectHero, queueWinding, startBattle, stepEncounter, type CombatClock, type CombatEvent } from '../combat/simulation.ts';
import { COMBAT_CONFIG } from '../combat/config.ts';

export class CombatScene extends Phaser.Scene {
  private state = createFullEncounter();
  private clock: CombatClock = { accumulator: 0 };
  private focused = true;
  private graphics!: Phaser.GameObjects.Graphics;
  private heroLabels: Phaser.GameObjects.Text[] = [];
  private enemyLabels: Phaser.GameObjects.Text[] = [];
  private log!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private logOffset = 0;
  private lastAction?: CombatEvent;
  private flashUntil = 0;
  private preparation!: Phaser.GameObjects.Container;
  private selectedHero = 0;
  private selectedItem: string | null = null;
  private preparationMessage = '';
  private onBlur = (): void => { this.focused = false; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onFocus = (): void => { this.focused = true; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onVisibility = (): void => { this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onWheel = (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number): void => {
    this.logOffset = Phaser.Math.Clamp(this.logOffset + (dy < 0 ? 1 : -1), 0, Math.max(0, this.state.events.length - 7));
  };

  constructor() { super('combat'); }

  create(): void {
    this.focused = document.hasFocus();
    prepareEncounter(this.state);
    this.graphics = this.add.graphics();
    this.add.text(28, 18, 'WOUNDBOUND', { fontFamily: 'Georgia', fontSize: '28px', color: '#ead9b6' });
    this.add.text(30, 53, 'ОТРЯД   ·   П — прочность   З — завод', { fontFamily: 'Arial', fontSize: '14px', color: '#a8967e' });
    this.add.text(568, 53, 'ВРАГИ', { fontFamily: 'Arial', fontSize: '14px', color: '#a8967e' });
    this.statusText = this.add.text(780, 25, '', { fontFamily: 'Arial', fontSize: '16px', color: '#e8bd72' });
    for (let i = 0; i < 4; i++) {
      this.heroLabels.push(this.add.text(43, 83 + i * 88, '', { fontFamily: 'Arial', fontSize: '15px', color: '#f0e4cc', lineSpacing: 3 }));
      this.enemyLabels.push(this.add.text(583, 83 + i * 88, '', { fontFamily: 'Arial', fontSize: '15px', color: '#f0e4cc', lineSpacing: 3 }));
      this.add.zone(203, 114 + i * 88, 350, 76).setInteractive({ useHandCursor: true }).on('pointerdown', () => queueWinding(this.state, this.state.heroes[i].id));
    }
    this.add.text(30, 455, 'ЖУРНАЛ БОЯ  ·  колесо мыши — прокрутка', { fontFamily: 'Arial', fontSize: '14px', color: '#a8967e' });
    this.log = this.add.text(30, 481, '', { fontFamily: 'Arial', fontSize: '15px', color: '#ded0b8', lineSpacing: 4 });
    this.floorText = this.add.text(30, 640, '', { fontFamily: 'Arial', fontSize: '14px', color: '#bca98d' });
    this.preparation = this.add.container(0, 0).setDepth(100);
    this.renderPreparation();
    this.input.on('wheel', this.onWheel);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once('shutdown', () => {
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.input.off('wheel', this.onWheel);
    });
  }

  private renderPreparation(): void {
    this.preparation.removeAll(true);
    if (this.state.phase !== 'preparation') return;
    const background = this.add.rectangle(480, 340, 960, 680, 0x171414);
    this.preparation.add(background);
    const label = (x: number, y: number, value: string, size = '18px'): Phaser.GameObjects.Text => {
      const result = this.add.text(x, y, value, { fontFamily: 'Arial', fontSize: size, color: '#f0e4cc', wordWrap: { width: 450 } });
      this.preparation.add(result);
      return result;
    };
    label(36, 25, 'ПОДГОТОВКА', '26px');
    label(36, 75, 'Отряд', '20px');
    this.state.heroes.forEach((hero, i) => {
      const text = label(36, 110 + i * 52, `${i === this.selectedHero ? '▶ ' : ''}${i + 1}. ${hero.name}`);
      text.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.selectedHero = i; this.renderPreparation(); });
    });
    const hero = this.state.heroes[this.selectedHero];
    label(330, 75, `Рюкзак: ${hero.name}`, '20px');
    for (let cell = 0; cell < 16; cell++) {
      const x = 350 + (cell % 4) * 65;
      const y = 140 + Math.floor(cell / 4) * 65;
      const occupied = hero.items.find(item => item.cell === cell);
      const square = this.add.rectangle(x, y, 58, 58, occupied ? 0x665037 : 0x302923).setStrokeStyle(1, 0xa8967e).setInteractive({ useHandCursor: true });
      this.preparation.add(square);
      square.on('pointerdown', () => {
        if (this.selectedItem && placeStashItem(this.state, this.selectedItem, hero.id, cell)) {
          this.preparationMessage = 'Предмет размещён'; this.selectedItem = null;
        } else this.preparationMessage = 'Выберите предмет и свободную клетку';
        this.renderPreparation();
      });
      if (occupied) label(x - 23, y - 10, occupied.name.slice(0, 5), '13px');
    }
    label(650, 75, 'Запас', '20px');
    if (this.state.stash.length === 0) label(650, 115, 'Пусто', '16px');
    this.state.stash.forEach((item, i) => {
      const text = label(650, 115 + i * 42, `${this.selectedItem === item.id ? '▶ ' : ''}${item.name}`, '16px');
      text.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.selectedItem = item.id; this.preparationMessage = 'Выберите клетку рюкзака'; this.renderPreparation(); });
    });
    label(330, 425, this.preparationMessage, '16px');
    const start = label(330, 490, '▶  Начать бой', '24px').setInteractive({ useHandCursor: true });
    start.on('pointerdown', () => { if (startBattle(this.state)) this.renderPreparation(); });
  }

  update(_time: number, delta: number): void {
    const visible = !document.hidden;
    const steps = advanceClock(this.clock, delta, visible, this.focused);
    for (let n = 0; n < steps; n++) stepEncounter(this.state, 50);
    this.statusText.setText(this.state.outcome === 'victory' ? 'ПОБЕДА' : this.state.outcome === 'defeat' ? 'ПОРАЖЕНИЕ' : !visible || !this.focused ? 'ПАУЗА' : 'БОЙ');
    this.renderBoard();
  }

  private renderBoard(): void {
    this.graphics.clear();
    this.state.heroes.forEach((hero, i) => {
      const y = 76 + i * 88;
      this.graphics.fillStyle(0x302923).fillRoundedRect(28, y, 350, 76, 6);
      const item = hero.items[0];
      const view = projectHero(hero);
      const progress = item ? 1 - view.cooldownMs / item.cooldownMs : 0;
      let status = `HP ${Math.ceil(hero.hp)}/${hero.maxHp}`;
      if (hero.status === 'rebirthing') status = `ПЕРЕРОЖДЕНИЕ ${view.rebirthSeconds.toFixed(1)} с`;
      if (hero.status === 'stopped' || hero.status === 'active') status = `КУКЛА ${hero.status === 'stopped' ? '— НАЖИМАЙТЕ' : '— РАБОТАЕТ'}  П ${Math.ceil(hero.durability)}  З ${Math.ceil(hero.wind)}`;
      if (hero.status === 'dead') status = 'ОКОНЧАТЕЛЬНАЯ ГИБЕЛЬ';
      const target = item && (hero.status === 'human' || hero.status === 'active') ? chooseEnemyTarget(this.state.enemies, item.targetPolicy) : undefined;
      this.heroLabels[i].setText([`${i + 1}. ${hero.name}  ${status}`, item ? `${item.name} ${(view.cooldownMs / 1000).toFixed(1)} с → ${target?.name ?? 'нет цели'}` : 'Без предмета']);
      this.graphics.fillStyle(0x655037).fillRect(43, y + 48, 300, 4);
      this.graphics.fillStyle(0xc2a56d).fillRect(43, y + 48, Math.max(0, 300 * progress), 4);
      if (hero.status === 'rebirthing') {
        this.graphics.fillStyle(0x655037).fillRect(43, y + 59, 300, 6);
        this.graphics.fillStyle(0xb9a7d6).fillRect(43, y + 59, 300 * (1 - hero.rebirthMs / COMBAT_CONFIG.rebirthMs), 6);
      } else if (hero.status === 'stopped' || hero.status === 'active') {
        this.graphics.fillStyle(0x5d3434).fillRect(43, y + 57, 300, 5);
        this.graphics.fillStyle(0xcf6c61).fillRect(43, y + 57, 300 * hero.durability / hero.maxDurability, 5);
        this.graphics.fillStyle(0x655037).fillRect(43, y + 66, 300, 5);
        this.graphics.fillStyle(0xd9b461).fillRect(43, y + 66, 300 * hero.wind / hero.maxWind, 5);
      }
    });
    this.state.enemies.forEach((enemy, i) => {
      const y = 76 + i * 88;
      this.graphics.fillStyle(0x352424).fillRoundedRect(568, y, 350, 76, 6);
      this.enemyLabels[i].setText([`${i + 1}. ${enemy.name}  HP ${Math.ceil(enemy.hp)}/${enemy.maxHp}`, enemy.status === 'dead' ? 'Побеждён' : `Цель: ${chooseHeroTarget(this.state.heroes, enemy.targetPolicy)?.name ?? 'нет цели'}`]);
    });
    const latest = [...this.state.events].reverse().find(event => event.kind === 'item' || event.kind === 'enemy');
    if (latest && latest !== this.lastAction) { this.lastAction = latest; this.flashUntil = this.time.now + 500; }
    if (this.lastAction && this.time.now < this.flashUntil) {
      const action = projectAction(this.lastAction);
      const heroSource = this.state.heroes.findIndex(hero => hero.id === action.actorId);
      const enemySource = this.state.enemies.findIndex(enemy => enemy.id === action.actorId);
      const heroTarget = this.state.heroes.findIndex(hero => hero.id === action.targetId);
      const enemyTarget = this.state.enemies.findIndex(enemy => enemy.id === action.targetId);
      this.graphics.lineStyle(2, 0xe7bf77, 0.9);
      if (heroSource >= 0 && enemyTarget >= 0) {
        this.graphics.strokeRoundedRect(40, 100 + heroSource * 88, 310, 25, 3);
        this.graphics.lineBetween(378, 114 + heroSource * 88, 568, 114 + enemyTarget * 88);
      } else if (enemySource >= 0 && heroTarget >= 0) {
        this.graphics.strokeRoundedRect(568, 76 + enemySource * 88, 350, 76, 6);
        this.graphics.lineBetween(568, 114 + enemySource * 88, 378, 114 + heroTarget * 88);
      }
    }
    const end = Math.max(0, this.state.events.length - this.logOffset);
    this.log.setText(this.state.events.slice(Math.max(0, end - 7), end).map(event => projectAction(event).text));
    const floorItems = this.state.floor.map(id => this.state.heroes.flatMap(hero => hero.items).find(item => item.id === id)?.name ?? id);
    this.floorText.setText(floorItems.length ? `На полу: ${floorItems.join(', ')}` : '');
  }
}
