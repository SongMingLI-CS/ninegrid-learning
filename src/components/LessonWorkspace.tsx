import { useEffect, useState } from 'react';
import type { LessonContent, Task, TaskProgress } from '../../shared/types';

export interface LessonWorkspaceProps {
  task: Task;
  progress: TaskProgress;
  content?: LessonContent;
  loading?: boolean;
  feedback?: string;
  onEvidence(value: string): void;
  onSupplementalEvidence?(value: string): void;
  onObjective?(objectiveId: string): void;
  onEvaluate(): void;
  onSelfCheck(): void;
  onComplete(): void;
  onCancel?(): void;
  onHintUsed?(level: number): void;
  busy?: boolean;
  editable?: boolean;
  diagnosticMode?: boolean;
  onDiagnosticFinish?(confidence: 'known' | 'needs-practice', answer: string): void;
}

export function LessonWorkspace({ task, progress, content, loading = false, feedback, onEvidence, onSupplementalEvidence, onObjective, onEvaluate, onSelfCheck, onComplete, onCancel, onHintUsed, busy = false, editable = true, diagnosticMode = false, onDiagnosticFinish }: LessonWorkspaceProps) {
  const [hintLevel, setHintLevel] = useState(0);
  const [showChinese, setShowChinese] = useState(false);
  const [diagnosticAnswer, setDiagnosticAnswer] = useState('');
  useEffect(() => { setHintLevel(0); setShowChinese(false); setDiagnosticAnswer(progress.evidence); }, [task.id, diagnosticMode]);
  const locked = progress.status === 'completed' || !editable;
  const canReverify = progress.status === 'completed' && progress.verification === 'self';
  const canSettle = progress.status === 'completed'
    ? canReverify && progress.evaluationSource === 'ai' && Boolean(progress.evaluation?.passed && progress.evaluation.score >= 70)
    : Boolean(progress.selfChecked || progress.evaluationSource === 'ai' && progress.evaluation?.passed);
  return <article className="lesson-workspace" aria-label="学习工作区">
    <header className="lesson-heading"><div><span className="micro-label">LEARNING WORKSPACE · {task.track === 'branch' ? 'OPTIONAL BRANCH' : 'MAINLINE'}</span><h2>{task.title}</h2><p>{task.brief}</p></div><span className="lesson-time">约 {task.minutes} 分钟</span></header>
    {loading && <div className="lesson-loading" role="status">正在按课程蓝图编写本任务内容…{onCancel&&<button type="button" onClick={onCancel}>取消</button>}</div>}
    {diagnosticMode && <section className="lesson-diagnostic"><span className="lesson-kicker">两分钟掌握诊断</span><h3>{task.recallQuestion}</h3><label>先闭卷写下你的预测<textarea aria-label="两分钟诊断回答" value={diagnosticAnswer} onChange={event => { setDiagnosticAnswer(event.target.value); onEvidence(event.target.value); }} placeholder="写下预测结果、理由或一个简短解题步骤。"/></label><p>通关标准：{task.acceptance}</p><div className="lesson-actions"><button type="button" onClick={() => onDiagnosticFinish?.('known', diagnosticAnswer.trim())} disabled={diagnosticAnswer.trim().length < 20}>我达到标准 · 记录诊断通关</button><button type="button" onClick={() => onDiagnosticFinish?.('needs-practice', diagnosticAnswer.trim())} disabled={diagnosticAnswer.trim().length < 20}>还不确定 · 保存回答并进入补练</button></div><small>诊断通关计为自行完成；不会显示 AI 验证，也不发高价值道具。</small></section>}
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
    <section className="lesson-deliverable"><span className="lesson-kicker">交付与验收</span><h3>{task.acceptance}</h3><label className="evidence-label">原始完成证据<textarea aria-label="学习答案与成果" value={progress.evidence} disabled={locked} onChange={event => onEvidence(event.target.value)} placeholder="先写自己的预测，再贴代码、输出、解释或卡住的位置。"/></label>{canReverify && <label className="evidence-label supplemental-evidence">补充证据（可选）<textarea aria-label="补充证据" value={progress.supplementalEvidence ?? ''} onChange={event => onSupplementalEvidence?.(event.target.value)} placeholder="补充新的运行结果、解释或修正后的作品；原始完成记录会保留。"/></label>}<div className="lesson-actions"><button type="button" onClick={onSelfCheck} disabled={busy || locked}>我已独立完成 · 自评</button><button type="button" onClick={onEvaluate} disabled={busy || (progress.status === 'completed' ? !canReverify : !editable)}>{busy ? '核验中…' : canReverify ? '基于原证据请求 AI 核验' : '提交给 AI 核验'}</button><button type="button" onClick={onComplete} disabled={busy || !canSettle}>{canReverify ? '升级为 AI 验证' : '结算任务与奖励'}</button></div>{progress.selfChecked&&<p className="lesson-feedback" role="status">自我检查已记录；这不是 AI 掌握度或百分制评分。</p>}{progress.status==='completed'&&<p className="lesson-feedback" role="status">成果已保存 · {progress.verification==='ai'?'AI 已核验':'由你自行完成'} · 复习已安排</p>}{feedback && <p className="lesson-feedback" role="status">{feedback}</p>}</section>
  </article>;
}
