import { describe, expect, it } from 'vitest';
import { ACTOR_STATE_FRAME_SIZE, DOLL_POSE_BOUNDS, DOLL_STOPPED_FRAME_SIZE, stoppedDollTransform } from '../src/presentation/ArtCatalog.ts';

describe('stopped doll sprite alignment', () => {
  it('matches each active doll visible height, center and ground position', () => {
    for (const hero of ['hero-1', 'hero-2', 'hero-3', 'hero-4'] as const) {
      const { active, stopped } = DOLL_POSE_BOUNDS[hero];
      const transform = stoppedDollTransform(hero);
      const activeHeight = (active[3] - active[1]) / ACTOR_STATE_FRAME_SIZE;
      const stoppedHeight = (stopped[3] - stopped[1]) / DOLL_STOPPED_FRAME_SIZE * transform.scale;
      const activeCenter = (active[0] + active[2]) / 2 / ACTOR_STATE_FRAME_SIZE - .5;
      const stoppedCenter = ((stopped[0] + stopped[2]) / 2 / DOLL_STOPPED_FRAME_SIZE - .5) * transform.scale + transform.x;
      const activeFeet = active[3] / ACTOR_STATE_FRAME_SIZE - .5;
      const stoppedFeet = (stopped[3] / DOLL_STOPPED_FRAME_SIZE - .5) * transform.scale + transform.y;
      expect(stoppedHeight).toBeCloseTo(activeHeight, 10);
      expect(stoppedCenter).toBeCloseTo(activeCenter, 10);
      expect(stoppedFeet).toBeCloseTo(activeFeet, 10);
    }
  });
});
