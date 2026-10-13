import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Aperture, ArrowDown, ArrowRight, ArrowUpRight, Award, BookOpen, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleHelp, Clock3, Crosshair,
  FileText, Fingerprint, Flame, Headphones, KeyRound, Layers2, LockKeyhole, Maximize2,
  Menu, Orbit, Play, Plus, Radio, RotateCcw, Search, Send, Settings2, ShieldCheck,
  Sparkles, SquareArrowOutUpRight, Target, TerminalSquare, Trophy, X, Zap,
} from 'lucide-react';
import type { Campaign, GoalInput, LearningState, Task, TaskProgress } from '../shared/types';
import { completeTask, buildDailySchedule, getStats, getTaskReward, isTaskUnlocked, markSelfChecked, rateReview, setEvaluation, setEvidence, setSupplementalEvidence, switchCampaign, updateObjective, cacheLesson, recordAttempt, recordGridOutcome, activateTask } from './lib/engine';
import { loadStateSafely, saveStateSafely, exportState, importState } from './lib/storage';
import { LessonWorkspace } from './components/LessonWorkspace';
import { TodaySchedule } from './components/TodaySchedule';
import { NUMPY_DEMO_CAMPAIGN } from './lib/numpyDemo';
import { extractGoalPreferences, type ExtractedGoalPreferences } from './lib/goalParser';

type Tab = 'missions' | 'today' | 'workspace' | 'archive' | 'reviews';
type Notification = { title: string; body?: string; tone?: 'success' | 'warning' } | null;
type Connection = { configured: boolean; model: string };

const defaultGoal = NUMPY_DEMO_CAMPAIGN.goal;

function App() {
  const [loaded] = useState(() => loadStateSafely());
  const [state, setState] = useState<LearningState>(() => loaded.isNew ? switchCampaign(loaded.state, NUMPY_DEMO_CAMPAIGN) : loaded.state);
  const [selectedStage, setSelectedStage] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState(loaded.state.lastTaskId ?? state.campaign.stages[0]?.tasks[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>('missions');
  const [goalOpen, setGoalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-flash');
  const [connection, setConnection] = useState<Connection>({ configured: false, model: 'deepseek-flash' });
  const [goal, setGoal] = useState(defaultGoal);
  const [level, setLevel] = useState('零基础');
  const [days, setDays] = useState(28);
  const [dailyMinutes, setDailyMinutes] = useState(45);
  const [reward, setReward] = useState('把第一个真正能用的小工具部署起来');
  const [busy, setBusy] = useState<'generate' | 'evaluate' | 'lesson' | 'schedule' | null>(null);
  const [saveError, setSaveError] = useState(loaded.warning ?? '');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [pendingCampaign, setPendingCampaign] = useState<Campaign | null>(null);
  const [sourceMaterial, setSourceMaterial] = useState('');
  const [languagePreference, setLanguagePreference] = useState<'en'|'zh'|'mixed'>('mixed');
  const [extractedPreferences, setExtractedPreferences] = useState<ExtractedGoalPreferences>({});
  const [scheduleAdjustment, setScheduleAdjustment] = useState<'half' | 'more' | 'skip-known' | 'too-hard'>();
  const [scheduleError, setScheduleError] = useState('');
  const [hintLevels, setHintLevels] = useState<Record<string, number>>({});
  const [lessonError, setLessonError] = useState('');
  const [adaptation, setAdaptation] = useState<{recommendation:string;reason:string;nextTaskId:string;minutes:number}|null>(null);
  const [selectedChainId, setSelectedChainId] = useState('');
  const [gridDrafts, setGridDrafts] = useState<Record<string, string>>({});
  const activeRequest = useRef<AbortController | null>(null);
  const [notification, setNotification] = useState<Notification>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [reviewRating, setReviewRating] = useState(3);
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState<string>();
  const [reviewAnswer, setReviewAnswer] = useState('');
  const [reviewHintUsed, setReviewHintUsed] = useState(false);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [note, setNote] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [diagnosticMode, setDiagnosticMode] = useState(false);

  const campaign = state.campaign;
  const currentState = useRef(state); currentState.current = state;
  const task = useMemo(() => campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === selectedTaskId) ?? campaign.stages[0]?.tasks[0], [campaign, selectedTaskId]);
  const taskProgress: TaskProgress | undefined = task ? state.progress[task.id] : undefined;
  const stats = useMemo(() => getStats(state), [state]);
  const currentStage = campaign.stages[selectedStage] ?? campaign.stages[0];
  const allTasks = campaign.stages.flatMap(stage => stage.tasks);
  const doneMissions = allTasks.filter(item => state.progress[item.id]?.status === 'completed').length;
  const stageCount = campaign.stages.length;
  const activeChainId = currentStage?.chains?.some(chain => chain.id === selectedChainId) ? selectedChainId : currentStage?.chains?.find(chain => chain.track === 'main')?.id;
  const visibleStageTasks = currentStage?.chains?.length && activeChainId ? currentStage.tasks.filter(item => (currentStage.chains?.find(chain => chain.id === activeChainId)?.taskIds ?? []).includes(item.id)) : currentStage?.tasks ?? [];
  const dueReview = state.reviews.filter(card => new Date(card.dueAt).getTime() <= Date.now());
  const nextReview = state.reviews.find(card => new Date(card.dueAt).getTime() <= Date.now());
  const localDate = new Date().toLocaleDateString('sv-SE');
  const dailyPlan = state.schedules?.[localDate] ?? buildDailySchedule(campaign, state.progress, state.reviews, localDate, scheduleAdjustment);
  const readyTasks = allTasks.filter(item => state.progress[item.id]?.status !== 'completed' && isTaskUnlocked(campaign, state.progress, item.id));
  const diagnosedAsKnown = state.dailyAdjustments?.[localDate] === 'skip-known';
  const recommendationTasks = readyTasks.filter(item => !state.knownTasks?.[item.id]);
  const nextMission = recommendationTasks.find(item => (item.track ?? 'main') === 'main') ?? recommendationTasks[0];

  const update = useCallback((next: LearningState) => setState(next), []);
  const flash = useCallback((value: Notification) => setNotification(value), []);

  useEffect(() => {
    if (loaded.warning && !allowOverwrite) return;
    const result = saveStateSafely(state);
    if (!result.ok) setSaveError(`自动保存失败：${result.error}`);
    else if (!loaded.warning) setSaveError('');
  }, [state, allowOverwrite, loaded.warning]);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/status').then(response => response.ok ? response.json() : null).then(data => {
      if (!cancelled && data) setConnection(data as Connection);
    }).catch(() => { if (!cancelled) setConnection({ configured: false, model: 'deepseek-flash' }); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!notification) return;
    const handle = window.setTimeout(() => setNotification(null), 4200);
    return () => window.clearTimeout(handle);
  }, [notification]);
  useEffect(() => {
    if (!startedAt) return;
    const handle = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(handle);
  }, [startedAt]);
  useEffect(() => { setNote(state.notes?.[task?.id ?? ''] ?? ''); }, [task?.id, state.notes]);
  useEffect(() => { const index = campaign.stages.findIndex(stage => stage.tasks.some(item => item.id === selectedTaskId)); if (index >= 0) setSelectedStage(index); }, [campaign.id, selectedTaskId]);
  useEffect(() => {
    if (state.schedules?.[localDate]) return;
    const schedule = buildDailySchedule(campaign, state.progress, state.reviews, localDate, scheduleAdjustment);
    setState(previous => previous.schedules?.[localDate] ? previous : { ...previous, schedules: { ...(previous.schedules ?? {}), [localDate]: schedule } });
  }, [campaign.id, localDate]);

  const beginTask = async (nextTask: Task) => {
    const unlocked = isTaskUnlocked(campaign, state.progress, nextTask.id);
    setSelectedTaskId(nextTask.id);
    setAdaptation(null);
    setState(previous => {
      const entered = state.progress[nextTask.id]?.status === 'completed' || !unlocked ? previous : activateTask(previous, nextTask.id);
      return { ...entered, lastTaskId: nextTask.id };
    });
    if (!startedAt) setStartedAt(Date.now() - seconds * 1000);
    setTab('workspace');
    if (!unlocked && state.progress[nextTask.id]?.status !== 'completed') flash({ title: '后续任务预览', body: '查看不改变进度；完成课程前置任务后才可提交结算。', tone: 'warning' });
    const cached = state.content?.[nextTask.id] ?? nextTask.teaching;
    if (!cached && (connection.configured || apiKey) && !busy) {
      setBusy('lesson'); setLessonError(''); const controller = new AbortController(); activeRequest.current = controller;
      try {
        const response = await fetch('/api/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign, taskId: nextTask.id, language: campaign.language ?? 'mixed', revision: (state.contentHistory?.[nextTask.id]?.length ?? 0) + 1, ...(apiKey ? { apiKey } : {}), model }), signal: controller.signal });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? '课程内容生成失败');
        setState(previous => cacheLesson(previous, nextTask.id, payload.lesson, false));
      } catch (error) { if(!(error instanceof DOMException&&error.name==='AbortError'))setLessonError(error instanceof Error ? error.message : '内容生成失败，可重试或继续看任务概要。'); }
      finally { activeRequest.current=null; setBusy(null); }
    }
  };

  const activateBlueprint = () => {
    if (!pendingCampaign) return;
    const next = switchCampaign(state, pendingCampaign);
    update(next); setSelectedStage(0); setSelectedTaskId(pendingCampaign.stages[0].tasks[0].id); setGoalOpen(false); setSettingsOpen(false); setPendingCampaign(null); setStartedAt(null); setSeconds(0); setTab('missions'); setSelectedChainId('');
    flash({ title: '蓝图已确认 · 新赛季部署', body: `${pendingCampaign.stages.length} 个阶段；旧目标和进度已归档保存。`, tone: 'success' });
  };

  const runGeneration = async () => {
    if (goal.trim().length < 12) { flash({ title: '行动目标还不够具体', body: '写明想达成什么，以及最终要交付什么。', tone: 'warning' }); return; }
    setBusy('generate');
    try {
      const input: GoalInput = { goal: goal.trim(), level, days, dailyMinutes, ultimateReward: reward.trim() || '完成一项真实可用的成果', desiredArtifact: reward.trim() || undefined, language: languagePreference, sourceMaterial: sourceMaterial.slice(0, 20000) || undefined };
      const controller = new AbortController(); activeRequest.current = controller;
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, ...(apiKey ? { apiKey } : {}), model }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload.error || '行动线生成失败'), { code: payload.code });
      const newCampaign = (payload as { campaign: Campaign }).campaign;
      setPendingCampaign(newCampaign);
      flash({ title: '课程蓝图已生成，等待确认', body: `${newCampaign.stages.length} 个阶段，${newCampaign.stages.reduce((n, stage) => n + stage.tasks.length, 0)} 个课程任务。确认后才会替换当前行动线。`, tone: 'success' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { flash({ title: '已取消生成', body: '当前赛季与学习记录没有变化。', tone: 'warning' }); return; }
      const message = error instanceof Error ? error.message : '连接 DeepSeek 时发生未知错误。';
      flash({ title: message, body: '当前赛季和进度已保留，可以先继续预置训练。', tone: 'warning' });
    } finally { activeRequest.current = null; setBusy(null); }
  };

  const openGoal = () => { setPendingCampaign(null); setGoalOpen(true); };
  const handleGoalText = (value: string) => {
    setGoal(value); const extracted = extractGoalPreferences(value); setExtractedPreferences(extracted);
    if (extracted.days) setDays(extracted.days);
    if (extracted.dailyMinutes) setDailyMinutes(extracted.dailyMinutes);
    if (extracted.language) setLanguagePreference(extracted.language);
  };
  const loadNumpyBlueprint = () => { setPendingCampaign(NUMPY_DEMO_CAMPAIGN); setGoalOpen(true); setGoal(NUMPY_DEMO_CAMPAIGN.goal); setLevel(NUMPY_DEMO_CAMPAIGN.level); setDays(NUMPY_DEMO_CAMPAIGN.days); setDailyMinutes(NUMPY_DEMO_CAMPAIGN.dailyMinutes); setReward(NUMPY_DEMO_CAMPAIGN.ultimateReward); };

  const adjustToday = (adjustment: 'half' | 'more' | 'skip-known' | 'too-hard') => {
    setScheduleAdjustment(adjustment); setScheduleError('');
    if (adjustment === 'skip-known') {
      flash({ title: '先做一个简短诊断', body: '写下当前任务的闭卷预测，再对照验收线索判断是否掌握。诊断不会绕过课程前置或自动发放奖励。', tone: 'warning' });
      const focus = readyTasks.find(item => (item.track ?? 'main') === 'main') ?? readyTasks[0];
      if (focus) { setDiagnosticMode(true); void beginTask(focus); }
    } else setDiagnosticMode(false);
    if (adjustment === 'too-hard') {
      const focus = readyTasks.find(item => (item.track ?? 'main') === 'main');
      if (focus) flash({ title: '安排补强与拆分', body: `先从「${focus.title}」的讲解与示例开始；核验未通过时会保留补练建议。`, tone: 'warning' });
    }
    try {
      const schedule = buildDailySchedule(campaign, state.progress, state.reviews, localDate, adjustment);
      setState(previous => ({ ...previous, schedules: { ...(previous.schedules ?? {}), [localDate]: { ...schedule, revision: (previous.schedules?.[localDate]?.revision ?? 0) + 1 } }, dailyAdjustments: { ...(previous.dailyAdjustments ?? {}), [localDate]: adjustment } }));
    } catch (error) { setScheduleError(error instanceof Error ? error.message : '今天的节目表调整失败'); }
  };

  const requestAiSchedule = async () => {
    if (!connection.configured && !apiKey) { setScheduleError('需要 DeepSeek API Key；当前先使用按预算本地编排的节目表。'); return; }
    if (busy) return;
    setBusy('schedule'); setScheduleError(''); const controller = new AbortController(); activeRequest.current = controller;
    try {
      const response = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign, progress: state.progress, reviews: state.reviews.filter(item => Date.parse(item.dueAt) <= Date.now()), minutes: campaign.dailyMinutes, date: localDate, adjustment: scheduleAdjustment, ...(apiKey ? { apiKey } : {}), model }), signal: controller.signal });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'AI 节目表生成失败');
      const schedule = payload.schedule; setState(previous => ({ ...previous, schedules: { ...(previous.schedules ?? {}), [localDate]: schedule } }));
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setScheduleError(error instanceof Error ? error.message : 'AI 编排失败；仍可用本地节目表。'); }
    finally { activeRequest.current = null; setBusy(null); }
  };

  const selfEvaluate = () => {
    if (!task || !taskProgress || taskProgress.evidence.trim().length < 20) {
      flash({ title: '还没到撤离条件', body: '先提交至少 20 个字的过程、答案或作品路径，说明你做了什么、结果如何。', tone: 'warning' }); return;
    }
    update(markSelfChecked(state, task.id));
    setState(previous => recordAttempt(previous, task.id, { answer: taskProgress.evidence, hintLevelsUsed: hintLevels[task.id] ?? 0, verification: 'self', passed: false, errorType: hintLevels[task.id] ? 'hint-dependence' : 'none', feedback: '记录为自行完成；这不是 AI 掌握度评分。' }));
    flash({ title: '自我检查已记录', body: '这只是自行完成记录，不会显示成 100 分掌握；需要时可以再请求 AI 核验。', tone: 'success' });
  };

  const evaluateWithAI = async () => {
    if (!task || !taskProgress || taskProgress.evidence.trim().length < 20) {
      flash({ title: '请先提交可供核验的情报', body: '写下至少 20 个字的答案或作品记录，AI 会依据课程验收标准核对。', tone: 'warning' }); return;
    }
    setBusy('evaluate'); const originalEvidence = taskProgress.evidence; const supplementalEvidence = taskProgress.supplementalEvidence ?? ''; const evidence = supplementalEvidence.trim() ? `${originalEvidence}\n\n补充证据：\n${supplementalEvidence}` : originalEvidence; const controller = new AbortController(); activeRequest.current = controller;
    try {
      const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, evidence, verificationSource: 'ai', ...(apiKey ? { apiKey } : {}), model }), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'AI 校准失败');
      if (payload.verification !== 'ai') throw new Error('服务端未返回可验证的 AI 验收来源');
      const result = payload.evaluation;
      setState(previous => {
        if (previous.progress[task.id]?.evidence !== originalEvidence || (previous.progress[task.id]?.supplementalEvidence ?? '') !== supplementalEvidence) return previous;
        const evaluated = setEvaluation(previous, task.id, result, 'ai');
        return recordAttempt(evaluated, task.id, { answer: evidence, hintLevelsUsed: hintLevels[task.id] ?? 0, verification: 'ai', passed: result.passed, score: result.score, errorType: result.passed ? 'none' : result.gaps.length ? 'concept' : 'operation', feedback: result.feedback });
      });
      if (currentState.current.progress[task.id]?.evidence !== originalEvidence || (currentState.current.progress[task.id]?.supplementalEvidence ?? '') !== supplementalEvidence) { flash({ title: '答案已在核验期间更改', body: '为避免旧结果覆盖新答案，请重新提交当前内容。', tone: 'warning' }); return; }
      flash({ title: result.passed ? 'AI 已确认任务掌握' : '发现几个待补线索', body: result.feedback, tone: result.passed ? 'success' : 'warning' });
      if (!result.passed && (connection.configured || apiKey)) {
        try {
          const response = await fetch('/api/adapt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign, currentTaskId: task.id, evidence, history: currentState.current.attempts?.[task.id] ?? [], remainingMinutes: Math.max(1, campaign.dailyMinutes - dailyPlan.totalMinutes), ...(apiKey ? { apiKey } : {}), model }), signal: controller.signal });
          const payload = await response.json(); if (response.ok && payload.recommendation) setAdaptation(payload.recommendation);
        } catch { /* Keep the evaluation feedback usable if adaptation is temporarily unavailable. */ }
      }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) flash({ title: error instanceof Error ? error.message : 'AI 校准失败', body: '检查 API Key 与网络连接后重试。', tone: 'warning' }); }
    finally { activeRequest.current = null; setBusy(null); }
  };

  const claimTask = () => {
    if (!task || (!taskProgress?.selfChecked && !(taskProgress?.evaluationSource === 'ai' && taskProgress?.evaluation?.passed))) { flash({ title: '还没有可结算的检查记录', body: '先自行核对目标和证据，或提交给 AI 验收。', tone: 'warning' }); return; }
    try {
      const verification = taskProgress.evaluationSource === 'ai' && taskProgress.evaluation?.passed ? 'ai' : 'self';
      const next = completeTask(state, task.id, verification);
      const newlyCompleted = next.progress[task.id]?.status === 'completed' && taskProgress.status !== 'completed';
      const saved = saveStateSafely(next);
      if (!saved.ok) setSaveError(`任务已在本页更新，但自动保存失败：${saved.error}`);
      update(next);
      if (newlyCompleted) {
        const entry = next.rewardLedger?.find(item => item.taskId === task.id && item.kind === 'mission');
        flash({ title: '成果已归档 · 奖励入账', body: `+${entry?.reward.xp ?? task.xp} XP · +${entry?.reward.coins ?? 0} 学习币${entry?.reward.items.length ? ` · ${entry.reward.items.map(item => item.name).join('、')}` : ''}。${verification === 'ai' ? 'AI 核验来源已保存。' : '自行完成与 AI 验证分开记录。'}`, tone: 'success' });
      }
    } catch (error) { flash({ title: '行动未能结算', body: error instanceof Error ? error.message : '请重新检查前置任务与证据。', tone: 'warning' }); }
  };

  const saveNote = (value: string) => {
    if (!task) return;
    setNote(value);
    setState(previous => ({ ...previous, notes: { ...previous.notes, [task.id]: value } }));
  };

  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const restored = importState(await file.text()); update(restored); setAllowOverwrite(true); setSaveError(''); setSelectedStage(0); setSelectedTaskId(restored.lastTaskId ?? restored.campaign.stages[0]?.tasks[0]?.id ?? '');
      flash({ title: '行动记录已安全还原', body: '所有字段已经过结构和依赖关系校验。', tone: 'success' });
    } catch (error) { flash({ title: '备份文件无法读取', body: error instanceof Error ? error.message : '文件结构无效。', tone: 'warning' }); }
    finally { event.target.value = ''; }
  };

  const completeReview = (answer = reviewAnswer, hintUsed = reviewHintUsed) => {
    if (!nextReview) return;
    if (answer.trim().length < 8) { flash({ title: '先写下自己的回忆', body: '至少写几个关键点，再核对和安排下一次复习。', tone: 'warning' }); return; }
    update(rateReview(state, nextReview.taskId, reviewRating, new Date(), { answer, hintUsed }));
    setSelectedReviewTaskId(undefined);
    setReviewRating(3); setReviewAnswer(''); setReviewHintUsed(false); setReviewRevealed(false);
    flash({ title: '记忆维护完成', body: '下一次复习已按你的回忆情况重新排期。', tone: 'success' });
  };

  const switchToCampaign = (id: string) => {
    const candidate = state.history?.find(item => item.campaign.id === id)?.campaign;
    if (!candidate) return;
    const next = switchCampaign(state, candidate); update(next);
    setSelectedTaskId(next.lastTaskId ?? next.campaign.stages[0]?.tasks[0]?.id ?? ''); setTab('missions'); setSelectedChainId(''); setSeconds(0); setStartedAt(null);
    flash({ title: '已切换学习目标', body: `${next.campaign.title} 的阶段、成果与复习存档已恢复。`, tone: 'success' });
  };

  const timeLabel = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const stageProgress = currentStage ? (currentStage.gateTaskIds ?? currentStage.mainlineTaskIds ?? currentStage.tasks.filter(item => (item.track ?? 'main') === 'main').map(item => item.id)).filter(id => state.progress[id]?.status === 'completed').length : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(value => !value)}><Menu size={19} /></button>
        <button className="brand" onClick={() => { setTab('missions'); setMobileNav(false); }} aria-label="九格行动主页">
          <span className="brand-mark"><span /><span /><span /><span /><span /><span /><span /><span /><span /></span>
          <span className="brand-copy"><strong>NINEGRID</strong><small>九格行动</small></span>
        </button>
        <div className="topbar-divider" />
        <div className="topbar-season"><span className="status-light" /> SEASON 01 <span className="muted">/</span> 个人成长计划</div>
        <nav className={`main-nav ${mobileNav ? 'nav-open' : ''}`} aria-label="主导航">
          <button className={`nav-link ${tab === 'today' ? 'active' : ''}`} onClick={() => { setTab('today'); setMobileNav(false); }}><Clock3 size={15}/>今日节目表</button>
          <button className={`nav-link ${tab === 'missions' ? 'active' : ''}`} onClick={() => { setTab('missions'); setMobileNav(false); }}><Crosshair size={15} />课程总览</button>
          <button className={`nav-link ${tab === 'workspace' ? 'active' : ''}`} onClick={() => { setTab('workspace'); setMobileNav(false); }}><BookOpen size={15}/>学习工作区</button>
          <button className={`nav-link ${tab === 'archive' ? 'active' : ''}`} onClick={() => { setTab('archive'); setMobileNav(false); }}><Layers2 size={15} />情报档案</button>
          <button className={`nav-link ${tab === 'reviews' ? 'active' : ''}`} onClick={() => { setTab('reviews'); setMobileNav(false); }}><Radio size={15} />复习信号室 {dueReview.length > 0 && <span className="nav-count">{dueReview.length}</span>}</button>
        </nav>
        <div className="topbar-actions">
          {state.history?.length ? <select aria-label="切换学习目标" className="campaign-switch" value={campaign.id} onChange={event => switchToCampaign(event.target.value)}><option value={campaign.id}>{campaign.title}</option>{state.history.map(item=><option key={item.campaign.id} value={item.campaign.id}>{item.campaign.title}</option>)}</select> : null}
          <div className="connection-pill"><span className={`connection-dot ${connection.configured || apiKey ? 'online' : ''}`} />{connection.configured || apiKey ? 'AI 已就绪' : '本地训练'}<ChevronDown size={13} /></div>
          <button className="icon-button settings-trigger" aria-label="连接设置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
          <span className="avatar" aria-label={`${stats.xp} 点经验`}>NG</span>
        </div>
      </header>

      {saveError && <div className="storage-warning" role="alert"><span>{saveError}</span><button onClick={() => { setAllowOverwrite(true); setSaveError(''); }}>我已备份旧存档，允许使用新存档</button></div>}

      <div className="page-wrap">
        <section className="season-banner">
          <div className="banner-art" aria-hidden="true"><div className="radar-ring ring-one"/><div className="radar-ring ring-two"/><div className="radar-crosshair"><span /><span /></div><div className="radar-sweep"/><div className="radar-chip chip-a">INTEL / 09</div><div className="radar-chip chip-b">SIGNAL STABLE</div><i className="radar-ping ping-a"/><i className="radar-ping ping-b"/></div>
          <div className="banner-content">
            <div className="eyebrow"><span className="eyebrow-dot"/> 当前行动赛季 <span className="season-tag">{campaign.source === 'deepseek' ? 'AI DEPLOYED' : 'FIELD MANUAL'}</span></div>
            <h1>{campaign.title}</h1>
            <p>{campaign.subtitle}</p>
            <div className="banner-meta"><span><Target size={13}/>{campaign.level}</span><span><Clock3 size={13}/>{campaign.days} 天行动周期</span><span><Zap size={13}/>{campaign.dailyMinutes} 分钟 / 日</span></div>
          </div>
          <div className="banner-progress">
            <span className="progress-overline">总行动进度</span><div className="progress-amount">{String(doneMissions).padStart(2, '0')}<span> / {String(allTasks.length).padStart(2, '0')}</span></div>
            <div className="progress-track"><i style={{ width: `${allTasks.length ? Math.round(doneMissions / allTasks.length * 100) : 0}%` }}/></div>
            <span className="progress-caption">任务完成 {allTasks.length ? Math.round(doneMissions / allTasks.length * 100) : 0}% · 能力成果已验证 {stats.slots}/9</span>
            <button className="banner-edit" onClick={openGoal}><Plus size={14}/>部署新行动线 <ArrowUpRight size={13}/></button>
            {nextMission && <button className="banner-edit" onClick={() => void beginTask(nextMission)}><Play size={13}/>继续上次任务 · {nextMission.title}<ArrowRight size={13}/></button>}
          </div>
          <div className="banner-index">NG—01</div>
        </section>

        <div className="section-switcher">
          <div className="section-heading"><span className="section-icon"><Aperture size={16}/></span><span>{tab === 'missions' ? '课程总览' : tab === 'today' ? '今日节目表' : tab === 'workspace' ? '学习工作区' : tab === 'archive' ? '个人档案' : '复习信号室'}<small>FIELD OPERATIONS <i>·</i> {String(allTasks.length).padStart(2, '0')} MISSIONS</small></span></div>
          <div className="section-controls"><button className={`subtab ${tab === 'today' ? 'selected' : ''}`} onClick={() => setTab('today')}>今日</button><button className={`subtab ${tab === 'missions' ? 'selected' : ''}`} onClick={() => setTab('missions')}>课程总览</button><button className={`subtab ${tab === 'workspace' ? 'selected' : ''}`} onClick={() => setTab('workspace')}>学习区</button><button className={`subtab ${tab === 'archive' ? 'selected' : ''}`} onClick={() => setTab('archive')}>档案</button><button className="icon-button search-button" aria-label="搜索任务" onClick={() => flash({ title: '行动筛选', body: '从课程目录中选择想追踪的任务。' })}><Search size={16}/></button></div>
        </div>

        {tab === 'today' ? <TodaySchedule schedule={dailyPlan} tasks={allTasks} progress={state.progress} recommendedTask={nextMission} noRecommendation={diagnosedAsKnown && !nextMission ? '诊断已记录为已掌握；当前仍是阶段前置，完成并结算后才能解锁后续任务。' : undefined} budgetMinutes={campaign.dailyMinutes * (scheduleAdjustment==='half'?0.5:scheduleAdjustment==='more'?1.5:1)} onStart={(t, kind) => { if (kind === 'review') { setSelectedReviewTaskId(t.id); setReviewRevealed(false); setReviewAnswer(''); setTab('reviews'); } else { setDiagnosticMode(false); void beginTask(t); } }} onGenerate={() => void requestAiSchedule()} onAdjust={adjustToday} busy={busy === 'schedule'} error={scheduleError}/>
        : tab === 'workspace' && task ? <><LessonWorkspace task={task} progress={taskProgress ?? { completedObjectives: [], evidence: '', status: 'idle' }} content={state.content?.[task.id] ?? task.teaching} loading={busy === 'lesson'} busy={busy === 'evaluate'||busy==='lesson'} editable={isTaskUnlocked(campaign, state.progress, task.id) || taskProgress?.status === 'completed'} feedback={lessonError || taskProgress?.evaluation?.feedback} onEvidence={value => setState(previous => setEvidence(previous, task.id, value))} onSupplementalEvidence={value => setState(previous => setSupplementalEvidence(previous, task.id, value))} onEvaluate={() => void evaluateWithAI()} onSelfCheck={selfEvaluate} onComplete={claimTask} onCancel={()=>activeRequest.current?.abort()} onHintUsed={level => setHintLevels(previous => ({ ...previous, [task.id]: level }))} diagnosticMode={diagnosticMode} onDiagnosticFinish={confidence => { setDiagnosticMode(false); if (confidence === 'known') { setState(previous => ({ ...previous, knownTasks: { ...(previous.knownTasks ?? {}), [task.id]: true } })); setTab('today'); flash({ title: '诊断已完成', body: '已掌握任务从今日推荐中隐藏；课程解锁条件仍按原规则计算。', tone: 'success' }); } else flash({ title: '进入补练', body: '继续使用讲解、示例和练习完善证据。', tone: 'success' }); }}/><div className="lesson-workspace-secondary"><button className="secondary-button" onClick={() => setTab('missions')}>返回课程总览</button>{lessonError&&<button className="secondary-button" onClick={()=>void beginTask(task)}>重试生成本课讲解</button>}{adaptation&&<div className="adaptation-card"><strong>根据这次结果，建议：{adaptation.recommendation}</strong><p>{adaptation.reason}</p><button className="secondary-button" onClick={()=>{const next=allTasks.find(item=>item.id===adaptation.nextTaskId);if(next)void beginTask(next);}}>打开建议任务 · {adaptation.minutes} 分钟</button></div>}<div className="lesson-resources">{task.resources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<SquareArrowOutUpRight size={13}/></a>)}</div>{taskProgress?.status==='completed'&&nextMission&&nextMission.id!==task.id&&<button className="modal-submit" onClick={()=>void beginTask(nextMission)}>继续下一主线任务 · {nextMission.title}<ArrowRight size={15}/></button>}</div></>
        : tab === 'missions' && task && currentStage ? <div className="operations-layout">
          <aside className="mission-rail">
            <div className="rail-head"><div><span className="micro-label">OPERATIONS</span><h2>行动目录 <span>{String(stageCount).padStart(2, '0')}</span></h2></div><button className="icon-button compact" onClick={openGoal} aria-label="新建行动线"><Plus size={16}/></button></div>
            <div className="campaign-note"><span className="note-marker">◎</span><span><strong>本赛季终局目标</strong><small>{campaign.goal}</small></span></div>
            <div className="stage-list">
              {campaign.stages.map((stage, stageIndex) => {
                const required = stage.gateTaskIds ?? stage.mainlineTaskIds ?? stage.tasks.filter(item => (item.track ?? 'main') === 'main').map(item => item.id);
                const unlocked = stageIndex === 0 || (campaign.stages[stageIndex - 1].gateTaskIds ?? campaign.stages[stageIndex - 1].mainlineTaskIds ?? campaign.stages[stageIndex - 1].tasks.filter(item => (item.track ?? 'main') === 'main').map(item => item.id)).every(id => state.progress[id]?.status === 'completed');
                const completed = required.filter(id => state.progress[id]?.status === 'completed').length;
                return <button key={stage.id} className={`stage-card ${selectedStage === stageIndex ? 'stage-selected' : ''} ${!unlocked ? 'stage-locked' : ''}`} onClick={() => { setSelectedStage(stageIndex); setSelectedChainId(stage.chains?.find(chain => chain.track === 'main')?.id ?? ''); setSelectedTaskId(stage.tasks.find(item => isTaskUnlocked(campaign, state.progress, item.id) && state.progress[item.id]?.status !== 'completed')?.id ?? stage.tasks[0].id); if (!unlocked) flash({ title: '后续阶段预览', body: '仅预览蓝图，不会改变任何任务状态。通关只需要本阶段主线验收。', tone: 'warning' }); }}>
                  <span className="stage-number">{String(stageIndex + 1).padStart(2, '0')}<small>{unlocked ? `${completed}/${required.length}` : <LockKeyhole size={12}/>}</small></span>
                  <span className="stage-information"><span className="stage-type">{stageIndex === 0 ? 'INITIAL DEPLOYMENT' : stageIndex === stageCount - 1 ? 'FINAL EXTRACTION' : 'FIELD OPERATION'}</span><strong>{stage.title}</strong><small>{stage.description}</small><i className="stage-card-track"><b style={{ width: `${required.length ? completed / required.length * 100 : 0}%` }}/></i></span>
                  {!unlocked ? <LockKeyhole className="stage-chevron" size={16}/> : <ChevronDown className="stage-chevron" size={17}/>}
                </button>;
              })}
            </div>
            <div className="sidebar-lower"><div className="service-row"><span className="service-dot"/>本机存档 <small>{saveError ? '需检查' : '已保存'}</small></div><div className="profile-mini"><span className="avatar profile-avatar">NG</span><span><strong>行动员</strong><small>战绩等级 · Lv. {Math.floor(stats.xp / 1000) + 1}</small></span><span className="profile-xp"><Zap size={13}/>{stats.xp.toLocaleString()}</span></div></div>
          </aside>

          <section className="mission-board" aria-label="阶段任务列表">
            <div className="board-header"><div><span className="micro-label">ZONE {String(selectedStage + 1).padStart(2, '0')} <i>·</i> {String(currentStage?.tasks.length ?? 0).padStart(2, '0')} TASKS</span><h2>{currentStage?.title ?? '行动区域'}</h2><small>阶段通关：完成 {currentStage?.gateTaskIds?.length ?? currentStage?.mainlineTaskIds?.length ?? currentStage?.tasks.filter(item => (item.track ?? 'main') === 'main').length} 项主线任务；支线完全自愿</small></div><span className="stage-counter">{String(stageProgress).padStart(2, '0')} <i>/</i> {String(currentStage?.gateTaskIds?.length ?? currentStage?.mainlineTaskIds?.length ?? currentStage?.tasks.filter(item => (item.track ?? 'main') === 'main').length ?? 0).padStart(2, '0')}<small>主线已验收</small></span></div>
            {currentStage?.chains && <div className="chain-tabs" role="tablist" aria-label="选择主线或支线">{currentStage.chains.map(chain => <button type="button" role="tab" aria-selected={activeChainId === chain.id} key={chain.id} className={activeChainId === chain.id ? 'chain-tab chain-tab-active' : 'chain-tab'} onClick={() => setSelectedChainId(chain.id)}>{chain.track === 'main' ? '主线' : '支线'} · {chain.title}<small>{chain.taskIds.filter(id => state.progress[id]?.status === 'completed').length}/{chain.taskIds.length}</small></button>)}</div>}
            <div className="mission-scroll">
              {visibleStageTasks.map((item, index) => {
                const progress = state.progress[item.id];
                const unlocked = isTaskUnlocked(campaign, state.progress, item.id);
                const active = item.id === task.id;
                return <button key={item.id} className={`mission-row ${active ? 'mission-active' : ''} ${!unlocked ? 'mission-locked' : ''} ${progress?.status === 'completed' ? 'mission-completed' : ''}`} onClick={() => beginTask(item)}>
                  <span className="mission-ordinal">{String(index + 1).padStart(2, '0')}</span><span className="mission-data"><span className="mission-kicker"><i className={`task-dot dot-${item.kind}`}/>{item.kind === 'boss' ? '终局任务' : item.kind === 'recall' ? '主动回忆' : item.kind === 'practice' ? '实战突破' : '调查行动'}<span className="mission-xp">★ {item.xp}</span></span><strong>{item.title}</strong><small>{item.minutes} 分钟目标时长</small></span>
                  <span className={`mission-status ${progress?.status === 'completed' ? 'done' : ''}`}>{progress?.status === 'completed' ? <CircleCheck size={16}/> : unlocked ? active ? <span className="now-playing"/> : <ChevronDown size={15}/> : <LockKeyhole size={14}/>}</span>
                  <span className="mission-meter">{progress?.status === 'completed' ? '已完成' : unlocked ? '已部署' : '预览 · 待解锁'}<small>+{getTaskReward(item).xp} XP · +{getTaskReward(item).coins} 学习币{getTaskReward(item).items.length ? ' · 徽记' : ''}</small></span>
                </button>;
              })}
              <button className="plan-add-row" onClick={openGoal}><span><Plus size={14}/></span><span>制定新的行动计划<small>告诉 AI 你下一项想精通什么</small></span><ArrowRight size={15}/></button>
            </div>
            <div className="board-footer"><span><span className="service-dot"/>只保存在此设备</span><button onClick={openGoal}>调整学习目标 <ArrowUpRight size={13}/></button></div>
          </section>

          <section className="mission-detail" aria-label="行动详情">
            <div className="detail-topline"><span className="detail-tag"><span className={`task-dot dot-${task.kind}`}/>{task.kind === 'boss' ? 'FINAL EXTRACTION' : task.kind === 'recall' ? 'ACTIVE RECALL' : task.kind === 'practice' ? 'FIELD PRACTICE' : 'INTELLIGENCE GATHERING'}</span><button className="icon-button compact" onClick={() => flash({ title: '行动手册', body: '先阅读线索，再动手，再关掉资料验证能否讲明白。' })} aria-label="帮助"><CircleHelp size={17}/></button></div>
            <h2 className="detail-title">{task.title}</h2>
            <p className="detail-brief">{task.brief}</p>
            <div className="intel-callout"><span className="callout-icon"><Fingerprint size={17}/></span><span><small>下一条值得追踪的线索</small>{task.curiosity}</span><Sparkles size={14} className="callout-sparkle"/></div>

            <div className="detail-grid"><div className="detail-mini"><Clock3 size={14}/><span><small>建议时长</small><strong>{task.minutes} 分钟</strong></span></div><div className="detail-mini"><Trophy size={14}/><span><small>任务独立奖励</small><strong>+{getTaskReward(task).xp} XP · +{getTaskReward(task).coins} 学习币{getTaskReward(task).items.length ? ' · 稀有徽记' : ''}</strong></span></div><div className="detail-mini"><Target size={14}/><span><small>行动类型</small><strong>{task.kind === 'boss' ? '综合验收' : task.kind === 'recall' ? '合书回忆' : task.kind === 'practice' ? '动手实战' : '线索调查'}</strong></span></div></div>
            <div className="detail-section acceptance-callout"><div className="detail-section-title"><span className="section-index">✓</span><strong>清楚的交付与通过标准</strong></div><p>{task.acceptance}</p></div>

            <div className="detail-section"><div className="detail-section-title"><span className="section-index">01</span><strong>本局行动目标</strong><small>{taskProgress?.completedObjectives.length ?? 0}/{task.objectives.length} 已确认</small></div><div className="objective-list">{task.objectives.map(objective => <label key={objective.id} className={`objective-item ${(taskProgress?.completedObjectives ?? []).includes(objective.id) ? 'objective-checked' : ''}`}><input type="checkbox" checked={(taskProgress?.completedObjectives ?? []).includes(objective.id)} disabled={taskProgress?.status === 'completed' || !isTaskUnlocked(campaign, state.progress, task.id)} onChange={() => update(updateObjective(state, task.id, objective.id))}/><span className="custom-check"><Check size={12}/></span><span>{objective.text}</span></label>)}</div></div>

            <div className="detail-section steps-section"><div className="detail-section-title"><span className="section-index">02</span><strong>行动路线</strong><span className="route-difficulty">按顺序推进</span></div><div className="action-steps">{task.steps.map((step, index) => <div className="action-step" key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span>{step}</div>)}</div></div>

            {task.resources.length > 0 && <div className="sources-row"><BookOpen size={14}/><span>原始资料线索</span>{task.resources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<SquareArrowOutUpRight size={11}/></a>)}</div>}

            <div className="evidence-box"><div className="evidence-head"><span><FileText size={15}/>行动记录与撤离证据</span><span>{taskProgress?.evidence?.trim().length ?? 0} 字</span></div><textarea aria-label="行动记录与撤离证据" value={taskProgress?.evidence ?? ''} disabled={taskProgress?.status === 'completed'} onChange={event => update(setEvidence(state, task.id, event.target.value))} placeholder={task.kind === 'recall' ? '先不看笔记，把答案用自己的话写下来。也可以贴上你亲手写的代码或作品路径。' : '记录你做了什么、观察到什么、还卡在哪里。也可以贴作品路径或关键代码…'} /><div className="evidence-footer"><span>提交至少 20 字的答案、过程或作品说明</span><span>{taskProgress?.status === 'completed' ? '撤离成功' : '记录仅保存在此设备'}</span></div></div>

            {taskProgress?.evaluation && <div className={`evaluation-card ${taskProgress.evaluation.passed ? 'evaluation-pass' : 'evaluation-retry'}`}><div className="evaluation-header"><span>{taskProgress.verification === 'ai' ? <Sparkles size={15}/> : <ShieldCheck size={15}/>} {taskProgress.verification === 'ai' ? `AI 校准 · ${taskProgress.evaluation.score} 分` : '行动员自评'}{taskProgress.status === 'completed' && <span className="verdict-chip">已撤离</span>}</span><span className="evaluation-score">{taskProgress.evaluation.passed ? <CircleCheck size={15}/> : <RotateCcw size={14}/>}</span></div><p>{taskProgress.evaluation.feedback}</p>{taskProgress.evaluation.gaps.length > 0 && <ul>{taskProgress.evaluation.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}<small>下一步：{taskProgress.evaluation.nextStep}</small></div>}

            {taskProgress?.status !== 'completed' && <div className="assessment-actions"><button className="review-button" onClick={selfEvaluate} disabled={busy !== null || !taskProgress?.evidence.trim()}><ShieldCheck size={14}/>仅记录自评，不给掌握分</button><button className="ai-assessment-button" onClick={evaluateWithAI} disabled={busy !== null || !taskProgress?.evidence.trim()}>{busy === 'evaluate' ? <><span className="spinner"/> 正在核验…</> : <><Sparkles size={14}/>请 AI 核验</>}</button><button className={'extract-button ' + (taskProgress?.selfChecked || taskProgress?.evaluationSource === 'ai' && taskProgress?.evaluation?.passed ? 'extract-ready' : '')} onClick={claimTask} disabled={busy !== null}><span><ArrowUpRight size={17}/></span>结算任务 · +{getTaskReward(task).xp} XP</button></div>}
            {taskProgress?.status === 'completed' && <div className="completed-banner"><CircleCheck size={16}/><span>成果已归档 <small>{taskProgress.verification === 'ai' ? 'DeepSeek 核验' : '自行完成（未视为 AI 掌握）'}</small></span><span>+{getTaskReward(task).xp} XP</span></div>}
            <div className="detail-bottom"><span><span className="service-dot"/>{saveError ? '本机自动保存失败' : '本机自动保存'}</span><span><ShieldCheck size={13}/>浏览器本地存储；未启用加密</span></div>
          </section>

          <aside className="rewards-panel"><div className="vault-header"><div><span className="micro-label">PERSONAL ARMORY</span><h3>九格能力成果</h3></div><span className="vault-level"><span className="vault-level-dot"/>{stats.slots} / 9 验证</span></div><div className="vault-summary"><span>赛季交付物</span><strong>{campaign.ultimateReward}</strong><div className="vault-summary-track"><i style={{ width: `${stats.slots / 9 * 100}%` }}/></div><small>按能力验收逐格解锁，不按完成任务比例点亮</small></div>
            <div className="vault-grid" aria-label={`九格能力成果，${stats.slots} 格已解锁`}>{(campaign.nineGrid ?? Array.from({length:9},(_,index)=>({id:`empty-${index}`,title:`能力格 ${index+1}`,ability:'课程蓝图尚未配置具体解锁条件',value:'课程蓝图尚未配置',unlockTaskIds:[]}))).map((grid,index)=>{ const verified = Boolean(state.gridOutcomes?.[grid.id]); const eligible = grid.unlockTaskIds.length > 0 && grid.unlockTaskIds.every(id => state.progress[id]?.status === 'completed' && state.progress[id]?.verification === 'ai'); return <div key={grid.id} className={`vault-cell ${verified ? 'vault-open' : ''}`} title={`第 ${index+1} 格：${grid.value}；需通过 AI 核验 ${grid.unlockTaskIds.map(id=>allTasks.find(item=>item.id===id)?.title??id).join('、')}`}><span className="vault-cell-index">0{index+1}</span><span className="vault-cell-icon">{verified ? <Check size={14}/> : <LockKeyhole size={13}/>}</span><span className="vault-cell-title">{grid.title}</span>{eligible && <div className="grid-outcome-input"><textarea aria-label={`${grid.title}成果`} value={gridDrafts[grid.id]??''} onChange={event=>setGridDrafts(previous=>({...previous,[grid.id]:event.target.value}))} placeholder="提交作品或能力证明"/><button onClick={()=>{try{const next=recordGridOutcome(state,grid.id,gridDrafts[grid.id]??'');update(next);setGridDrafts(previous=>({...previous,[grid.id]:''}));flash({title:`九格解锁：${grid.title}`,body:'能力成果已与任务链和验证记录关联保存。',tone:'success'});}catch(error){flash({title:'成果未解锁',body:error instanceof Error?error.message:'请先提交验证记录。',tone:'warning'});}}}>保存成果</button></div>}</div>;})}</div>
            <div className="wallet-card"><strong>学习币 · {state.wallet?.balance ?? 0}</strong><span>虚拟学习奖励，不是游戏资产或账号余额</span><p>{Object.values(state.inventory??{}).map(entry=>`${entry.item.icon} ${entry.item.name} ×${entry.quantity}`).join(' · ')||'仓库尚无道具'} </p>{state.rewardLedger?.slice(-3).reverse().map(entry=><small key={entry.id}>{allTasks.find(item=>item.id===entry.taskId)?.title??'能力节点'} → +{entry.reward.coins} 币 · {entry.reward.items.map(item=>item.name).join('、')||'经验与学习币'}</small>)}</div>
            <div className="vault-foot"><span>行动奖励将为真实掌握解锁</span><span>{stats.slots}<i>/</i>9</span></div>

            <div className="review-panel"><div className="review-panel-title"><span><Radio size={15}/>复习雷达</span><span className="review-badge">{dueReview.length} 待处理</span></div>{nextReview ? <><div className="review-card"><span className="review-wave"><i/><i/><i/><i/><i/><i/><i/></span><small>下一条记忆信号</small><strong>{allTasks.find(item => item.id === nextReview.taskId)?.title ?? '知识点回顾'}</strong><span>{new Date(nextReview.dueAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · 主动回忆</span></div><button className="review-cta" onClick={() => setTab('reviews')}>进入信号室 <ArrowRight size={14}/></button></> : <div className="review-empty"><CircleCheck size={17}/><span>雷达目前安静<small>完成新行动后自动安排间隔复习。</small></span></div>}</div>

            <div className="streak-panel"><Flame size={16}/><span>今天的行动记录</span><strong>{startedAt ? '进行中' : stats.completed > 0 ? '档案已保存' : '等待部署'}<small>{startedAt ? timeLabel + ' · 该休息时就休息' : '节奏由你掌握，不靠熬时长'}</small></strong></div>
            <button className="backup-link" onClick={() => { const blob = new Blob([exportState(state)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'ninegrid-learning-backup.json'; link.click(); URL.revokeObjectURL(url); flash({ title: '档案已导出', body: '备份文件不含 API Key。', tone: 'success' }); }}><ArrowDown size={13}/>导出赛季情报档案</button>
          </aside>
        </div> : tab === 'archive' ? <ArchiveScreen state={state} allTasks={allTasks} onRestore={importBackup}/> : tab === 'reviews' ? <ReviewScreen state={state} selectedTaskId={selectedReviewTaskId} onRating={setReviewRating} rating={reviewRating} answer={reviewAnswer} onAnswer={setReviewAnswer} revealed={reviewRevealed} onReveal={()=>setReviewRevealed(true)} onHintUsed={()=>setReviewHintUsed(true)} hintUsed={reviewHintUsed} onComplete={completeReview}/> : task ? <LessonWorkspace task={task} progress={taskProgress ?? { completedObjectives: [], evidence: '', status: 'idle' }} content={state.content?.[task.id] ?? task.teaching} onEvidence={value => setState(previous => setEvidence(previous, task.id, value))} onEvaluate={() => void evaluateWithAI()} onSelfCheck={selfEvaluate} onComplete={claimTask}/> : null}

        <footer className="global-footer"><span>九格行动 <i>·</i> 每一格，都由真正掌握解锁。</span><span>SESSION <i>—</i> {timeLabel}</span><span>休息也是行动计划的一部分。</span></footer>
      </div>

      {goalOpen && <GoalModal goal={goal} level={level} days={days} minutes={dailyMinutes} reward={reward} connection={connection} model={model} busy={busy === 'generate'} apiKey={apiKey} sourceMaterial={sourceMaterial} language={languagePreference} inferred={extractedPreferences} preview={pendingCampaign} onGoal={handleGoalText} onLevel={setLevel} onDays={setDays} onMinutes={setDailyMinutes} onReward={setReward} onSourceMaterial={setSourceMaterial} onLanguage={setLanguagePreference} onModel={setModel} onApiKey={setApiKey} onLoadNumpy={loadNumpyBlueprint} onAccept={activateBlueprint} onCancelGeneration={() => activeRequest.current?.abort()} onFile={async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>2000000)throw new Error('文本材料不能超过 2 MB');const text=await file.text();setSourceMaterial(text.slice(0,20000));flash({title:'材料已读取',body:`已从 ${file.name} 读取 ${text.length} 个字符；内容会作为课程资料依据。`,tone:'success'});}catch(error){flash({title:'材料读取失败',body:error instanceof Error?error.message:'请粘贴纯文本材料。',tone:'warning'});}finally{event.target.value='';}}} onClose={() => { if(busy==='generate')activeRequest.current?.abort(); setGoalOpen(false); setApiKey(''); }} onGenerate={runGeneration}/>}
      {settingsOpen && <SettingsModal apiKey={apiKey} model={model} connection={connection} onApiKey={setApiKey} onModel={setModel} onClose={() => { setSettingsOpen(false); setApiKey(''); }} onApply={() => { setSettingsOpen(false); flash({ title: '连接设置已应用', body: '密钥仅保留在当前页面内存，刷新后需要重新输入。', tone: 'success' }); }}/ >}
      {notification && <div className={`toast ${notification.tone ?? ''}`} role="status"><span className="toast-icon">{notification.tone === 'success' ? <CircleCheck size={16}/> : <Activity size={16}/>}</span><span><strong>{notification.title}</strong>{notification.body && <small>{notification.body}</small>}</span><button className="icon-button compact" onClick={() => setNotification(null)} aria-label="关闭通知"><X size={14}/></button></div>}
    </main>
  );
}

function GoalModal({ goal, level, days, minutes, reward, connection, model, busy, apiKey, sourceMaterial, language, inferred, preview, onGoal, onLevel, onDays, onMinutes, onReward, onSourceMaterial, onLanguage, onModel, onApiKey, onLoadNumpy, onAccept, onCancelGeneration, onFile, onClose, onGenerate }: { goal: string; level: string; days: number; minutes: number; reward: string; connection: Connection; model: string; busy: boolean; apiKey: string; sourceMaterial: string; language: 'en'|'zh'|'mixed'; inferred: ExtractedGoalPreferences; preview: Campaign|null; onGoal:(s:string)=>void; onLevel:(s:string)=>void; onDays:(n:number)=>void; onMinutes:(n:number)=>void; onReward:(s:string)=>void; onSourceMaterial:(s:string)=>void; onLanguage:(s:'en'|'zh'|'mixed')=>void; onModel:(s:string)=>void; onApiKey:(s:string)=>void; onLoadNumpy:()=>void; onAccept:()=>void; onCancelGeneration:()=>void; onFile:(e:React.ChangeEvent<HTMLInputElement>)=>void; onClose:()=>void; onGenerate:()=>void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="goal-modal" role="dialog" aria-modal="true" aria-labelledby="goal-modal-title">
    <div className="modal-topline"><span><Sparkles size={15}/> OPERATION DESIGN TERMINAL</span><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></div>
    <div className="modal-heading"><span className="modal-icon"><Target size={19}/></span><div><h2 id="goal-modal-title">{preview ? '课程蓝图 · 部署前预览' : '输入你想学习的内容。'}</h2><p>自然语言、教学大纲或考试范围均可；AI 会先给出课程蓝图，确认后才开始保存为新目标。</p></div></div>
    {!preview && <><label className="form-field goal-field"><span><b>01</b>你想学习什么？</span><textarea value={goal} onChange={event => onGoal(event.target.value)} minLength={12} maxLength={8000} placeholder="例如：我刚学 NumPy 的 ndarray、shape、dtype，希望四周后能独立完成基础数据处理，为机器学习做准备。每天一小时，英文为主、中文辅助。我看讲解能懂，但自己经常不会写代码。" /><small className="field-hint">系统会从描述中提取起点、预算、周期与偏好；生成后请核对蓝图再确认。</small>{(inferred.days||inferred.dailyMinutes||inferred.language)&&<small className="extracted-preferences">识别到：{inferred.days?`${inferred.days} 天`:'周期未提取'} · {inferred.dailyMinutes?`${inferred.dailyMinutes} 分钟/日`:'每日预算使用可编辑默认值'} · {inferred.language==='en'?'英文':inferred.language==='zh'?'中文':'英文为主、中文辅助'}；下方字段已更新，可直接修改。</small>}</label>
    <label className="form-field material-field"><span><b>02</b>课程大纲 / 知识点 / 考试范围 <small>可选，可粘贴或读取本地纯文本文件</small></span><textarea value={sourceMaterial} onChange={event=>onSourceMaterial(event.target.value)} maxLength={20000} placeholder="粘贴教材目录、课程大纲或你整理的知识点。链接请粘贴实际摘录；应用不会假装已读取网页。"/><input aria-label="读取本地文本材料" type="file" accept=".txt,.md,.csv,text/plain,text/markdown" onChange={onFile}/><small className="field-hint">仅把粘贴内容或成功读取的文本文件作为依据。链接内容需先自行粘贴。</small></label>
    <div className="form-columns"><label className="form-field"><span><b>02</b>当前基础</span><select value={level} onChange={event => onLevel(event.target.value)}><option>零基础</option><option>了解一些，需要补基础</option><option>已有基础，想进阶</option><option>有经验，冲刺专精</option></select></label><label className="form-field"><span><b>03</b>赛季长度 <small>天</small></span><input type="number" min={1} max={365} value={days} onChange={event => onDays(Math.max(1, Math.min(365, Number(event.target.value))))}/></label></div>
    <div className="form-columns"><label className="form-field"><span><b>04</b>每天预算 <small>分钟</small></span><input type="number" min={1} max={1440} step={5} value={minutes} onChange={event => onMinutes(Math.max(1, Math.min(1440, Number(event.target.value))))}/></label><label className="form-field"><span><b>05</b>最终交付成果 <small>可修改</small></span><input value={reward} maxLength={2000} onChange={event => onReward(event.target.value)} placeholder="描述你想独立完成的成果"/></label></div>
    <label className="form-field"><span><b>06</b>语言偏好</span><select value={language} onChange={event=>onLanguage(event.target.value as 'en'|'zh'|'mixed')}><option value="mixed">英文为主，中文辅助</option><option value="en">简单英文为主</option><option value="zh">中文为主</option></select></label></>}
    {preview && <div className="blueprint-preview"><div className="blueprint-summary"><span className="micro-label">{preview.source==='deepseek'?'AI BLUEPRINT · REAL API RESPONSE':'LOCAL NUMPY WALKTHROUGH · NO AI CLAIM'}</span><h3>{preview.title}</h3><p>{preview.goal}</p><p><strong>起点：</strong>{preview.level}</p><p><strong>最终作品：</strong>{preview.desiredArtifact??preview.ultimateReward}</p><p><strong>前置知识：</strong>{preview.prerequisites?.join('；')??'将按已知起点逐步补足，不默认高级基础。'}</p></div>{preview.stages.map((stage,index)=><section className="blueprint-stage" key={stage.id}><header><span>阶段 {String(index+1).padStart(2,'0')}</span><strong>{stage.title}</strong><small>{stage.tasks.reduce((sum,item)=>sum+item.minutes,0)} 分钟 · 主线 {stage.mainlineTaskIds?.length??stage.tasks.filter(item=>(item.track??'main')==='main').length} 项</small></header><p>{stage.description}</p><div className="blueprint-chain-list">{stage.chains?.map(chain=><div key={chain.id}><b>{chain.track==='main'?'主线':'支线'} · {chain.title}</b><span>{chain.taskIds.map(id=>stage.tasks.find(task=>task.id===id)?.title??id).join(' → ')}</span></div>)??stage.tasks.map(task=><div key={task.id}><b>{task.track==='branch'?'支线':'主线'} · {task.title}</b><span>{task.acceptance}</span></div>)}</div></section>)}<div className="blueprint-controls"><label>目标周期（天）<input type="number" min={1} max={365} value={days} onChange={event=>onDays(Math.max(1,Math.min(365,Number(event.target.value))))}/></label><label>每日预算（分钟）<input type="number" min={1} max={1440} value={minutes} onChange={event=>onMinutes(Math.max(1,Math.min(1440,Number(event.target.value))))}/></label><label>难度 / 当前基础<input value={level} onChange={event=>onLevel(event.target.value)}/></label><button onClick={onGenerate} disabled={busy}>按调整后的预算重新生成</button></div><div className="blueprint-grid">{preview.nineGrid?.map(grid=><div key={grid.id}><strong>{grid.title}</strong><span>{grid.ability}</span><small>解锁：{grid.unlockTaskIds.map(id=>preview.stages.flatMap(stage=>stage.tasks).find(task=>task.id===id)?.title??id).join('、')}</small></div>)}</div><p className="source-provenance">生成状态：{preview.source==='deepseek'?'已收到并通过 Schema 校验的 AI 蓝图。':'离线预置 NumPy 示例，没有调用或模拟 DeepSeek。'}</p></div>}
    <details className="model-connection"><summary><span><KeyRound size={14}/> DeepSeek 连接 <i>{connection.configured ? '· 本机服务已连接' : '· 也可在服务器 .env 配置'}</i></span><ChevronDown size={14}/></summary><div className="connection-fields"><label className="form-field"><span>模型</span><select value={model} onChange={event => onModel(event.target.value)}><option value="deepseek-flash">DeepSeek Flash · 高效部署</option><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><label className="form-field"><span>本次密钥 <small>离开页面即清除</small></span><input type="password" autoComplete="off" value={apiKey} onChange={event => onApiKey(event.target.value)} placeholder={connection.configured ? '已在本机 .env 配置，留空即可' : 'sk-… · 只发往官方 DeepSeek API'} /></label><p className="key-privacy"><ShieldCheck size={13}/> 密钥只在此页面内存中，并经本地服务端发送到 api.deepseek.com。不含在备份里。</p></div></details>
    <div className="method-callout"><Orbit size={16}/><span><strong>这条行动线会如何学习</strong><small>持续调查概念关系 → 关掉资料主动回忆 → 产出作品 → 按记忆情况安排复习。阶段梯度帮助开始和坚持，不以连续时长发奖。</small></span></div>
    <div className="modal-actions"><span>旧赛季保留于本机历史；示例无需 API，生成真实蓝图需要 Key。</span>{busy ? <button className="text-button" onClick={onCancelGeneration}>取消生成</button> : <><button className="text-button" onClick={onLoadNumpy}>预览离线 NumPy 示例</button>{preview ? <button className="modal-submit" onClick={onAccept}><Check size={15}/>确认蓝图并开始</button> : <button className="modal-submit" onClick={onGenerate} disabled={goal.trim().length < 12}><Crosshair size={16}/>生成课程蓝图<ArrowRight size={15}/></button>}</>}</div>
  </section></div>;
}

function SettingsModal({ apiKey, model, connection, onApiKey, onModel, onClose, onApply }: { apiKey: string; model: string; connection: Connection; onApiKey:(s:string)=>void; onModel:(s:string)=>void; onClose:()=>void; onApply:()=>void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="modal-topline"><span><KeyRound size={15}/> CONNECTION SETTINGS</span><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></div><h2 id="settings-title">连接学习引擎</h2><p>使用官方 DeepSeek API 为本次行动生成任务和核对成果。也可在本机 <code>.env</code> 文件设置服务密钥。</p><div className="connection-state"><span className={`connection-dot ${connection.configured || apiKey ? 'online' : ''}`}/>{connection.configured ? `服务器已配置 · ${connection.model}` : apiKey ? '仅此会话有效 · 离开页面后清除' : '尚未连接 · 可先体验预置赛季'}</div><label className="form-field"><span>DeepSeek API Key</span><input type="password" value={apiKey} autoComplete="off" onChange={event => onApiKey(event.target.value)} placeholder={connection.configured ? '留空即使用本机已配置密钥' : '粘贴本次使用的密钥'}/></label><label className="form-field"><span>模型</span><select value={model} onChange={event => onModel(event.target.value)}><option value="deepseek-flash">DeepSeek Flash · 高效部署</option><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><p className="key-privacy"><ShieldCheck size={13}/> 密钥不存入 localStorage、备份文件或 Git。</p><div className="modal-actions"><button className="text-button" onClick={onClose}>返回任务大厅</button><button className="modal-submit" onClick={onApply}><Check size={15}/>应用设置</button></div></section></div>;
}

function ArchiveScreen({ state, allTasks, onRestore }: { state: LearningState; allTasks: Task[]; onRestore:(e:React.ChangeEvent<HTMLInputElement>)=>void }) {
  const campaign = state.campaign;
  const archived = allTasks.filter(task => state.progress[task.id]?.status === 'completed');
  return <section className="utility-screen"><div className="utility-hero"><span className="micro-label">FIELD INTELLIGENCE · DEBRIEF ARCHIVE</span><h2>每条线索，都值得留下。</h2><p>让追踪知识的过程慢慢长成关系网。笔记保存在当前浏览器，可以随时导出带走。</p><div className="archive-summary"><span><strong>{archived.length}</strong><small>已撤离任务</small></span><span><strong>{Object.values(state.notes).filter(Boolean).length}</strong><small>知识线索记录</small></span><span><strong>{state.reviews.length}</strong><small>已建立记忆卡</small></span><button className="secondary-button" onClick={() => { const blob=new Blob([exportState(state)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='ninegrid-learning-backup.json'; link.click(); URL.revokeObjectURL(link.href); }}><ArrowDown size={15}/> 导出情报档案</button><label className="secondary-button upload-button"><RotateCcw size={14}/>安全还原档案<input aria-label="安全还原情报档案" type="file" accept="application/json,.json" onChange={onRestore}/></label></div></div><div className="archive-main"><div className="archive-title"><span><Layers2 size={16}/> 赛季时间线</span><span>{campaign.title} · {campaign.stages.length} 个阶段</span></div><div className="timeline">{campaign.stages.map((stage,index)=><div className="timeline-stage" key={stage.id}><div className="timeline-marker">{String(index+1).padStart(2,'0')}</div><div className="timeline-content"><span className="micro-label">OPERATION {String(index+1).padStart(2,'0')} · {stage.tasks.filter(task=>state.progress[task.id]?.status==='completed').length}/{stage.tasks.length} COMPLETED</span><h3>{stage.title}</h3><p>{stage.description}</p>{stage.tasks.map(task=><div key={task.id} className={`archive-task ${state.progress[task.id]?.status==='completed'?'archive-task-done':''}`}><span className="task-dot dot-investigate"/><span><strong>{task.title}</strong><small>{state.progress[task.id]?.status==='completed'?'✓ 已撤离 · '+(state.progress[task.id].verification==='ai'?'DeepSeek 核验':'自行核对'):'尚未完成'}</small>{state.progress[task.id]?.evidence&&<blockquote>{state.progress[task.id].evidence}</blockquote>}{state.notes[task.id]&&<blockquote>{state.notes[task.id]}</blockquote>}</span><span>{task.xp} XP</span></div>)}</div></div>)}</div></div><div className="archive-tip"><Fingerprint size={16}/><span><strong>白月光线索网</strong><small>追踪“它是谁、从哪里来、与谁相关、下一条线索是什么”。每条行动完成后，写下一个属于自己的关联或意外发现。</small></span></div></section>;
}

function ReviewScreen({ state, selectedTaskId, rating, onRating, answer, onAnswer, revealed, onReveal, hintUsed, onHintUsed, onComplete }: { state: LearningState; selectedTaskId?: string; rating:number; onRating:(n:number)=>void; answer:string; onAnswer:(value:string)=>void; revealed:boolean; onReveal:()=>void; hintUsed:boolean; onHintUsed:()=>void; onComplete:(answer:string,hintUsed:boolean)=>void }) {
  const cards = state.reviews.slice().sort((a,b)=>new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime());
  const card = cards.find(item=>item.taskId===selectedTaskId && new Date(item.dueAt).getTime()<=Date.now()) ?? cards.find(item=>new Date(item.dueAt).getTime()<=Date.now());
  const task = card && state.campaign.stages.flatMap(stage=>stage.tasks).find(item=>item.id===card.taskId);
  return <section className="utility-screen review-screen"><div className="utility-hero"><span className="micro-label">MEMORY MAINTENANCE · ACTIVE RETRIEVAL</span><h2>先回答，再核对，再排期。</h2><p>先闭卷写答案，确认后再展开线索；复习记录会保存你的回答、提示使用和自评。</p></div><div className="review-workspace">{task&&card?<><div className="review-focus-card"><span className="detail-tag"><Radio size={13}/> 今日记忆信号 · 第 {card.repetitions+1} 次回访</span><h3>{task.recallQuestion}</h3><p>{task.curiosity}</p><label className="review-answer-label">闭卷回忆答案<textarea aria-label="闭卷回忆答案" value={answer} onChange={event=>onAnswer(event.target.value)} placeholder="不用写得完美；先写你真正记得的概念、步骤或判断……"/></label>{!revealed?<button className="review-cta review-submit" onClick={onReveal} disabled={answer.trim().length<8}><Check size={15}/>锁定答案并核对</button>:<div className="review-reveal"><strong>核对线索</strong><p>通过标准：{task.acceptance}</p><p>上次提交的成果：{state.progress[task.id]?.evidence||'暂无旧成果'}</p><details className="recall-hint" onToggle={event=>{if((event.currentTarget as HTMLDetailsElement).open)onHintUsed();}}><summary>查看温和提示{hintUsed?' · 已使用':''}</summary><p>{task.hint}</p></details></div>}<div className="rating-heading">对照后，这次回忆质量如何？<small>这是复习间隔的输入，不是掌握度分数。</small></div><div className="rating-options">{[{value:1,label:'完全没想起',symbol:'1'},{value:2,label:'有点模糊',symbol:'2'},{value:3,label:'想起主要思路',symbol:'3'},{value:4,label:'完整讲清楚',symbol:'4'}].map(option=><button key={option.value} className={`rating-option ${rating===option.value?'rating-selected':''}`} onClick={()=>onRating(option.value)}><span>{option.symbol}</span>{option.label}</button>)}</div><button className="review-cta review-submit" onClick={()=>onComplete(answer,hintUsed)} disabled={!revealed||answer.trim().length<8}><Check size={15}/>保存回答并安排下次复习</button></div><aside className="review-queue"><span className="micro-label">MEMORY SIGNAL QUEUE</span><h3>{cards.length} 条复习信号</h3>{cards.map((item,index)=><div className={`queue-item ${item.taskId===card.taskId?'queue-current':''}`} key={item.taskId}><span>{String(index+1).padStart(2,'0')}</span><span><strong>{state.campaign.stages.flatMap(stage=>stage.tasks).find(value=>value.id===item.taskId)?.title}</strong><small>预计 {new Date(item.dueAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})} 回访 · {item.history.length} 次记录</small></span></div>)}</aside></>:<div className="review-clear"><span className="review-clear-icon"><ShieldCheck size={24}/></span><h3>此刻没有待复习的信号。</h3><p>完成任意行动后会安排间隔回访；空档期可以休息，不必为了维持连续记录而硬学。</p><div className="rest-banner"><Headphones size={16}/>留白是复习节奏的一部分。回来时，档案还在。</div></div>}</div></section>;
}

export default App;
