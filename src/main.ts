export interface TracerEnemy { id: string; hp: number; maxHp: number }
export interface TracerItem { id: string; cooldownMs: number; remainingMs: number; damage: number }
export interface TracerState { enemy: TracerEnemy; item: TracerItem | null; events: string[] }

export function createEncounter(equipped = true): TracerState {
  return {
    enemy: { id: 'Крыса', hp: 120, maxHp: 120 },
    item: equipped ? { id: 'Клинок', cooldownMs: 1000, remainingMs: 1000, damage: 6 } : null,
    events: [],
  };
}

export function stepEncounter(state: TracerState, deltaMs: number): void {
  const item = state.item;
  if (!item || state.enemy.hp <= 0) return;
  item.remainingMs -= deltaMs;
  while (item.remainingMs <= 0 && state.enemy.hp > 0) {
    state.enemy.hp = Math.max(0, state.enemy.hp - item.damage);
    state.events.push(`${item.id} → ${state.enemy.id}: ${item.damage} урона`);
    if (state.events.length > 8) state.events.shift();
    item.remainingMs += item.cooldownMs;
  }
}

export function projectEncounter(state: TracerState): { enemyHp: number; cooldown: number; events: string[] } {
  return { enemyHp: state.enemy.hp, cooldown: state.item?.remainingMs ?? 0, events: [...state.events] };
}

if (typeof document !== 'undefined') {
  void import('phaser').then(({ default: Phaser }) => {
    class CombatScene extends Phaser.Scene {
      private state = createEncounter();
      private accumulated = 0;
      private display!: Phaser.GameObjects.Text;

      create(): void {
        this.display = this.add.text(36, 32, '', { fontFamily: 'Arial', fontSize: '20px', color: '#f2e5cb', lineSpacing: 10 });
      }

      update(_time: number, delta: number): void {
        this.accumulated += Math.min(delta, 250);
        while (this.accumulated >= 50) {
          stepEncounter(this.state, 50);
          this.accumulated -= 50;
        }
        const view = projectEncounter(this.state);
        this.display.setText(['WOUNDBOUND — боевой прототип', '', 'Герой   [Клинок]', `Цель: Крыса  HP ${view.enemyHp}/${this.state.enemy.maxHp}`, `Клинок: ${(view.cooldown / 1000).toFixed(1)} с`, '', 'Журнал боя', ...view.events]);
      }
    }
    new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 960, height: 640, backgroundColor: '#171414', scene: CombatScene });
  });
}
