export { CLASS_ITEM_ART, CLASS_ITEM_ATLAS_TEXTURES, CLASS_ITEM_ATLAS_URLS } from './ClassItemArt.ts';
export const ITEM_ATLAS_FRAME_SIZE = 512;

export const ACTOR_STATES_ATLAS_URL = '/assets/actors-woundbound-states-atlas.png';
export const ACTOR_STATE_FRAME_SIZE = 256;
export const DOLL_STOPPED_ATLAS_URL = '/assets/doll-stopped-atlas.png';
export const DOLL_STOPPED_FRAME_SIZE = 724;

export const ACTOR_ROWS = {
  'hero-1': 0, 'hero-2': 1, 'hero-3': 2, 'hero-4': 3,
  rat: 4, cultist: 5, automaton: 6, boss: 7,
} as const;
export type ActorSpriteId = keyof typeof ACTOR_ROWS;
export type ActorSpriteState = 'idle' | 'attack' | 'hit' | 'death' | 'dollIdle' | 'dollAttack' | 'dollStopped';
const actorStateColumns: Record<Exclude<ActorSpriteState, 'dollStopped'>, number> = { idle: 0, attack: 1, hit: 2, death: 3, dollIdle: 4, dollAttack: 5 };

export function actorStateFrame(actor: ActorSpriteId, state: ActorSpriteState): number {
  if (state === 'dollStopped') return ACTOR_ROWS[actor];
  return ACTOR_ROWS[actor] * 6 + actorStateColumns[state];
}
