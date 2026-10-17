export const XP_PER_LEVEL = 1_000;

export function playerProgression(totalXp: number) {
  const xp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const levelXp = xp % XP_PER_LEVEL;
  return { level, levelXp, xpToNextLevel: XP_PER_LEVEL - levelXp, progress: levelXp / XP_PER_LEVEL };
}
