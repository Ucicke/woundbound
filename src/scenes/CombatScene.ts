import Phaser from 'phaser';
import { createFullEncounter } from '../combat/encounter.ts';
import { advanceClock, stepEncounter, type CombatClock } from '../combat/simulation.ts';

export class CombatScene extends Phaser.Scene {
  private state = createFullEncounter();
  private clock: CombatClock = { accumulator: 0 };
  private focused = true;
  private graphics!: Phaser.GameObjects.Graphics;
  private heroLabels: Phaser.GameObjects.Text[] = [];
  private enemyLabels: Phaser.GameObjects.Text[] = [];
  private log!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private onBlur = (): void => { this.focused = false; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onFocus = (): void => { this.focused = true; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onVisibility = (): void => { this.clock.accumulator = 0; this.clock.interrupted = true; };

  constructor() { super('combat'); }

  create(): void {
    this.graphics = this.add.graphics();
    this.add.text(28, 18, 'WOUNDBOUND', { fontFamily: 'Georgia', fontSize: '28px', color: '#ead9b6' });
    this.add.text(30, 53, 'ОТРЯД', { fontFamily: 'Arial', fontSize: '14px', color: '#a8967e' });
    this.add.text(568, 53, 'ВРАГИ', { fontFamily: 'Arial', fontSize: '14px', color: '#a8967e' });
    this.statusText = this.add.text(780, 25, '', { fontFamily: 'Arial', fontSize: '16px', color: '#e8bd72' });
    for (let i = 0; i < 4; i++) {
      this.heroLabels.push(this.add.text(43, 83 + i * 88, '', { fontFamily: 'Arial', fontSize: '15px', color: '#f0e4cc', lineSpacing: 3 }));
      this.enemyLabels.push(this.add.text(583, 83 + i * 88, '', { fontFamily: 'Arial', fontSize: '15px', color: '#f0e4cc', lineSpacing: 3 }));
    }
    this.add.text(30, 455, 'ЖУРНАЛ БОЯ', { fontFamily: 'Arial', fontSize: '14px', color: '#a8967e' });
    this.log = this.add.text(30, 481, '', { fontFamily: 'Arial', fontSize: '15px', color: '#ded0b8', lineSpacing: 4 });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once('shutdown', () => {
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });
  }

  update(_time: number, delta: number): void {
    const visible = !document.hidden;
    const steps = advanceClock(this.clock, delta, visible, this.focused);
    for (let n = 0; n < steps; n++) stepEncounter(this.state, 50);
    this.statusText.setText(!visible || !this.focused ? 'ПАУЗА' : 'БОЙ');
    this.renderBoard();
  }

  private renderBoard(): void {
    this.graphics.clear();
    this.state.heroes.forEach((hero, i) => {
      const y = 76 + i * 88;
      this.graphics.fillStyle(0x302923).fillRoundedRect(28, y, 350, 76, 6);
      const item = hero.items[0];
      const progress = item ? 1 - item.remainingMs / item.cooldownMs : 0;
      this.graphics.fillStyle(0x655037).fillRect(43, y + 59, 300, 5);
      this.graphics.fillStyle(0xc2a56d).fillRect(43, y + 59, Math.max(0, 300 * progress), 5);
      this.heroLabels[i].setText([`${i + 1}. ${hero.name}  HP ${Math.ceil(hero.hp)}/${hero.maxHp}`, item ? `${item.name}  ${(item.remainingMs / 1000).toFixed(1)} с` : 'Без предмета']);
    });
    this.state.enemies.forEach((enemy, i) => {
      const y = 76 + i * 88;
      this.graphics.fillStyle(0x352424).fillRoundedRect(568, y, 350, 76, 6);
      this.enemyLabels[i].setText([`${i + 1}. ${enemy.name}  HP ${Math.ceil(enemy.hp)}/${enemy.maxHp}`, enemy.status === 'dead' ? 'Побеждён' : `Цель: ${enemy.targetPolicy === 'front' ? 'ближний' : 'слабейший'}`]);
    });
    this.log.setText(this.state.events.slice(-7).map(event => event.message));
  }
}
