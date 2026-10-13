// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailySchedule, LearningState, ScheduleItem } from '../shared/types';
import type { VerifiedVideo } from '../server/youtube';
import { dailyScheduleSchema, learningStateSchema } from '../shared/schema';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createInitialState } from '../src/lib/storage';
import { createProgressForCampaign } from '../src/lib/engine';
import { getDailyBudgetMinutes, isSafeYouTubeUrl, markVideoWatched, scheduleVideo } from '../src/lib/videoSchedule';
import { TodaySchedule } from '../src/components/TodaySchedule';
import { YouTubeResources } from '../src/components/YouTubeResources';

const DATE = '2026-10-13';
const task = NUMPY_DEMO_CAMPAIGN.stages[0].tasks[0];
const video: VerifiedVideo = { videoId: 'abcdefghijk', title: 'Shape tutorial', channel: 'Teacher', thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg', durationSeconds: 301, language: 'en', captionsAvailable: true, watchUrl: 'https://www.youtube.com/watch?v=abcdefghijk', verifiedAt: '2026-10-13T08:00:00Z', source: 'youtube-data-api-v3', metadataOnly: true, matchReason: 'Shape and axis' };
const lesson: ScheduleItem = { taskId: task.id, kind: 'lesson', minutes: 10, required: true, deliverable: 'Read the example' };
const practice: ScheduleItem = { taskId: task.id, kind: 'practice', minutes: 15, required: true, deliverable: 'Independent work' };
const review: ScheduleItem = { taskId: task.id, kind: 'review', minutes: 5, required: true, deliverable: 'Recall' };
function plan(items: ScheduleItem[] = [lesson, practice, review]): DailySchedule {
  return { date: DATE, theme: 'Shape', items, totalMinutes: items.reduce((sum, item) => sum + item.minutes, 0), outcome: 'Explain shape', nextUnlock: 'Next task', revision: 1 };
}
function fresh(items?: ScheduleItem[]): LearningState {
  const state = createInitialState();
  const campaign = { ...structuredClone(NUMPY_DEMO_CAMPAIGN), dailyMinutes: 40 };
  return { ...state, campaign, progress: createProgressForCampaign(campaign), schedules: { [DATE]: plan(items) } };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('video scheduling', () => {
  it('counts every video against the daily budget, rounding seconds up and ignoring stale totals', () => {
    const state = fresh();
    state.schedules![DATE].totalMinutes = 0;
    const added = scheduleVideo(state, DATE, task.id, video);
    expect(added.schedules![DATE].totalMinutes).toBe(36);
    expect(added.schedules![DATE].items.at(-1)?.minutes).toBe(6);
    expect(() => scheduleVideo(added, DATE, task.id, { ...video, videoId: 'lmnopqrstuv', watchUrl: 'https://youtu.be/lmnopqrstuv' })).toThrow(/预算/);
    expect(state.schedules![DATE].items).toHaveLength(3);
  });
  it('uses persisted half/more adjustments after a schema round trip, independently for each date', () => {
    const state = fresh([practice, review]);
    state.dailyAdjustments = { [DATE]: 'half', '2026-10-14': 'more' };
    const restored = learningStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(getDailyBudgetMinutes(restored, DATE)).toBe(20);
    expect(getDailyBudgetMinutes(restored, '2026-10-14')).toBe(60);
    expect(getDailyBudgetMinutes(restored, '2026-10-15')).toBe(40);
    expect(() => scheduleVideo(restored, DATE, task.id, video)).toThrow(/预算/);
    restored.dailyAdjustments![DATE] = 'more';
    expect(scheduleVideo(restored, DATE, task.id, video).schedules![DATE].totalMinutes).toBe(26);
    restored.campaign.dailyMinutes = 3;
    restored.dailyAdjustments![DATE] = 'half';
    expect(getDailyBudgetMinutes(restored, DATE)).toBe(1);
  });
  it('only replaces a same-task lesson after explicit consent, preserving required practice and review', () => {
    const state = fresh(); state.campaign.dailyMinutes = 30;
    expect(() => scheduleVideo(state, DATE, task.id, video)).toThrow(/预算/);
    const added = scheduleVideo(state, DATE, task.id, video, true);
    expect(added.schedules![DATE].items.map(item => item.kind)).toEqual(['video', 'practice', 'review']);
    expect(added.schedules![DATE].items[0].required).toBe(true);
    expect(added.schedules![DATE].items.slice(1)).toEqual([practice, review]);
    expect(added.schedules![DATE].totalMinutes).toBe(26);
    expect(() => scheduleVideo(state, DATE, task.id, { ...video, durationSeconds: 660 }, true)).toThrow(/预算/);
    const otherLesson = fresh([{ ...lesson, taskId: 'other' }, practice, review]); otherLesson.campaign.dailyMinutes = 30;
    expect(() => scheduleVideo(otherLesson, DATE, task.id, video, true)).toThrow(/讲解/);
  });
  it('reselecting a watched video is idempotent even at a now-full budget', () => {
    const added = scheduleVideo(fresh(), DATE, task.id, video);
    const watched = markVideoWatched(added, DATE, 3);
    watched.campaign.dailyMinutes = 20;
    expect(scheduleVideo(watched, DATE, task.id, video, true)).toBe(watched);
    expect(watched.schedules![DATE].items[3].watched).toBe(true);
  });
  it('watching changes only the resource record and revision, never progress, reviews or rewards', () => {
    const added = scheduleVideo(fresh(), DATE, task.id, video);
    const watched = markVideoWatched(added, DATE, 3);
    expect(watched.schedules![DATE].items[3].watched).toBe(true);
    expect(added.schedules![DATE].items[3].watched).toBe(false);
    expect(watched.progress).toBe(added.progress);
    expect(watched.reviews).toBe(added.reviews);
    expect(watched.rewardLedger).toBe(added.rewardLedger);
    expect(watched.schedules![DATE].revision).toBe(added.schedules![DATE].revision + 1);
    expect(markVideoWatched(watched, DATE, 3)).toBe(watched);
    for (const index of [-1, 0, 99, 1.5]) expect(markVideoWatched(watched, DATE, index)).toBe(watched);
  });
  it('builds an absent schedule and rejects unknown tasks and invalid durations', () => {
    const state = fresh(); delete state.schedules;
    expect(scheduleVideo(state, DATE, task.id, video).schedules![DATE].items.some(item => item.resourceId === video.videoId)).toBe(true);
    expect(() => scheduleVideo(state, DATE, 'missing', video)).toThrow();
    for (const durationSeconds of [0, -1, NaN, Infinity]) expect(() => scheduleVideo(fresh(), DATE, task.id, { ...video, durationSeconds })).toThrow();
  });
  it.each(['not a URL', 'javascript:alert(1)', 'http://www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://user@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:444/watch?v=abcdefghijk'])('rejects unsafe YouTube URLs: %s', watchUrl => {
    expect(isSafeYouTubeUrl(watchUrl)).toBe(false);
    expect(() => scheduleVideo(fresh(), DATE, task.id, { ...video, watchUrl })).toThrow();
    expect(dailyScheduleSchema.safeParse(plan([{ ...lesson, kind: 'video', resourceId: video.videoId, resourceTitle: video.title, resourceUrl: watchUrl }])).success).toBe(false);
  });
  it('requires complete video records and matching resource IDs while preserving ordinary schedules', () => {
    expect(dailyScheduleSchema.safeParse(plan()).success).toBe(true);
    expect(dailyScheduleSchema.safeParse(plan([{ ...lesson, kind: 'video' }])).success).toBe(false);
    expect(() => scheduleVideo(fresh(), DATE, task.id, { ...video, watchUrl: 'https://youtu.be/lmnopqrstuv' })).toThrow();
    const added = scheduleVideo(fresh(), DATE, task.id, video);
    expect(learningStateSchema.parse(JSON.parse(JSON.stringify(added))).schedules![DATE].items[3].resourceId).toBe(video.videoId);
  });
  it('retains the existing URL contract for non-video schedule resources', () => {
    expect(dailyScheduleSchema.safeParse(plan([{ ...lesson, resourceUrl: 'https://docs.python.org/3/' }])).success).toBe(true);
  });
});

describe('video integration props', () => {
  it('TodaySchedule shows video watched status independently of completed task status and reports its index', () => {
    const added = scheduleVideo(fresh(), DATE, task.id, video);
    const onStart = vi.fn(); const onVideoWatched = vi.fn();
    const props = { schedule: added.schedules![DATE], tasks: [task], progress: { [task.id]: { status: 'completed' as const, completedObjectives: [], evidence: '' } }, reviews: [], budgetMinutes: 40, onStart, onGenerate: vi.fn(), onAdjust: vi.fn(), onVideoWatched };
    const view = render(createElement(TodaySchedule, props));
    const row = screen.getByText(video.title).closest('.today-item')!;
    expect(row.textContent).not.toContain('已完成');
    fireEvent.click(screen.getByRole('link', { name: `打开视频${video.title}` }));
    expect(onVideoWatched).not.toHaveBeenCalled(); expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `标记已观看${video.title}` }));
    expect(onVideoWatched).toHaveBeenCalledWith(3); expect(onStart).not.toHaveBeenCalled();
    view.rerender(createElement(TodaySchedule, { ...props, schedule: markVideoWatched(added, DATE, 3).schedules![DATE], progress: {} }));
    expect(screen.getByText(video.title).closest('.today-item')!.textContent).toContain('已观看（仍需独立练习）');
    expect((screen.getByRole('button', { name: `标记已观看${video.title}` }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('TodaySchedule never exposes unsafe resource URLs or falls through to task completion', () => {
    const schedule = plan([{ ...lesson, kind: 'video', resourceTitle: video.title, resourceUrl: 'javascript:alert(1)' }]);
    render(createElement(TodaySchedule, { schedule, tasks: [task], progress: {}, reviews: [], budgetMinutes: 40, onStart: vi.fn(), onGenerate: vi.fn(), onAdjust: vi.fn() }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: `开始${task.title}` })).toBeNull();
  });
  it('YouTubeResources offers explicit replacement at full budget and suppresses unsafe API links', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input) === '/api/status' ? { accounts: false } : { status: 'metadata-verified', query: 'shape', searchUrl: 'javascript:alert(1)', videos: [video, { ...video, videoId: 'lmnopqrstuv', title: 'Unsafe video', watchUrl: 'https://youtube.com.evil.test/' }], notice: 'Metadata only' }), { status: 200 })));
    const onScheduleVideo = vi.fn();
    render(createElement(YouTubeResources, { task, budgetMinutes: 30, schedule: plan(), onScheduleVideo }));
    const add = await screen.findByRole('button', { name: /加入今日节目表/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: /替换本任务讲解/ }));
    expect(onScheduleVideo).toHaveBeenCalledWith(video, true);
    expect(screen.queryByText('Unsafe video')).toBeNull();
    for (const anchor of document.querySelectorAll('a')) expect(isSafeYouTubeUrl(anchor.href)).toBe(true);
  });
  it('YouTubeResources reports append intent when budget remains and disables selected videos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'metadata-verified', query: 'shape', searchUrl: 'https://www.youtube.com/results?search_query=shape', videos: [video], notice: 'Metadata only' }), { status: 200 })));
    const onScheduleVideo = vi.fn();
    const view = render(createElement(YouTubeResources, { task, budgetMinutes: 40, schedule: plan(), onScheduleVideo }));
    fireEvent.click(await screen.findByRole('button', { name: /加入今日节目表/ }));
    expect(onScheduleVideo).toHaveBeenCalledWith(video, false);
    view.rerender(createElement(YouTubeResources, { task, budgetMinutes: 40, schedule: scheduleVideo(fresh(), DATE, task.id, video).schedules![DATE], onScheduleVideo }));
    expect((await screen.findByRole('button', { name: /已加入今日节目表/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
