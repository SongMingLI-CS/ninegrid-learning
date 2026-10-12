import { useState } from 'react';
import type { LessonContent, Task, TaskProgress } from '../../shared/types';

export interface LessonWorkspaceProps {
  task: Task;
  progress: TaskProgress;
  content?: LessonContent;
  loading?: boolean;
  feedback?: string;
  onEvidence(value: string): void;
  onObjective?(objectiveId: string): void;
  onEvaluate(): void;
  onSelfCheck(): void;
  onComplete(): void;
  onCancel?(): void;
  onHintUsed?(level: number): void;
  busy?: boolean;
  editable?: boolean;
}

export function LessonWorkspace({ task, progress, content, loading = false, feedback, onEvidence, onObjective, onEvaluate, onSelfCheck, onComplete, onCancel, onHintUsed, busy = false, editable = true }: LessonWorkspaceProps) {
  const [hintLevel, setHintLevel] = useState(0);
  const [showChinese, setShowChinese] = useState(false);
  const locked = progress.status === 'completed' || !editable;
  return <article className="lesson-workspace" aria-label="学习工作区">
    <header className="lesson-heading"><div><span className="micro-label">LEARNING WORKSPACE · {task.track === 'branch' ? 'OPTIONAL BRANCH' : 'MAINLINE'}</span><h2>{task.title}</h2><p>{task.brief}</p></div><span className="lesson-time">约 {task.minutes} 分钟</span></header>
    {loading && <div className="lesson-loading" role="status">正在按课程蓝图编写本任务内容…{onCancel&&<button type="button" onClick={onCancel}>取消</button>}</div>}
    <section className="lesson-objectives"><strong>本次能力目标</strong>{task.objectives.map(objective=><label key={objective.id}><input type="checkbox" checked={progress.completedObjectives.includes(objective.id)} disabled={locked} onChange={()=>onObjective?.(objective.id)}/>{objective.text}</label>)}</section>
    {content ? <>
      <section className="lesson-purpose"><strong>这次要解决的问题</strong><p>{content.purpose}</p></section>
      <section className="lesson-explanation"><div className="lesson-section-heading"><h3>讲解</h3><button type="button" className="text-button" onClick={() => setShowChinese(value => !value)}>{showChinese ? '收起中文辅助' : '展开中文辅助'}</button></div><div className="lesson-copy">{content.explanation}</div>
        {showChinese && <dl className="term-list">{content.terms.map((term, index) => <div key={`${term.en}-${index}`}><dt>{term.en}<span>{term.zh}</span></dt><dd>{term.context}</dd></div>)}</dl>}
      </section>
      <section className="lesson-example"><span className="lesson-kicker">01 · 示例 → 预测后运行</span><h3>{content.example.prompt}</h3><pre><code>{content.example.code}</code></pre><p>{content.example.walkthrough}</p></section>
      <section className="lesson-guided"><span className="lesson-kicker">02 · 补全练习</span><h3>{content.guidedPractice.prompt}</h3><p><strong>核对结果：</strong>{content.guidedPractice.expected}</p><details><summary>看一级提示</summary><p>{content.guidedPractice.hint}</p></details></section>
      <section className="lesson-challenge"><span className="lesson-kicker">03 · 独立挑战</span><h3>{content.challenge.prompt}</h3><p><strong>通过标准：</strong>{content.challenge.acceptance}</p><details onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) { const next = Math.min(5, hintLevel + 1); setHintLevel(next); onHintUsed?.(next); } }}><summary>需要提示？（已用 {hintLevel} 级）</summary><ol>{content.challenge.hints.slice(0, Math.max(1, hintLevel)).map((hint, index) => <li key={`${index}-${hint}`}>{hint}</li>)}</ol></details></section>
    </> : <>
      <section className="lesson-explanation"><span className="lesson-kicker">本次问题</span><div className="lesson-copy">{task.brief}</div><p className="lesson-copy">{task.curiosity}</p></section>
      <section className="lesson-example"><span className="lesson-kicker">学习路线</span><ol className="lesson-steps">{task.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol><p>本任务的讲解内容尚未生成。你仍可先使用随课程附带的演示内容、例子或官方资料；AI 联机后可以按需生成详细教学。</p></section>
    </>}
    <section className="lesson-deliverable"><span className="lesson-kicker">交付与验收</span><h3>{task.acceptance}</h3><textarea aria-label="学习答案与成果" value={progress.evidence} disabled={locked} onChange={event => onEvidence(event.target.value)} placeholder="先写自己的预测，再贴代码、输出、解释或卡住的位置。"/><div className="lesson-actions"><button type="button" onClick={onSelfCheck} disabled={busy || locked}>我已独立完成 · 自评</button><button type="button" onClick={onEvaluate} disabled={busy || locked}>{busy ? '核验中…' : '提交给 AI 核验'}</button><button type="button" onClick={onComplete} disabled={busy || locked}>结算任务与奖励</button></div>{progress.selfChecked&&<p className="lesson-feedback" role="status">自我检查已记录；这不是 AI 掌握度或百分制评分。</p>}{progress.status==='completed'&&<p className="lesson-feedback" role="status">成果已保存 · {progress.verification==='ai'?'AI 已核验':'由你自行完成'} · 复习已安排</p>}{feedback && <p className="lesson-feedback" role="status">{feedback}</p>}</section>
  </article>;
}
