import { useEffect, useRef, useState } from 'react';
import type { LessonContent, Task, TaskAttempt, TaskProgress } from '../../shared/types';
import { lessonExposesReferenceAnswer, taskChallengeContract } from '../../shared/learningChallenge';
import { apiFetch } from '../lib/api';
import { currentTaskVerification, taskEvidenceText } from '../lib/engine';

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
  onEvaluate(mode?: 'standard' | 'feynman', feynmanSessionId?: string): void;
  onSelfCheck(): void;
  onComplete(): void;
  onCancel?(): void;
  onHintUsed?(level: number): void;
  onAnswerRevealed?(): void;
  onRequestTransfer?(): void;
  busy?: boolean;
  editable?: boolean;
  diagnosticMode?: boolean;
  onDiagnosticFinish?(confidence: 'known' | 'needs-practice', answer: string): void;
  onRescue?(): void;
  rescueLevel?: number;
  failedAttempts?: number;
  latestFailedAttempt?: TaskAttempt;
  attempts?: TaskAttempt[];
  feynmanAvailable?: boolean;
  focusMode?: boolean;
  onToggleFocusMode?(): void;
}

export function LessonWorkspace({ task, seasonId, progress, content, loading = false, feedback, onEvidence, onSupplementalEvidence, onObjective, onEvaluate, onSelfCheck, onComplete, onCancel, onHintUsed, onAnswerRevealed, onRequestTransfer, onRescue, rescueLevel = 0, failedAttempts = 0, latestFailedAttempt, attempts = [], feynmanAvailable = false, focusMode = false, onToggleFocusMode, busy = false, editable = true, diagnosticMode = false, onDiagnosticFinish }: LessonWorkspaceProps) {
  const [hintLevel, setHintLevel] = useState(progress.hintLevelsUsed ?? 0);
  const [answerVisible, setAnswerVisible] = useState(progress.answerRevealed ?? false);
  const [showChinese, setShowChinese] = useState(false);
  const [feynmanMode, setFeynmanMode] = useState(false);
  const [feynmanSession, setFeynmanSession] = useState<{ id: string; revision: number; status: 'active'|'ready'|'settled'|'assisted'; transcript: { messages: Array<{role:'learner'|'tutor';text:string}>; questions: string[]; rounds: number } }>();
  const [feynmanAnswer, setFeynmanAnswer] = useState('');
  const [feynmanBusy, setFeynmanBusy] = useState(false);
  const [feynmanError, setFeynmanError] = useState('');
  const [diagnosticAnswer, setDiagnosticAnswer] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageAnalysis, setImageAnalysis] = useState<{ recognizedText: string; analysis: string; uncertainties: string[]; nextStep: string }>();
  const imageRequest = useRef<AbortController | null>(null);
  const exampleContainsAnswer = Boolean(content && lessonExposesReferenceAnswer(content));
  useEffect(() => {
    imageRequest.current?.abort(); setHintLevel(progress.hintLevelsUsed ?? 0); setAnswerVisible(progress.answerRevealed ?? false); setShowChinese(false); setFeynmanMode(false); setDiagnosticAnswer(progress.evidence); setAttachmentId(''); setImageAnalysis(undefined); setImageError('');
    if (!seasonId) return;
    const controller = new AbortController(); imageRequest.current = controller;
    void apiFetch(`/api/seasons/${seasonId}/tasks/${task.id}/attachments`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('附件列表暂不可用'); return response.json(); })
      .then(payload => { if (!controller.signal.aborted && payload.attachments?.[0]) setAttachmentId(payload.attachments[0].id); })
      .catch(error => { if (!controller.signal.aborted) setImageError(error instanceof Error ? error.message : '附件恢复失败'); });
    return () => controller.abort();
  }, [task.id, seasonId, diagnosticMode, content?.revision, progress.hintLevelsUsed, progress.answerRevealed]);
  useEffect(() => {
    setFeynmanSession(undefined); setFeynmanAnswer(''); setFeynmanError('');
    if (!seasonId || task.kind !== 'boss') return;
    const controller = new AbortController();
    void apiFetch(`/api/seasons/${seasonId}/tasks/${task.id}/feynman-session`, {signal:controller.signal})
      .then(async response => { if (!response.ok) throw new Error('费曼记录暂不可用'); return response.json(); })
      .then(payload => { const value=payload.session; if(value && !controller.signal.aborted) { setFeynmanSession({id:value.id,revision:value.revision,status:value.status,transcript:value.transcript}); const messages=value.transcript.messages; const last=messages.at(-1); const previous=messages.at(-2); if(value.status==='active'&&last?.role==='learner'&&previous?.role==='tutor'&&previous.text===value.transcript.questions[value.transcript.rounds])setFeynmanAnswer(last.text); } })
      .catch(error => { if (!controller.signal.aborted) setFeynmanError(error instanceof Error ? error.message : '费曼记录恢复失败'); });
    return () => controller.abort();
  }, [task.id, seasonId, content?.revision]);
  useEffect(() => {
    if (exampleContainsAnswer && !progress.answerRevealed) onAnswerRevealed?.();
  }, [task.id, seasonId, content?.revision, exampleContainsAnswer, progress.answerRevealed]);
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
  const lessonRevision = content?.revision ?? task.teaching?.revision;
  const currentVerification = currentTaskVerification(progress, lessonRevision);
  const evidenceLength = taskEvidenceText(progress).trim().length;
  const canReverify = progress.status === 'completed' && progress.verification === 'self' && !progress.answerRevealed && evidenceLength >= 20;
  const canSettle = progress.status === 'completed'
    ? canReverify && currentVerification === 'ai'
    : editable && !progress.answerRevealed && evidenceLength >= 20 && currentVerification !== null;
  const settlementStatus = progress.status === 'completed'
    ? canReverify ? currentVerification === 'ai' ? '当前答案已通过 AI 核验，可升级验证等级；不会重复发放任务奖励。' : '已按自评完成并结算；如需升级为 AI 验证，请对当前证据重新核验。' : '任务已结算，奖励不会重复发放。'
    : !editable ? '请先完成前置任务后再验收当前任务。'
      : progress.answerRevealed ? '参考答案已查看；当前提交只用于学习反馈，请先生成新的同目标挑战。'
        : evidenceLength < 20 ? '先提交至少 20 个字符的答案或成果证据，再进行自评或 AI 核验。'
          : currentVerification === 'ai' ? '当前答案已通过 AI 核验，可以结算奖励。'
            : currentVerification === 'self' ? '当前答案已记录自评，可以按自评完成；这不等于 AI 验证。'
              : '完成当前答案的自评，或提交给 AI 核验；结算会使用与当前答案和讲解版本对应的记录。';
  const taskChallenge = content?.challenge ?? taskChallengeContract(task);
  const startFeynman = async () => {
    if (!seasonId || !content || !progress.evidence.trim()) { setFeynmanError('先保存至少 20 个字的概念解释、例子和适用条件。'); return; }
    setFeynmanBusy(true); setFeynmanError('');
    try {
      const response = await apiFetch('/api/feynman-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),seasonId,taskId:task.id,lessonRevision:content.revision,explanation:progress.evidence})});
      const payload=await response.json(); if(!response.ok) throw new Error(payload.error??'费曼追问生成失败');
      const value=payload.session; setFeynmanSession({id:value.id,revision:value.revision,status:value.status,transcript:value.transcript});
    } catch(error) { setFeynmanError(error instanceof Error?error.message:'请求失败；解释已保留，可以重试。'); }
    finally { setFeynmanBusy(false); }
  };
  const replyFeynman = async () => {
    if (!feynmanSession || !feynmanAnswer.trim()) return;
    setFeynmanBusy(true); setFeynmanError('');
    try {
      const response=await apiFetch(`/api/feynman-sessions/${feynmanSession.id}/reply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:feynmanSession.revision,answer:feynmanAnswer})});
      const payload=await response.json(); if(payload.session) setFeynmanSession({id:payload.session.id,revision:payload.session.revision,status:payload.session.status,transcript:payload.session.transcript}); if(!response.ok) throw new Error(payload.answerSaved?'AI 暂不可用；回答已保存，可直接重试或稍后继续。':payload.error??'追问答案保存失败');
      const value=payload.session; setFeynmanSession({id:value.id,revision:value.revision,status:value.status,transcript:value.transcript}); setFeynmanAnswer('');
    } catch(error) { setFeynmanError(error instanceof Error?error.message:'网络失败；答案仍在输入框中，可以重试。'); }
    finally { setFeynmanBusy(false); }
  };
  return <article className={`lesson-workspace ${focusMode ? 'lesson-focus-mode' : ''}`} aria-label="学习工作区">
    <header className="lesson-heading"><div><span className="micro-label">LEARNING WORKSPACE · {task.track === 'branch' ? 'OPTIONAL BRANCH' : 'MAINLINE'}</span><h2>{task.title}</h2><p>{task.brief}</p></div><div className="lesson-heading-actions"><span className="lesson-time">约 {task.minutes} 分钟</span>{onToggleFocusMode && <button type="button" className="secondary-button focus-mode-toggle" aria-pressed={focusMode} onClick={onToggleFocusMode}>{focusMode ? '退出专注' : '专注学习'}</button>}</div></header>
    {loading && <div className="lesson-loading" role="status">正在按课程蓝图编写本任务内容…{onCancel&&<button type="button" onClick={onCancel}>取消</button>}</div>}
    {diagnosticMode && <section className="lesson-diagnostic"><span className="lesson-kicker">两分钟掌握诊断</span><h3>{task.recallQuestion}</h3><label>先闭卷写下你的预测<textarea aria-label="两分钟诊断回答" value={diagnosticAnswer} onChange={event => { setDiagnosticAnswer(event.target.value); onEvidence(event.target.value); }} placeholder="写下预测结果、理由或一个简短解题步骤。"/></label><p>通关标准：{task.acceptance}</p><div className="lesson-actions"><button type="button" onClick={() => onDiagnosticFinish?.('known', diagnosticAnswer.trim())} disabled={diagnosticAnswer.trim().length < 20}>我达到标准 · 记录诊断通关</button><button type="button" onClick={() => onDiagnosticFinish?.('needs-practice', diagnosticAnswer.trim())} disabled={diagnosticAnswer.trim().length < 20}>还不确定 · 保存回答并进入补练</button></div><small>诊断通关计为自行完成；不会显示 AI 验证，也不发高价值道具。</small></section>}
    <section className="lesson-objectives"><strong>本次能力目标</strong>{task.objectives.map(objective=><label key={objective.id}><input type="checkbox" checked={progress.completedObjectives.includes(objective.id)} disabled={locked} onChange={()=>onObjective?.(objective.id)}/>{objective.text}</label>)}</section>
    {content ? <>
      <section className="lesson-purpose"><strong>这次要解决的问题</strong><p>{content.purpose}</p></section>
      {content.sourceBasis && <p className="source-provenance" role="note">材料依据：{content.sourceBasis === 'none' ? '无用户材料，本课使用通用知识。' : content.sourceBasis === 'material' ? '直接依据本次提供的材料摘录。' : '材料摘录与通用补充已区分。'}{content.sourceNotes?.length ? ` ${content.sourceNotes.join('；')}` : ''}</p>}
      <section className="lesson-explanation"><div className="lesson-section-heading"><h3>讲解</h3><button type="button" className="text-button" onClick={() => setShowChinese(value => !value)}>{showChinese ? '收起中文辅助' : '展开中文辅助'}</button></div><div className="lesson-copy">{content.explanation}</div>
        {showChinese && <dl className="term-list">{content.terms.map((term, index) => <div key={`${term.en}-${index}`}><dt>{term.en}<span>{term.zh}</span></dt><dd>{term.context}</dd></div>)}</dl>}
      </section>
      <section className="lesson-example"><span className="lesson-kicker">01 · 示例 · {content.example.kind === 'code' ? '先预测，再运行' : '阅读材料示例'}</span><h3>{content.example.prompt}</h3>{content.example.kind === 'code' ? <pre><code>{content.example.content}</code></pre> : <blockquote>{content.example.content}</blockquote>}<p>{content.example.walkthrough}</p></section>
      <section className="lesson-guided"><span className="lesson-kicker">02 · 补全练习</span><h3>{content.guidedPractice.prompt}</h3><p><strong>核对结果：</strong>{content.guidedPractice.expected}</p><details><summary>看一级提示</summary><p>{content.guidedPractice.hint}</p></details></section>
      <section className="lesson-challenge"><span className="lesson-kicker">03 · 本任务独立验收 · 版本 {content.revision}</span><h3>{taskChallenge.prompt}</h3><div><strong>作答前评分维度</strong><ul>{taskChallenge.rubric.map((criterion, index) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ul><p>提交自己完成的结果与关键依据。示例和补全练习用于学习，不计作这项独立验收。</p></div>{exampleContainsAnswer && <p className="lesson-feedback" role="status">教学示例已包含本题参考答案；本版本仅用于学习反馈，无法作为独立掌握证明。请生成同目标迁移题。</p>}<details onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) { const next = Math.min(5, hintLevel + 1); if (next > hintLevel) { setHintLevel(next); onHintUsed?.(next); } } }}><summary>需要提示？（已用 {hintLevel} 级）</summary><ol>{content.challenge.hints.slice(0, hintLevel).map((hint, index) => <li key={`${index}-${hint}`}>{hint}</li>)}</ol></details><div className="answer-disclosure"><button type="button" disabled={busy || locked} onClick={() => { if (!answerVisible) { setAnswerVisible(true); onAnswerRevealed?.(); } }}>{answerVisible ? '参考答案已查看' : exampleContainsAnswer ? '参考答案已出现在示例中' : '查看参考答案'}</button> {(answerVisible || exampleContainsAnswer) && <><p>{content.challenge.referenceAnswer}</p><small>{exampleContainsAnswer ? '本题答案已出现在教学内容中；' : '你已查看本题答案；'}当前版本只提供学习反馈，不计独立掌握。</small><button type="button" onClick={onRequestTransfer} disabled={busy || locked}>生成同目标迁移题</button></>}</div></section>
    </> : <>
      <section className="lesson-explanation"><span className="lesson-kicker">本次问题</span><div className="lesson-copy">{task.brief}</div><p className="lesson-copy">{task.curiosity}</p></section>
      <section className="lesson-example"><span className="lesson-kicker">学习路线</span><ol className="lesson-steps">{task.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol><p>本任务的讲解内容尚未生成。你仍可先使用随课程附带的演示内容、例子或官方资料；AI 联机后可以按需生成详细教学。</p></section>
    </>}
    <section className="lesson-deliverable">
      <span className="lesson-kicker">提交结果与过程证据</span><p>验收按本赛季保存的任务目标、验收标准、当前挑战版本和本次作答帮助状态执行。</p>
      {feynmanAvailable && <div className="feynman-mode"><div><strong>费曼教给新手</strong><p>先用自己的话解释、举例并说明适用条件。服务端依据你的解释提出最多两轮追问；答案会保存到当前账号。</p></div><button type="button" aria-pressed={feynmanMode} disabled={busy || locked} onClick={() => setFeynmanMode(value => !value)}>{feynmanMode ? '当前：费曼验收' : '开始费曼验收'}</button>{feynmanMode && <div className="feynman-flow">{!feynmanSession ? <><p>先填写上方“原始完成证据”，然后生成针对性追问。</p><button type="button" onClick={()=>void startFeynman()} disabled={feynmanBusy || !seasonId}>{feynmanBusy?'正在分析…':'根据解释生成追问'}</button></> : <><ol>{feynmanSession.transcript.messages.map((message,index)=><li key={index}><b>{message.role==='learner'?'你的回答':'追问'}</b>：{message.text}</li>)}</ol>{feynmanSession.status==='active' && <><p className="feynman-prompt">{feynmanSession.transcript.questions[feynmanSession.transcript.rounds]}</p><label>回答追问<textarea aria-label="费曼追问回答" value={feynmanAnswer} onChange={event=>setFeynmanAnswer(event.target.value)} placeholder="回答当前问题；可以保存后稍后继续。"/></label><button type="button" onClick={()=>void replyFeynman()} disabled={feynmanBusy || !feynmanAnswer.trim()}>{feynmanBusy?'保存中…':feynmanError.includes('回答已保存')?'重试该回答':'保存回答并继续'}</button></>}{feynmanSession.status==='ready'&&<><p>追问完成。服务端将依据原任务必需标准核验整段解释和回答。</p><button type="button" onClick={()=>onEvaluate('feynman',feynmanSession.id)} disabled={busy}>提交最终费曼验收</button></>}{feynmanSession.status==='settled'&&<p role="status">这次费曼验收已完成；问答记录已恢复。</p>}{feynmanSession.status==='assisted'&&<p role="status">这次记录仅用于反馈或已由后续尝试替代，不能作为独立掌握凭证。</p>}</>}{feynmanError&&<p role="alert">{feynmanError}</p>}</div>}</div>}
      <label className="evidence-label">原始完成证据<textarea aria-label="学习答案与成果" value={progress.evidence} disabled={locked} onChange={event => onEvidence(event.target.value)} placeholder={feynmanMode ? '概念解释：…\n具体例子：…\n适用条件或常见误区：…\n追问回答：…' : '先写自己的预测，再贴代码、输出、解释或卡住的位置。'}/></label>
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
      <p className="settlement-status" role="status">{settlementStatus}</p>
      <div className="lesson-actions"><button type="button" onClick={onSelfCheck} disabled={busy || locked || progress.answerRevealed || evidenceLength < 20 || currentVerification !== null}>{currentVerification === 'self' ? '当前答案已自评' : currentVerification === 'ai' ? 'AI 已核验通过' : '我已独立完成 · 自评'}</button><button type="button" onClick={() => onEvaluate(feynmanMode ? 'feynman' : 'standard')} disabled={busy || evidenceLength < 20 || (progress.status === 'completed' ? !canReverify : !editable)}>{busy ? '核验中…' : canReverify ? '基于当前证据请求 AI 核验' : feynmanMode ? '提交费曼验收' : '提交给 AI 核验'}</button><button type="button" onClick={onComplete} disabled={busy || !canSettle}>{progress.status === 'completed' ? canReverify ? '升级为 AI 验证' : '已完成 · 不重复结算' : currentVerification === 'ai' ? '结算任务与奖励 · AI 已通过' : currentVerification === 'self' ? '结算自评完成记录' : '结算任务与奖励'}</button></div>
      {(failedAttempts > 0 || rescueLevel > 0) && progress.status !== 'completed' && <section className="rescue-panel" aria-live="polite"><span className="lesson-kicker">卡点救援 · 已保留 {failedAttempts} 次失败记录</span><h3>需要拆得更细吗？</h3>{rescueLevel === 0 ? <p>{failedAttempts >= 3 ? '连续多次独立尝试未通过。' : '本轮有待补项。'}原答案和评分记录会保留；先看最近一条具体反馈，再选择帮助层级。</p> : null}{latestFailedAttempt && <div className="rescue-evidence"><strong>最近一次反馈 · {latestFailedAttempt.errorType === 'prerequisite' ? '先修缺口' : latestFailedAttempt.errorType === 'operation' ? '操作步骤' : latestFailedAttempt.errorType === 'hint-dependence' ? '提示依赖' : '概念理解'}</strong><p>{latestFailedAttempt.feedback}</p>{latestFailedAttempt.evaluation?.gaps.map((gap,index)=><p key={`${index}-${gap}`}>待补项：{gap}</p>)}</div>}{rescueLevel === 1 ? <p><strong>第 1 层 · 看清要求：</strong>{task.acceptance} 前置任务：{task.prerequisites.length ? task.prerequisites.join('、') : '本任务没有声明前置任务'}。</p> : rescueLevel === 2 ? <p><strong>第 2 层 · 降低难度：</strong>{latestFailedAttempt?.errorType === 'operation' ? '先按步骤运行一个输入，再核对每一步输出。' : latestFailedAttempt?.errorType === 'prerequisite' ? `先回看前置任务 ${task.prerequisites.join('、')}，确认用到的基础操作。` : `先只解释“${task.objectives[0]?.text ?? task.title}”，再用最小输入检查你的说法。`}</p> : rescueLevel === 3 ? <div><p><strong>第 3 层 · 前置短练习：</strong>暂时不做完整交付。针对“{task.objectives[0]?.text ?? task.title}”写一个小例子和预期结果；练习证据保存在补充证据栏，不替换原答案。</p><textarea aria-label="救援前置练习" value={progress.supplementalEvidence ?? ''} onChange={event=>onSupplementalEvidence?.(event.target.value)} placeholder="写下短练习、预测和观察结果。"/></div> : rescueLevel === 4 ? <div><p><strong>第 4 层 · 完整示范：</strong>示范用于学习反馈；查看后当前题不能证明独立掌握，需要新问题或新数据的变式。</p>{content?.challenge.referenceAnswer && (answerVisible || progress.answerRevealed ? <><p>{content.challenge.referenceAnswer}</p><small>你已查看本题参考答案；本次作答只能用于学习反馈，不能作为独立掌握证明。</small></> : <button type="button" onClick={() => { setAnswerVisible(true); onAnswerRevealed?.(); }}>查看示范答案（仅用于学习）</button>)}<button type="button" onClick={onRequestTransfer} disabled={busy || locked}>生成新的独立变式</button></div> : null}<button type="button" onClick={onRescue} disabled={!onRescue || rescueLevel >= 4}>{rescueLevel === 0 ? '开始分层救援' : rescueLevel < 4 ? '继续下一层帮助' : '已到最后一层'}</button></section>}
      {progress.answerRevealed && <p className="lesson-feedback" role="status">当前挑战已暴露参考答案，或你已主动查看；本次评价只提供学习反馈，不能结算为独立掌握。请生成同目标迁移题并提交新证据。</p>}
      {progress.assistedEvaluation && <div className="lesson-feedback" role="status"><strong>学习反馈：{progress.assistedEvaluation.score}/100</strong><p>{progress.assistedEvaluation.feedback}</p><small>本次作答使用了参考答案，不计入独立掌握。</small></div>}
      {progress.selfChecked && <p className="lesson-feedback" role="status">自我检查已记录；这不是 AI 掌握度或百分制评分。</p>}
      {progress.status === 'completed' && <p className="lesson-feedback" role="status">成果已保存 · {progress.verification === 'ai' ? 'AI 已核验' : '由你自行完成'} · 复习已安排</p>}
      {feedback && <p className="lesson-feedback" role="status">{feedback}</p>}
      {attempts.length > 0 && <details className="attempt-history"><summary>查看作答历史（{attempts.length} 次）</summary><ol>{attempts.map((attempt, index) => <li key={`${attempt.at}-${index}`}><strong>版本 {attempt.lessonRevision ?? '未知'} · {attempt.passed ? '通过' : '未通过'} · {attempt.verification === 'ai' ? 'AI 核验' : attempt.verification === 'self' ? '自行完成' : '辅助反馈'}</strong><small>{new Date(attempt.at).toLocaleString('zh-CN')} · 使用提示 {attempt.hintLevelsUsed} 级{attempt.answerRevealed ? ' · 已查看示范答案' : ''}</small><pre>{attempt.answer}</pre><p>{attempt.feedback}</p>{attempt.evaluation?.gaps.map((gap, gapIndex) => <p key={`${gap}-${gapIndex}`}>待补：{gap}</p>)}</li>)}</ol></details>}
    </section>
  </article>;
}
