import Phaser from 'phaser';
import { advanceClock, stepEncounter, type CombatClock } from '../combat/simulation.ts';
import { GameUI } from '../ui/GameUI.ts';

/** Phaser owns the clock; the semantic DOM renders and controls the same state. */
export class CombatScene extends Phaser.Scene {
  private ui!: GameUI;
  private clock: CombatClock = { accumulator: 0 };
  private focused = true;
  private nextRender = 0;
  private onBlur = (): void => { this.focused = false; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onFocus = (): void => { this.focused = true; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onVisibility = (): void => { this.clock.accumulator = 0; this.clock.interrupted = true; };

  constructor() { super('combat'); }

  create(): void {
    this.focused = document.hasFocus();
    this.ui = new GameUI();
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once('shutdown', () => {
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });
  }

  update(time: number, delta: number): void {
    const visible = !document.hidden;
    const steps = advanceClock(this.clock, delta, visible, this.focused && !this.ui.dialogOpen);
    for (let i = 0; i < steps; i++) stepEncounter(this.ui.state, 50);
    this.ui.setPaused(!visible || !this.focused);
    if (time >= this.nextRender) { this.ui.render(); this.nextRender = time + 200; }
  }
}
