import { useEffect, useRef, useState } from 'react';
import type { LessonContent, Task, TaskProgress } from '../../shared/types';
import { apiFetch } from '../lib/api';

export interface LessonWorkspaceProps {
  task: Task;
  seasonId?: string;
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

export function LessonWorkspace({ task, seasonId, progress, content, loading = false, feedback, onEvidence, onSupplementalEvidence, onObjective, onEvaluate, onSelfCheck, onComplete, onCancel, onHintUsed, busy = false, editable = true, diagnosticMode = false, onDiagnosticFinish }: LessonWorkspaceProps) {
  const [hintLevel, setHintLevel] = useState(0);
  const [showChinese, setShowChinese] = useState(false);
  const [diagnosticAnswer, setDiagnosticAnswer] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageAnalysis, setImageAnalysis] = useState<{ recognizedText: string; analysis: string; uncertainties: string[]; nextStep: string }>();
  const imageRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    imageRequest.current?.abort(); setHintLevel(0); setShowChinese(false); setDiagnosticAnswer(progress.evidence); setAttachmentId(''); setImageAnalysis(undefined); setImageError('');
    if (!seasonId) return;
    const controller = new AbortController(); imageRequest.current = controller;
    void apiFetch(`/api/seasons/${seasonId}/tasks/${task.id}/attachments`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('附件列表暂不可用'); return response.json(); })
      .then(payload => { if (!controller.signal.aborted && payload.attachments?.[0]) setAttachmentId(payload.attachments[0].id); })
      .catch(error => { if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : '附件恢复失败'); });
    return () => controller.abort();
  }, [task.id, seasonId, diagnosticMode]);
  const uploadImage = async (file?: File) => {
    if (!file || !seasonId) return;
    setImageBusy(true); setImageError(''); setImageAnalysis(undefined);
    const controller = new AbortController(); imageRequest.current?.abort(); imageRequest.current = controller;
    try {
      const form = new FormData(); form.set('image', file);
      const response = await apiFetch(`/api/seasons/${seasonId}/tasks/${task.id}/attachments`, { method: 'POST', body: form, signal: controller.signal });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? '图片上传失败');
      if (!controller.signal.aborted) setAttachmentId(payload.attachment.id);
    } catch (error) { if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : '图片上传失败；文字答案仍然保留'); }
    finally { setImageBusy(false); }
  };
  const analyzeImage = async (question: 'explain' | 'check' | 'relate') => {
    if (!attachmentId) return;
    setImageBusy(true); setImageError('');
    const controller = new AbortController(); imageRequest.current?.abort(); imageRequest.current = controller;
    try {
      const response = await apiFetch(`/api/attachments/${attachmentId}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal: controller.signal });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? '图片理解暂不可用');
      if (!controller.signal.aborted) setImageAnalysis(payload.analysis);
    } catch (error) { if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : '图片分析失败；图片和文字答案仍已保留'); }
    finally { setImageBusy(false); }
  };
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
      {content.sourceBasis && <p className="source-provenance" role="note">材料依据：{content.sourceBasis === 'none' ? '无用户材料，本课使用通用知识。' : content.sourceBasis === 'material' ? '直接依据本次提供的材料摘录。' : '材料摘录与通用补充已区分。'}{content.sourceNotes?.length ? ` ${content.sourceNotes.join('；')}` : ''}</p>}
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
    <section className="lesson-deliverable">
      <span className="lesson-kicker">交付与验收</span><h3>{task.acceptance}</h3>
      <label className="evidence-label">原始完成证据<textarea aria-label="学习答案与成果" value={progress.evidence} disabled={locked} onChange={event => onEvidence(event.target.value)} placeholder="先写自己的预测，再贴代码、输出、解释或卡住的位置。"/></label>
      {canReverify && <label className="evidence-label supplemental-evidence">补充证据（可选）<textarea aria-label="补充证据" value={progress.supplementalEvidence ?? ''} onChange={event => onSupplementalEvidence?.(event.target.value)} placeholder="补充新的运行结果、解释或修正后的作品；原始完成记录会保留。"/></label>}
      {seasonId && <section className="image-evidence">
        <strong>学习图片与过程检查</strong><p>可上传题目截图、手写过程或运行结果。图片分析用于辅助反馈，不单独证明掌握。</p>
        <label>选择图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={event => void uploadImage(event.target.files?.[0])}/></label>
        {imageBusy && <span role="status">图片处理中…</span>}{imageError && <p role="alert">{imageError}</p>}
        {attachmentId && <>
          <img src={`/api/attachments/${attachmentId}`} alt="当前任务的私有学习附件"/>
          <div className="lesson-actions"><button type="button" disabled={imageBusy} onClick={() => void analyzeImage('explain')}>解释这张图</button><button type="button" disabled={imageBusy} onClick={() => void analyzeImage('check')}>检查我的步骤</button><button type="button" disabled={imageBusy} onClick={() => void analyzeImage('relate')}>关联当前知识点</button></div>
        </>}
        {imageAnalysis && <div className="lesson-feedback"><strong>识别到的内容：</strong>{imageAnalysis.recognizedText || '没有识别到清晰文字'}<p>{imageAnalysis.analysis}</p>{imageAnalysis.uncertainties.length > 0 && <p>不确定处：{imageAnalysis.uncertainties.join('；')}</p>}<p>下一步：{imageAnalysis.nextStep}</p><small>图片本身未被视为独立掌握证明。</small></div>}
      </section>}
      <div className="lesson-actions"><button type="button" onClick={onSelfCheck} disabled={busy || locked}>我已独立完成 · 自评</button><button type="button" onClick={onEvaluate} disabled={busy || (progress.status === 'completed' ? !canReverify : !editable)}>{busy ? '核验中…' : canReverify ? '基于原证据请求 AI 核验' : '提交给 AI 核验'}</button><button type="button" onClick={onComplete} disabled={busy || !canSettle}>{canReverify ? '升级为 AI 验证' : '结算任务与奖励'}</button></div>
      {progress.selfChecked && <p className="lesson-feedback" role="status">自我检查已记录；这不是 AI 掌握度或百分制评分。</p>}
      {progress.status === 'completed' && <p className="lesson-feedback" role="status">成果已保存 · {progress.verification === 'ai' ? 'AI 已核验' : '由你自行完成'} · 复习已安排</p>}
      {feedback && <p className="lesson-feedback" role="status">{feedback}</p>}
    </section>
  </article>;
}
