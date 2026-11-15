import type Phaser from 'phaser';
import type { EncounterState } from '../combat/simulation.ts';

const effects = {
  'gear-1': 'gear-1.ogg', 'gear-2': 'gear-2.ogg', 'gear-3': 'gear-3.ogg',
  'wind-1': 'wind-1.ogg', 'wind-2': 'wind-2.ogg',
  'press-1': 'press-1.ogg', 'press-2': 'press-2.ogg',
  'lock-open': 'lock-open.ogg', 'door-open': 'door-open.ogg',
} as const;

type Cue = 'item' | 'wind' | 'hit' | 'ui' | 'door' | 'hover';
const cues: Record<Cue, { files: (keyof typeof effects)[]; volume: number; interval: number }> = {
  item: { files: ['gear-1', 'gear-2', 'gear-3'], volume: .16, interval: 350 },
  wind: { files: ['wind-1', 'wind-2'], volume: .22, interval: 180 },
  hit: { files: ['press-1', 'press-2'], volume: .12, interval: 800 },
  ui: { files: ['lock-open'], volume: .16, interval: 180 },
  door: { files: ['door-open'], volume: .18, interval: 1000 },
  hover: { files: ['gear-1', 'gear-2', 'gear-3'], volume: .08, interval: 120 },
};

/** Presentation only: keep gameplay rules and their random sequence independent of sound. */
export class GameAudio {
  private state?: EncounterState;
  private lastSequence = 0;
  private lastPlayed = new Map<Cue, number>();
  private nextVariation = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  static preload(scene: Phaser.Scene, asset: (path: string) => string): void {
    for (const [key, file] of Object.entries(effects)) scene.load.audio(`sfx-${key}`, asset(`/assets/audio/sfx/${file}`));
  }

  play(cue: Cue): void {
    const now = this.scene.time.now;
    const config = cues[cue];
    if (this.scene.sound.locked || now - (this.lastPlayed.get(cue) ?? -Infinity) < config.interval) return;
    const file = config.files[this.nextVariation++ % config.files.length]!;
    this.lastPlayed.set(cue, now);
    this.scene.sound.play(`sfx-${file}`, { volume: config.volume });
  }

  consume(state: EncounterState, audible: boolean): void {
    if (state !== this.state) { this.state = state; this.lastSequence = 0; }
    for (const event of state.events) {
      if (!event.sequence || event.sequence <= this.lastSequence) continue;
      this.lastSequence = event.sequence;
      if (!audible) continue;
      if (event.kind === 'wind' && event.amount > 0) this.play('wind');
      else if (event.kind === 'enemy' && event.amount > 0) this.play('hit');
      else if (event.kind === 'item') {
        const item = state.heroes.flatMap(hero => hero.items).find(candidate => candidate.id === event.sourceId);
        this.play(item?.effect === 'wind' ? 'wind' : 'item');
      } else if (event.transition === 'puppet') this.play('wind');
    }
  }
}
