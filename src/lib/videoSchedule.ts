import type { DailySchedule, LearningState } from '../../shared/types';
import type { VerifiedVideo } from '../../server/youtube';
import { dailyScheduleSchema } from '../../shared/schema';
import { buildDailySchedule } from './engine';

/** Also used for search links; exact hosts prevent lookalike domains. */
export function isSafeYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname);
  } catch { return false; }
}

/** Read persisted adjustments, so reloading does not reset today's budget. */
export function getDailyBudgetMinutes(state: LearningState, date: string): number {
  const adjustment = state.dailyAdjustments?.[date];
  return Math.min(1440, Math.max(1, Math.floor(state.campaign.dailyMinutes * (adjustment === 'half' ? 0.5 : adjustment === 'more' ? 1.5 : 1))));
}

/** Budget eligibility is shared with the picker; totals are derived from items. */
export function getVideoScheduleOptions(schedule: DailySchedule | undefined, taskId: string, video: Pick<VerifiedVideo, 'videoId' | 'durationSeconds'>, budgetMinutes: number) {
  const minutes = Math.ceil(video.durationSeconds / 60);
  const validDuration = Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440;
  const usedMinutes = schedule?.items.reduce((sum, item) => sum + item.minutes, 0) ?? 0;
  const lessonIndex = schedule?.items.findIndex(item => item.taskId === taskId && item.kind === 'lesson') ?? -1;
  const lessonMinutes = lessonIndex >= 0 ? schedule!.items[lessonIndex].minutes : 0;
  const selected = schedule?.items.some(item => item.kind === 'video' && item.resourceId === video.videoId) ?? false;
  return {
    minutes, selected, lessonIndex,
    remainingMinutes: Math.max(0, budgetMinutes - usedMinutes),
    canAdd: validDuration && !selected && usedMinutes + minutes <= budgetMinutes,
    canReplace: validDuration && !selected && lessonIndex >= 0 && usedMinutes - lessonMinutes + minutes <= budgetMinutes,
  };
}

/** Throws on rejected selections; the caller can display the message without saving. */
export function scheduleVideo(state: LearningState, date: string, taskId: string, video: VerifiedVideo, replace = false): LearningState {
  if (!state.campaign.stages.some(stage => stage.tasks.some(task => task.id === taskId))) throw new Error('视频必须关联当前课程的任务');
  if (!Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0 || !isSafeYouTubeUrl(video.watchUrl)) throw new Error('视频时长或 YouTube 链接无效');
  const schedule = state.schedules?.[date] ?? buildDailySchedule(state.campaign, state.progress, state.reviews, date, state.dailyAdjustments?.[date]);
  const options = getVideoScheduleOptions(schedule, taskId, video, getDailyBudgetMinutes(state, date));
  const item = dailyScheduleSchema.shape.items.element.parse({
    taskId, kind: 'video', minutes: options.minutes, required: replace && options.lessonIndex >= 0 ? schedule.items[options.lessonIndex].required : false,
    deliverable: '看完后合上视频，独立完成本任务练习；观看记录不代表任务通过。',
    resourceId: video.videoId, resourceTitle: video.title, resourceUrl: video.watchUrl, watched: false,
  });
  if (options.selected) return state;
  if (replace && options.lessonIndex < 0) throw new Error('本任务没有可替换的讲解；必做练习和复习会保留');
  if (replace ? !options.canReplace : !options.canAdd) throw new Error('视频超出今日总预算；请显式选择替换本任务讲解，或调整今天的预算');
  const items = replace ? schedule.items.map((existing, index) => index === options.lessonIndex ? item : existing) : [...schedule.items, item];
  const updated = dailyScheduleSchema.parse({ ...schedule, items, totalMinutes: items.reduce((sum, entry) => sum + entry.minutes, 0), revision: schedule.revision + 1 });
  return { ...state, schedules: { ...state.schedules, [date]: updated } };
}

/** Index refers to the displayed day's schedule. No progression/reward side effects. */
export function markVideoWatched(state: LearningState, date: string, index: number): LearningState {
  const schedule = state.schedules?.[date];
  const item = Number.isInteger(index) && index >= 0 ? schedule?.items[index] : undefined;
  if (!schedule || item?.kind !== 'video' || item.watched) return state;
  return { ...state, schedules: { ...state.schedules, [date]: { ...schedule, revision: schedule.revision + 1, items: schedule.items.map((entry, position) => position === index ? { ...entry, watched: true } : entry) } } };
}
