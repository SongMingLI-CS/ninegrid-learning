import { ArrowRight, Clock3, Sparkles } from 'lucide-react';
import type { DailySchedule, Task } from '../../shared/types';

export function TodaySchedule({ schedule, tasks, budgetMinutes, onStart, onGenerate, onAdjust, busy, error }: {
  schedule: DailySchedule; tasks: Task[]; budgetMinutes: number; onStart: (task: Task) => void; onGenerate: () => void;
  onAdjust: (adjustment: 'half'|'more'|'skip-known'|'too-hard') => void; busy?: boolean; error?: string;
}) {
  return <section className="today-schedule" aria-label="今日学习节目表">
    <header className="today-heading"><div><span className="micro-label">TODAY'S PROGRAM · {schedule.date}</span><h2>今天先做这一项</h2><p>{schedule.theme}</p></div><button type="button" className="secondary-button" onClick={onGenerate} disabled={busy}><Sparkles size={15}/>{busy ? '正在编排…' : '请 AI 重新编排'}</button></header>
    {error && <p className="today-error" role="status">{error}</p>}
    <div className="today-items">{schedule.items.map((item, index) => {
      const task = tasks.find(candidate => candidate.id === item.taskId);
      return <div className={`today-item ${item.required ? 'today-required' : 'today-optional'}`} key={`${item.taskId}-${item.kind}-${index}`}>
        <span className="today-number">{String(index + 1).padStart(2, '0')}</span><div className="today-item-copy"><span>{item.required ? '必做' : '可选支线'} · {item.kind === 'review' ? '主动回忆' : item.kind === 'lesson' ? '新知识点' : item.kind === 'practice' ? '动手练习' : '复盘'}</span><strong>{task?.title ?? '回顾已学任务'}</strong><p>{item.deliverable}</p></div><span className="today-duration"><Clock3 size={13}/>{item.minutes} 分钟</span>{task && <button type="button" className="today-start" onClick={() => onStart(task)} aria-label={`开始${task.title}`}><ArrowRight size={16}/></button>}
      </div>;
    })}</div>
    <footer className="today-footer"><span>安排 {schedule.totalMinutes} / 预算 {budgetMinutes} 分钟 · 未完成内容不会无脑堆到明天。</span><p><strong>今天留下：</strong>{schedule.outcome}</p><p><strong>完成后解锁：</strong>{schedule.nextUnlock}</p><div className="today-adjustments"><span>调整今天：</span><button type="button" onClick={() => onAdjust('half')}>时间只有一半</button><button type="button" onClick={() => onAdjust('more')}>今天多学一点</button><button type="button" onClick={() => onAdjust('skip-known')}>这部分已经会了</button><button type="button" onClick={() => onAdjust('too-hard')}>这部分太难了</button></div></footer>
  </section>;
}
