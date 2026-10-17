import { describe, expect, it } from 'vitest';
import { playerProgression } from '../shared/progression';

describe('player progression display', () => {
  it('maps lifetime server XP to a level and a bounded next-level bar', () => {
    expect(playerProgression(0)).toEqual({ level: 1, levelXp: 0, xpToNextLevel: 1000, progress: 0 });
    expect(playerProgression(1250)).toEqual({ level: 2, levelXp: 250, xpToNextLevel: 750, progress: 0.25 });
  });
});
