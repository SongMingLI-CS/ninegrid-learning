import { ArrowRight, Clock3, Sparkles } from 'lucide-react';
import type { DailySchedule, ReviewCard, Task, TaskProgress } from '../../shared/types';
import { isSafeYouTubeUrl } from '../lib/videoSchedule';

export function TodaySchedule({ schedule, tasks, progress, reviews, recommendedTask, noRecommendation, budgetMinutes, onStart, onGenerate, onAdjust, onVideoWatched, busy, error }: {
  schedule: DailySchedule; tasks: Task[]; progress: Record<string, TaskProgress>; reviews: ReviewCard[]; recommendedTask?: Task; noRecommendation?: string; budgetMinutes: number; onStart: (task: Task, kind: DailySchedule['items'][number]['kind']) => void; onGenerate: () => void;
  onAdjust: (adjustment: 'half'|'more'|'skip-known'|'too-hard') => void; onVideoWatched?: (index: number) => void; busy?: boolean; error?: string;
}) {
  return <section className="today-schedule" aria-label="今日学习节目表">
    <header className="today-heading"><div><span className="micro-label">TODAY'S PROGRAM · {schedule.date}</span><h2>今天先做这一项</h2><p>{schedule.theme}</p></div><button type="button" className="secondary-button" onClick={onGenerate} disabled={busy}><Sparkles size={15}/>{busy ? '正在编排…' : '请 AI 重新编排'}</button></header>
    {error && <p className="today-error" role="status">{error}</p>}
    {recommendedTask && <div className="today-recommendation"><span>实时推荐 · 已排除完成项并检查前置条件</span><strong>{recommendedTask.title}</strong><button type="button" onClick={() => onStart(recommendedTask, 'lesson')} aria-label={`开始推荐任务${recommendedTask.title}`}>开始推荐任务 <ArrowRight size={15}/></button></div>}
    {noRecommendation && <p className="today-recommendation-note" role="status">{noRecommendation}</p>}
    <div className="today-items">{schedule.items.map((item, index) => {
      const task = tasks.find(candidate => candidate.id === item.taskId);
      const reviewDoneToday = item.kind === 'review' && Boolean(reviews.find(card => card.taskId === item.taskId)?.history.some(entry => new Date(entry.at).toLocaleDateString('sv-SE') === schedule.date));
      const itemCompleted = item.kind === 'video' ? item.watched === true : item.kind === 'review' ? reviewDoneToday : progress[item.taskId]?.status === 'completed';
      const safeVideoUrl = item.resourceUrl && isSafeYouTubeUrl(item.resourceUrl) ? item.resourceUrl : undefined;
      return <div className={`today-item ${item.required ? 'today-required' : 'today-optional'}`} key={`${item.taskId}-${item.kind}-${index}`}>
        <span className="today-number">{String(index + 1).padStart(2, '0')}</span><div className="today-item-copy"><span>{item.required ? '必做' : '可选支线'} · {item.kind === 'review' ? '主动回忆' : item.kind === 'lesson' ? '新知识点' : item.kind === 'practice' ? '动手练习' : item.kind === 'video' ? '视频学习' : '复盘'}{itemCompleted ? item.kind === 'video' ? ' · 已观看（仍需独立练习）' : ' · 已完成' : ''}</span><strong>{item.resourceTitle ?? task?.title ?? '回顾已学任务'}</strong><p>{item.deliverable}</p></div><span className="today-duration"><Clock3 size={13}/>{item.minutes} 分钟</span>{item.kind === 'video' ? <>
          {safeVideoUrl && <a className="today-start" href={safeVideoUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开视频${item.resourceTitle ?? ''}`}><ArrowRight size={16}/></a>}
          {onVideoWatched && <button type="button" className="text-button" disabled={busy || item.watched === true} onClick={() => onVideoWatched(index)} aria-label={`标记已观看${item.resourceTitle ?? ''}`}>{item.watched ? '已观看' : '标记已观看'}</button>}
        </> : task && <button type="button" className="today-start" onClick={() => onStart(task, item.kind)} aria-label={item.kind === 'review' ? `开始复习${task.title}` : `开始${task.title}`}><ArrowRight size={16}/></button>}
      </div>;
    })}</div>
    <footer className="today-footer"><span>安排 {schedule.items.reduce((sum, item) => sum + item.minutes, 0)} / 预算 {budgetMinutes} 分钟 · 未完成内容不会无脑堆到明天。</span><p><strong>今天留下：</strong>{schedule.outcome}</p><p><strong>完成后解锁：</strong>{schedule.nextUnlock}</p><div className="today-adjustments"><span>调整今天：</span><button type="button" onClick={() => onAdjust('half')}>时间只有一半</button><button type="button" onClick={() => onAdjust('more')}>今天多学一点</button><button type="button" onClick={() => onAdjust('skip-known')}>这部分已经会了</button><button type="button" onClick={() => onAdjust('too-hard')}>这部分太难了</button></div></footer>
  </section>;
}
