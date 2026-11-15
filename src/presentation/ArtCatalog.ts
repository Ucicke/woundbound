export { CLASS_ITEM_ART, CLASS_ITEM_ATLAS_TEXTURES, CLASS_ITEM_ATLAS_URLS } from './ClassItemArt.ts';
export const ITEM_ATLAS_FRAME_SIZE = 512;

export const ACTOR_STATES_ATLAS_URL = '/assets/actors-woundbound-states-atlas.png';
export const ACTOR_STATE_FRAME_SIZE = 256;
export const PUPPET_DEATH_ATLAS_URL = '/assets/puppet-deaths-atlas.png';
export const PUPPET_DEATH_FRAME_SIZE = 640;
export const DOLL_STOPPED_ATLAS_URL = '/assets/doll-stopped-atlas.png';
export const DOLL_STOPPED_FRAME_SIZE = 724;

export const ACTOR_ROWS = {
  'hero-1': 0, 'hero-2': 1, 'hero-3': 2, 'hero-4': 3,
  rat: 4, cultist: 5, automaton: 6, boss: 7,
} as const;
export type ActorSpriteId = keyof typeof ACTOR_ROWS;
export type ActorSpriteState = 'idle' | 'attack' | 'hit' | 'death' | 'dollIdle' | 'dollAttack' | 'dollStopped';

// Opaque content bounds [left, top, right, bottom], measured from the atlas alpha at 50%.
// Each pair describes the same hero in the active and stopped doll frames.
export const DOLL_POSE_BOUNDS = {
  'hero-1': { active: [67, 83, 189, 244], stopped: [194, 185, 523, 580] },
  'hero-2': { active: [65, 85, 191, 244], stopped: [192, 200, 526, 578] },
  'hero-3': { active: [64, 76, 191, 243], stopped: [207, 200, 533, 578] },
  'hero-4': { active: [61, 83, 196, 244], stopped: [209, 199, 502, 578] },
} as const;

/** Match visible height, horizontal center and feet to the active doll at the same depth. */
export function stoppedDollTransform(actor: ActorSpriteId): { scale: number; x: number; y: number } {
  const bounds = DOLL_POSE_BOUNDS[actor as keyof typeof DOLL_POSE_BOUNDS];
  if (!bounds) return { scale: 1, x: 0, y: 0 };
  const { active, stopped } = bounds;
  const scale = ((active[3] - active[1]) / ACTOR_STATE_FRAME_SIZE) / ((stopped[3] - stopped[1]) / DOLL_STOPPED_FRAME_SIZE);
  const x = ((active[0] + active[2]) / 2 / ACTOR_STATE_FRAME_SIZE - .5)
    - scale * ((stopped[0] + stopped[2]) / 2 / DOLL_STOPPED_FRAME_SIZE - .5);
  const y = (active[3] / ACTOR_STATE_FRAME_SIZE - .5) - scale * (stopped[3] / DOLL_STOPPED_FRAME_SIZE - .5);
  return { scale, x, y };
}
const actorStateColumns: Record<Exclude<ActorSpriteState, 'dollStopped'>, number> = { idle: 0, attack: 1, hit: 2, death: 3, dollIdle: 4, dollAttack: 5 };

export function actorStateFrame(actor: ActorSpriteId, state: ActorSpriteState): number {
  if (state === 'dollStopped') return ACTOR_ROWS[actor];
  return ACTOR_ROWS[actor] * 6 + actorStateColumns[state];
}
