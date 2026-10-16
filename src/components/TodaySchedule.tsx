import { ArrowRight, Clock3, Sparkles } from 'lucide-react';
import type { DailySchedule, ReviewCard, Task, TaskProgress } from '../../shared/types';
import { isSafeYouTubeUrl } from '../lib/videoSchedule';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export function TodaySchedule({ seasonTitle, schedule, tasks, progress, reviews, recommendedTask, noRecommendation, budgetMinutes, onStart, onGenerate, onAdjust, onVideoWatched, busy, error }: {
  seasonTitle?: string; schedule: DailySchedule; tasks: Task[]; progress: Record<string, TaskProgress>; reviews: ReviewCard[]; recommendedTask?: Task; noRecommendation?: string; budgetMinutes: number; onStart: (task: Task, kind: DailySchedule['items'][number]['kind']) => void; onGenerate: () => void;
  onAdjust: (adjustment: 'half'|'more'|'skip-known'|'too-hard') => void; onVideoWatched?: (index: number) => void; busy?: boolean; error?: string;
}) {
  const plannedMinutes = schedule.items.reduce((sum, item) => sum + item.minutes, 0);
  const dueReviews = reviews.filter(card => new Date(card.dueAt).getTime() <= new Date(`${schedule.date}T23:59:59`).getTime()).length;

  return <section className="today-schedule ng-today" aria-label="今日学习安排">
    <header className="today-heading ng-today-heading">
      <div className="ng-section-heading">
        {seasonTitle && <Badge variant="secondary" className="ng-current-season">当前赛季 · {seasonTitle}</Badge>}
        <Badge variant="outline">{schedule.date}</Badge>
        <h2>今天的学习计划</h2>
        <p>{schedule.theme}</p>
      </div>
      <div className="ng-today-meta" aria-label="今天的时间安排">
        <span><Clock3 size={16}/><strong>{plannedMinutes} 分钟</strong> / {budgetMinutes} 分钟预算</span>
        <span>{dueReviews ? `待复习 ${dueReviews} 项` : '暂无到期复习'}</span>
        <Button type="button" variant="outline" onClick={onGenerate} disabled={busy}><Sparkles size={16}/>{busy ? '正在编排…' : '重新编排'}</Button>
      </div>
    </header>

    {error && <p className="today-error" role="alert">{error}</p>}

    {recommendedTask ? <section className="today-recommendation ng-next-task" aria-label="推荐学习任务">
      <div>
        <span className="ng-next-label">实时推荐 · 建议从这里继续</span>
        <h3>{recommendedTask.title}</h3>
        <p>{recommendedTask.brief}</p>
        <div className="ng-next-context"><Badge>{recommendedTask.track === 'branch' ? '可选支线' : '主线任务'}</Badge><span>约 {recommendedTask.minutes} 分钟</span><span>完成条件：{recommendedTask.acceptance}</span></div>
      </div>
      <Button type="button" size="lg" onClick={() => onStart(recommendedTask, 'lesson')} aria-label={`开始推荐任务${recommendedTask.title}`}>开始学习 <ArrowRight size={16}/></Button>
    </section> : noRecommendation ? <div className="today-recommendation-note" role="status"><strong>当前没有可开始的推荐任务</strong><p>{noRecommendation}</p></div> : <div className="today-recommendation-note" role="status"><strong>今天还没有安排</strong><p>你可以在赛季页选择任务，或根据当前目标生成一份轻量计划。</p></div>}

    <details className="today-full-plan">
      <summary>查看完整安排 <span>{schedule.items.length} 项 · {plannedMinutes} 分钟</span></summary>
      <div className="today-items">{schedule.items.map((item, index) => {
        const task = tasks.find(candidate => candidate.id === item.taskId);
        const reviewDoneToday = item.kind === 'review' && Boolean(reviews.find(card => card.taskId === item.taskId)?.history.some(entry => new Date(entry.at).toLocaleDateString('sv-SE') === schedule.date));
        const itemCompleted = item.kind === 'video' ? item.watched === true : item.kind === 'review' ? reviewDoneToday : progress[item.taskId]?.status === 'completed';
        const safeVideoUrl = item.resourceUrl && isSafeYouTubeUrl(item.resourceUrl) ? item.resourceUrl : undefined;
        const kindLabel = item.kind === 'review' ? '主动回忆' : item.kind === 'lesson' ? '新知识点' : item.kind === 'practice' ? '动手练习' : item.kind === 'video' ? '视频学习' : '复盘';
        return <div className={`today-item ${item.required ? 'today-required' : 'today-optional'}`} key={`${item.taskId}-${item.kind}-${index}`}>
          <span className="today-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="today-item-copy"><div className="ng-item-labels"><Badge variant={item.required ? 'secondary' : 'outline'}>{item.required ? '必做' : '可选支线'}</Badge><span>{kindLabel}{itemCompleted ? item.kind === 'video' ? ' · 已观看（仍需独立练习）' : ' · 已完成' : ''}</span></div><strong>{item.resourceTitle ?? task?.title ?? '回顾已学任务'}</strong><p>{item.deliverable}</p></div>
          <span className="today-duration"><Clock3 size={14}/>{item.minutes} 分钟</span>
          {item.kind === 'video' ? <>
            {safeVideoUrl && <Button variant="ghost" size="icon" asChild><a className="today-start" href={safeVideoUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开视频${item.resourceTitle ?? ''}`}><ArrowRight size={16}/></a></Button>}
            {onVideoWatched && <Button type="button" variant="outline" size="sm" disabled={busy || item.watched === true} onClick={() => onVideoWatched(index)} aria-label={`标记已观看${item.resourceTitle ?? ''}`}>{item.watched ? '已观看' : '标记已观看'}</Button>}
          </> : task && <Button type="button" variant="secondary" size="icon" className="today-start" onClick={() => onStart(task, item.kind)} aria-label={item.kind === 'review' ? `开始复习${task.title}` : `开始${task.title}`}><ArrowRight size={16}/></Button>}
        </div>;
      })}</div>
    </details>

    <Separator className="ng-separator" />
    <footer className="today-footer ng-today-footer">
      <div><span>今天留下</span><p>{schedule.outcome}</p></div>
      <div><span>完成后继续</span><p>{schedule.nextUnlock}</p></div>
      <details className="today-adjustments"><summary>调整今天的安排</summary><div><Button variant="outline" size="sm" onClick={() => onAdjust('half')}>时间只有一半</Button><Button variant="outline" size="sm" onClick={() => onAdjust('more')}>今天多学一点</Button><Button variant="outline" size="sm" onClick={() => onAdjust('skip-known')}>这部分已经会了</Button><Button variant="outline" size="sm" onClick={() => onAdjust('too-hard')}>这部分太难了</Button></div></details>
    </footer>
  </section>;
}
