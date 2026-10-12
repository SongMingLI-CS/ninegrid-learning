import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Aperture, ArrowDown, ArrowRight, ArrowUpRight, Award, BookOpen, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleHelp, Clock3, Crosshair,
  FileText, Fingerprint, Flame, Headphones, KeyRound, Layers2, LockKeyhole, Maximize2,
  Menu, Orbit, Play, Plus, Radio, RotateCcw, Search, Send, Settings2, ShieldCheck,
  Sparkles, SquareArrowOutUpRight, Target, TerminalSquare, Trophy, X, Zap,
} from 'lucide-react';
import type { Campaign, GoalInput, LearningState, Task, TaskProgress } from '../shared/types';
import { completeTask, getStats, isTaskUnlocked, rateReview, setEvaluation, setEvidence, updateObjective } from './lib/engine';
import { loadState, saveState, exportState, importState } from './lib/storage';

type Tab = 'missions' | 'archive' | 'reviews';
type Notification = { title: string; body?: string; tone?: 'success' | 'warning' } | null;
type Connection = { configured: boolean; model: string };

const defaultGoal = '四周内从零开始学会 Python，并亲手做出一个能整理本地文件、支持撤销和预览的工具。';

function App() {
  const [state, setState] = useState<LearningState>(() => loadState());
  const [selectedStage, setSelectedStage] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState(state.campaign.stages[0]?.tasks[0]?.id ?? '');
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
  const [busy, setBusy] = useState<'generate' | 'evaluate' | null>(null);
  const [notification, setNotification] = useState<Notification>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [reviewRating, setReviewRating] = useState(3);
  const [note, setNote] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const campaign = state.campaign;
  const task = useMemo(() => campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === selectedTaskId) ?? campaign.stages[0]?.tasks[0], [campaign, selectedTaskId]);
  const taskProgress: TaskProgress | undefined = task ? state.progress[task.id] : undefined;
  const stats = useMemo(() => getStats(state), [state]);
  const currentStage = campaign.stages[selectedStage] ?? campaign.stages[0];
  const allTasks = campaign.stages.flatMap(stage => stage.tasks);
  const doneMissions = allTasks.filter(item => state.progress[item.id]?.status === 'completed').length;
  const stageCount = campaign.stages.length;
  const currentSlot = Math.max(1, Math.min(9, stats.slots + 1));
  const dueReview = state.reviews.filter(card => new Date(card.dueAt).getTime() <= Date.now());
  const nextReview = state.reviews.find(card => new Date(card.dueAt).getTime() <= Date.now());

  const update = useCallback((next: LearningState) => setState(next), []);
  const flash = useCallback((value: Notification) => setNotification(value), []);

  useEffect(() => { saveState(state); }, [state]);
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

  const beginTask = (nextTask: Task) => {
    if (!isTaskUnlocked(campaign, state.progress, nextTask.id)) {
      flash({ title: '行动点仍在封锁中', body: '完成其前置任务后即可进入。', tone: 'warning' }); return;
    }
    setSelectedTaskId(nextTask.id);
    setState(previous => ({ ...previous, progress: { ...previous.progress, [nextTask.id]: { ...previous.progress[nextTask.id], status: 'active' } } }));
    if (!startedAt) setStartedAt(Date.now() - seconds * 1000);
    setTab('missions');
  };

  const runGeneration = async () => {
    if (goal.trim().length < 12) { flash({ title: '行动目标还不够具体', body: '写明想达成什么，以及最终要交付什么。', tone: 'warning' }); return; }
    setBusy('generate');
    try {
      const input: GoalInput = { goal: goal.trim(), level, days, dailyMinutes, ultimateReward: reward.trim() || '完成一项真实可用的成果' };
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, ...(apiKey ? { apiKey } : {}), model }) });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload.error || '行动线生成失败'), { code: payload.code });
      const newCampaign = (payload as { campaign: Campaign }).campaign;
      const next = importState(JSON.stringify({ version: 1, campaign: newCampaign, progress: {}, reviews: [], notes: {} }));
      update(next); setSelectedStage(0); setSelectedTaskId(newCampaign.stages[0].tasks[0].id); setGoalOpen(false); setSettingsOpen(false); setStartedAt(null); setSeconds(0); setTab('missions');
      flash({ title: '新赛季行动线已部署', body: `${newCampaign.stages.length} 个阶段，${newCampaign.stages.reduce((n, stage) => n + stage.tasks.length, 0)} 个行动点。`, tone: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接 DeepSeek 时发生未知错误。';
      flash({ title: message, body: '当前赛季和进度已保留，可以先继续预置训练。', tone: 'warning' });
    } finally { setBusy(null); }
  };

  const selfEvaluate = () => {
    if (!task || !taskProgress || taskProgress.completedObjectives.length !== task.objectives.length || taskProgress.evidence.trim().length < 20) {
      flash({ title: '还没到撤离条件', body: '完成全部任务目标，再提交至少 20 个字的过程、答案或作品路径。', tone: 'warning' }); return;
    }
    update(setEvaluation(state, task.id, { passed: true, score: 100, feedback: '你已对照所有目标和验收条件完成自我检查。', gaps: [], nextStep: '下一轮先不看笔记，试着回答这张复习卡。' }));
    flash({ title: '自我检查完成', body: '接下来可以请 AI 核对，也可以按“我的自评”领取任务奖励。', tone: 'success' });
  };

  const evaluateWithAI = async () => {
    if (!task || !taskProgress || taskProgress.completedObjectives.length !== task.objectives.length || taskProgress.evidence.trim().length < 20) {
      flash({ title: '请先提交可供核验的情报', body: '勾完所有目标，并写下至少 20 个字的答案或作品记录。', tone: 'warning' }); return;
    }
    setBusy('evaluate');
    try {
      const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, evidence: taskProgress.evidence, ...(apiKey ? { apiKey } : {}), model }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'AI 校准失败');
      const result = payload.evaluation;
      update(setEvaluation(state, task.id, result));
      flash({ title: result.passed ? 'AI 已确认任务掌握' : '发现几个待补线索', body: result.feedback, tone: result.passed ? 'success' : 'warning' });
    } catch (error) { flash({ title: error instanceof Error ? error.message : 'AI 校准失败', body: '检查 API Key 与网络连接后重试。', tone: 'warning' }); }
    finally { setBusy(null); }
  };

  const claimTask = () => {
    if (!task || !taskProgress?.evaluation?.passed) { flash({ title: '验收尚未通过', body: '完成目标与证据后先自评或通过 AI 校准。', tone: 'warning' }); return; }
    try {
      const next = completeTask(state, task.id, taskProgress.verification ?? 'self');
      const newlyCompleted = next.progress[task.id]?.status === 'completed' && taskProgress.status !== 'completed';
      update(next);
      if (newlyCompleted) flash({ title: '成功撤离 · 行动完成', body: `+${task.xp} XP 写入战绩。保险箱又亮起一格。`, tone: 'success' });
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
      const restored = importState(await file.text()); update(restored); setSelectedStage(0); setSelectedTaskId(restored.campaign.stages[0]?.tasks[0]?.id ?? '');
      flash({ title: '行动记录已安全还原', body: '所有字段已经过结构和依赖关系校验。', tone: 'success' });
    } catch (error) { flash({ title: '备份文件无法读取', body: error instanceof Error ? error.message : '文件结构无效。', tone: 'warning' }); }
    finally { event.target.value = ''; }
  };

  const completeReview = () => {
    if (!nextReview) return;
    update(rateReview(state, nextReview.taskId, reviewRating));
    setReviewRating(3);
    flash({ title: '记忆维护完成', body: '下一次复习已按你的回忆情况重新排期。', tone: 'success' });
  };

  const timeLabel = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const stageProgress = currentStage?.tasks.length ? currentStage.tasks.filter(item => state.progress[item.id]?.status === 'completed').length : 0;

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
          <button className={`nav-link ${tab === 'missions' ? 'active' : ''}`} onClick={() => { setTab('missions'); setMobileNav(false); }}><Crosshair size={15} />行动任务</button>
          <button className={`nav-link ${tab === 'archive' ? 'active' : ''}`} onClick={() => { setTab('archive'); setMobileNav(false); }}><Layers2 size={15} />情报档案</button>
          <button className={`nav-link ${tab === 'reviews' ? 'active' : ''}`} onClick={() => { setTab('reviews'); setMobileNav(false); }}><Radio size={15} />复习信号室 {dueReview.length > 0 && <span className="nav-count">{dueReview.length}</span>}</button>
        </nav>
        <div className="topbar-actions">
          <div className="connection-pill"><span className={`connection-dot ${connection.configured || apiKey ? 'online' : ''}`} />{connection.configured || apiKey ? 'AI 已就绪' : '本地训练'}<ChevronDown size={13} /></div>
          <button className="icon-button settings-trigger" aria-label="连接设置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
          <span className="avatar" aria-label={`${stats.xp} 点经验`}>NG</span>
        </div>
      </header>

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
            <span className="progress-caption">已完成 {allTasks.length ? Math.round(doneMissions / allTasks.length * 100) : 0}% · 再亮起 {Math.max(0, 9 - stats.slots)} 格保险箱</span>
            <button className="banner-edit" onClick={() => setGoalOpen(true)}><Plus size={14}/>部署新行动线 <ArrowUpRight size={13}/></button>
          </div>
          <div className="banner-index">NG—01</div>
        </section>

        <div className="section-switcher">
          <div className="section-heading"><span className="section-icon"><Aperture size={16}/></span><span>{tab === 'missions' ? '赛季行动' : tab === 'archive' ? '个人档案' : '复习信号室'}<small>FIELD OPERATIONS <i>·</i> {String(allTasks.length).padStart(2, '0')} MISSIONS</small></span></div>
          <div className="section-controls"><button className={`subtab ${tab === 'missions' ? 'selected' : ''}`} onClick={() => setTab('missions')}>任务看板</button><span className="separator">/</span><button className={`subtab ${tab === 'archive' ? 'selected' : ''}`} onClick={() => setTab('archive')}>线索档案</button><button className="icon-button search-button" aria-label="搜索任务" onClick={() => flash({ title: '行动筛选', body: '从左侧阶段列表中选择想追踪的线索。' })}><Search size={16}/></button></div>
        </div>

        {tab === 'missions' && task && currentStage ? <div className="operations-layout">
          <aside className="mission-rail">
            <div className="rail-head"><div><span className="micro-label">OPERATIONS</span><h2>行动目录 <span>{String(stageCount).padStart(2, '0')}</span></h2></div><button className="icon-button compact" onClick={() => setGoalOpen(true)} aria-label="新建行动线"><Plus size={16}/></button></div>
            <div className="campaign-note"><span className="note-marker">◎</span><span><strong>本赛季终局目标</strong><small>{campaign.goal}</small></span></div>
            <div className="stage-list">
              {campaign.stages.map((stage, stageIndex) => {
                const unlocked = stageIndex === 0 || campaign.stages[stageIndex - 1].tasks.every(previous => state.progress[previous.id]?.status === 'completed');
                const completed = stage.tasks.filter(item => state.progress[item.id]?.status === 'completed').length;
                return <button key={stage.id} className={`stage-card ${selectedStage === stageIndex ? 'stage-selected' : ''} ${!unlocked ? 'stage-locked' : ''}`} onClick={() => { if (unlocked) { setSelectedStage(stageIndex); setSelectedTaskId(stage.tasks.find(item => isTaskUnlocked(campaign, state.progress, item.id) && state.progress[item.id]?.status !== 'completed')?.id ?? stage.tasks[0].id); } else flash({ title: '该阶段尚未解锁', body: '撤离前一阶段的所有行动点，即可进入下一区域。', tone: 'warning' }); }}>
                  <span className="stage-number">{String(stageIndex + 1).padStart(2, '0')}<small>{unlocked ? `${completed}/${stage.tasks.length}` : <LockKeyhole size={12}/>}</small></span>
                  <span className="stage-information"><span className="stage-type">{stageIndex === 0 ? 'INITIAL DEPLOYMENT' : stageIndex === stageCount - 1 ? 'FINAL EXTRACTION' : 'FIELD OPERATION'}</span><strong>{stage.title}</strong><small>{stage.description}</small><i className="stage-card-track"><b style={{ width: `${stage.tasks.length ? completed / stage.tasks.length * 100 : 0}%` }}/></i></span>
                  {unlocked ? <ChevronDown className="stage-chevron" size={17}/> : <LockKeyhole className="stage-chevron" size={16}/>}
                </button>;
              })}
            </div>
            <div className="sidebar-lower"><div className="service-row"><span className="service-dot"/>战术数据流 <small>同步中</small></div><div className="profile-mini"><span className="avatar profile-avatar">NG</span><span><strong>行动员</strong><small>情报等级 · Lv. {Math.floor(stats.xp / 1000) + 1}</small></span><span className="profile-xp"><Zap size={13}/>{stats.xp.toLocaleString()}</span></div></div>
          </aside>

          <section className="mission-board" aria-label="阶段任务列表">
            <div className="board-header"><div><span className="micro-label">ZONE {String(selectedStage + 1).padStart(2, '0')} <i>·</i> {String(currentStage?.tasks.length ?? 0).padStart(2, '0')} TASKS</span><h2>{currentStage?.title ?? '行动区域'}</h2></div><span className="stage-counter">{String(stageProgress).padStart(2, '0')} <i>/</i> {String(currentStage?.tasks.length ?? 0).padStart(2, '0')}<small>已撤离</small></span></div>
            <div className="mission-scroll">
              {currentStage?.tasks.map((item, index) => {
                const progress = state.progress[item.id];
                const unlocked = isTaskUnlocked(campaign, state.progress, item.id);
                const active = item.id === task.id;
                return <button key={item.id} className={`mission-row ${active ? 'mission-active' : ''} ${!unlocked ? 'mission-locked' : ''} ${progress?.status === 'completed' ? 'mission-completed' : ''}`} onClick={() => beginTask(item)}>
                  <span className="mission-ordinal">{String(index + 1).padStart(2, '0')}</span><span className="mission-data"><span className="mission-kicker"><i className={`task-dot dot-${item.kind}`}/>{item.kind === 'boss' ? '终局任务' : item.kind === 'recall' ? '主动回忆' : item.kind === 'practice' ? '实战突破' : '调查行动'}<span className="mission-xp">★ {item.xp}</span></span><strong>{item.title}</strong><small>{item.minutes} 分钟目标时长</small></span>
                  <span className={`mission-status ${progress?.status === 'completed' ? 'done' : ''}`}>{progress?.status === 'completed' ? <CircleCheck size={16}/> : unlocked ? active ? <span className="now-playing"/> : <ChevronDown size={15}/> : <LockKeyhole size={14}/>}</span>
                  <span className="mission-meter">{progress?.status === 'completed' ? '已完成' : unlocked ? '已部署' : '待解锁'}</span>
                </button>;
              })}
              <button className="plan-add-row" onClick={() => setGoalOpen(true)}><span><Plus size={14}/></span><span>制定新的行动计划<small>告诉 AI 你下一项想精通什么</small></span><ArrowRight size={15}/></button>
            </div>
            <div className="board-footer"><span><span className="service-dot"/>行动线路实时同步</span><button onClick={() => setGoalOpen(true)}>编辑赛季 <ArrowUpRight size={13}/></button></div>
          </section>

          <section className="mission-detail" aria-label="行动详情">
            <div className="detail-topline"><span className="detail-tag"><span className={`task-dot dot-${task.kind}`}/>{task.kind === 'boss' ? 'FINAL EXTRACTION' : task.kind === 'recall' ? 'ACTIVE RECALL' : task.kind === 'practice' ? 'FIELD PRACTICE' : 'INTELLIGENCE GATHERING'}</span><button className="icon-button compact" onClick={() => flash({ title: '行动手册', body: '先阅读线索，再动手，再关掉资料验证能否讲明白。' })} aria-label="帮助"><CircleHelp size={17}/></button></div>
            <h2 className="detail-title">{task.title}</h2>
            <p className="detail-brief">{task.brief}</p>
            <div className="intel-callout"><span className="callout-icon"><Fingerprint size={17}/></span><span><small>下一条值得追踪的线索</small>{task.curiosity}</span><Sparkles size={14} className="callout-sparkle"/></div>

            <div className="detail-grid"><div className="detail-mini"><Clock3 size={14}/><span><small>建议时长</small><strong>{task.minutes} 分钟</strong></span></div><div className="detail-mini"><Trophy size={14}/><span><small>撤离奖励</small><strong>+{task.xp} XP</strong></span></div><div className="detail-mini"><Target size={14}/><span><small>行动类型</small><strong>{task.kind === 'boss' ? '综合验收' : task.kind === 'recall' ? '合书回忆' : task.kind === 'practice' ? '动手实战' : '线索调查'}</strong></span></div></div>

            <div className="detail-section"><div className="detail-section-title"><span className="section-index">01</span><strong>本局行动目标</strong><small>{taskProgress?.completedObjectives.length ?? 0}/{task.objectives.length} 已确认</small></div><div className="objective-list">{task.objectives.map(objective => <label key={objective.id} className={`objective-item ${(taskProgress?.completedObjectives ?? []).includes(objective.id) ? 'objective-checked' : ''}`}><input type="checkbox" checked={(taskProgress?.completedObjectives ?? []).includes(objective.id)} disabled={taskProgress?.status === 'completed' || !isTaskUnlocked(campaign, state.progress, task.id)} onChange={() => update(updateObjective(state, task.id, objective.id))}/><span className="custom-check"><Check size={12}/></span><span>{objective.text}</span></label>)}</div></div>

            <div className="detail-section steps-section"><div className="detail-section-title"><span className="section-index">02</span><strong>行动路线</strong><span className="route-difficulty">按顺序推进</span></div><div className="action-steps">{task.steps.map((step, index) => <div className="action-step" key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span>{step}</div>)}</div></div>

            {task.resources.length > 0 && <div className="sources-row"><BookOpen size={14}/><span>原始资料线索</span>{task.resources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<SquareArrowOutUpRight size={11}/></a>)}</div>}

            <div className="evidence-box"><div className="evidence-head"><span><FileText size={15}/>行动记录与撤离证据</span><span>{taskProgress?.evidence?.trim().length ?? 0} 字</span></div><textarea aria-label="行动记录与撤离证据" value={taskProgress?.evidence ?? ''} disabled={taskProgress?.status === 'completed'} onChange={event => update(setEvidence(state, task.id, event.target.value))} placeholder={task.kind === 'recall' ? '先不看笔记，把答案用自己的话写下来。也可以贴上你亲手写的代码或作品路径。' : '记录你做了什么、观察到什么、还卡在哪里。也可以贴作品路径或关键代码…'} /><div className="evidence-footer"><span>提交至少 20 字的答案、过程或作品说明</span><span>{taskProgress?.status === 'completed' ? '撤离成功' : '记录仅保存在此设备'}</span></div></div>

            {taskProgress?.evaluation && <div className={`evaluation-card ${taskProgress.evaluation.passed ? 'evaluation-pass' : 'evaluation-retry'}`}><div className="evaluation-header"><span>{taskProgress.verification === 'ai' ? <Sparkles size={15}/> : <ShieldCheck size={15}/>} {taskProgress.verification === 'ai' ? `AI 校准 · ${taskProgress.evaluation.score} 分` : '行动员自评'}{taskProgress.status === 'completed' && <span className="verdict-chip">已撤离</span>}</span><span className="evaluation-score">{taskProgress.evaluation.passed ? <CircleCheck size={15}/> : <RotateCcw size={14}/>}</span></div><p>{taskProgress.evaluation.feedback}</p>{taskProgress.evaluation.gaps.length > 0 && <ul>{taskProgress.evaluation.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}<small>下一步：{taskProgress.evaluation.nextStep}</small></div>}

            {taskProgress?.status !== 'completed' && <div className="assessment-actions"><button className="review-button" onClick={selfEvaluate} disabled={busy !== null || !taskProgress?.evidence.trim()}><ShieldCheck size={14}/>自我检查</button><button className="ai-assessment-button" onClick={evaluateWithAI} disabled={busy !== null || !taskProgress?.evidence.trim()}>{busy === 'evaluate' ? <><span className="spinner"/> 正在校准情报…</> : <><Sparkles size={14}/>请 AI 核对</>}</button><button className={'extract-button ' + (taskProgress?.evaluation?.passed ? 'extract-ready' : '')} onClick={claimTask} disabled={busy !== null}><span><ArrowUpRight size={17}/></span>完成行动 · +{task.xp} XP</button></div>}
            {taskProgress?.status === 'completed' && <div className="completed-banner"><CircleCheck size={16}/><span>行动完成 <small>{taskProgress.verification === 'ai' ? '本局由 DeepSeek 核验' : '本局由行动员自我验收'}</small></span><span>+{task.xp} XP</span></div>}
            <div className="detail-bottom"><span><span className="service-dot"/>行动存档自动保存</span><span><ShieldCheck size={13}/> 本地加密边界 · 浏览器私有存储</span></div>
          </section>

          <aside className="rewards-panel"><div className="vault-header"><div><span className="micro-label">PERSONAL ARMORY</span><h3>九格保险箱</h3></div><span className="vault-level"><span className="vault-level-dot"/>可用</span></div><div className="vault-summary"><span>下一格战利品</span><strong>{campaign.ultimateReward}</strong><div className="vault-summary-track"><i style={{ width: `${Math.min(100, stats.slots / 9 * 100)}%` }}/></div><small>GRID {String(currentSlot).padStart(2, '0')} / 09 <i>·</i> {doneMissions} 项行动完成</small></div>
            <div className="vault-grid" aria-label={`九格保险箱，${stats.slots} 格已解锁`}>{Array.from({ length: 9 }, (_, index) => { const unlocked = index < stats.slots; return <div key={index} className={`vault-cell ${unlocked ? 'vault-open' : index === currentSlot - 1 ? 'vault-next' : ''}`} title={`第 ${index + 1} 格${unlocked ? '，已解锁' : '，完成行动解锁'}`}><span className="vault-cell-index">0{index + 1}</span><span className="vault-cell-icon">{unlocked ? <Check size={14}/> : index === currentSlot - 1 ? <Aperture size={14}/> : <LockKeyhole size={13}/>}</span><span className="vault-cell-title">{unlocked ? ['线索','地图','火种','钥匙','图纸','坐标','徽记','终局','战利品'][index] : index === currentSlot - 1 ? '下一格' : '加密'}</span></div>; })}</div>
            <div className="vault-foot"><span>行动奖励将为真实掌握解锁</span><span>{stats.slots}<i>/</i>9</span></div>

            <div className="review-panel"><div className="review-panel-title"><span><Radio size={15}/>复习雷达</span><span className="review-badge">{dueReview.length} 待处理</span></div>{nextReview ? <><div className="review-card"><span className="review-wave"><i/><i/><i/><i/><i/><i/><i/></span><small>下一条记忆信号</small><strong>{allTasks.find(item => item.id === nextReview.taskId)?.title ?? '知识点回顾'}</strong><span>{new Date(nextReview.dueAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · 主动回忆</span></div><button className="review-cta" onClick={() => setTab('reviews')}>进入信号室 <ArrowRight size={14}/></button></> : <div className="review-empty"><CircleCheck size={17}/><span>雷达目前安静<small>完成新行动后自动安排间隔复习。</small></span></div>}</div>

            <div className="streak-panel"><Flame size={16}/><span>今天的行动记录</span><strong>{startedAt ? '进行中' : stats.completed > 0 ? '档案已保存' : '等待部署'}<small>{startedAt ? timeLabel + ' · 该休息时就休息' : '节奏由你掌握，不靠熬时长'}</small></strong></div>
            <button className="backup-link" onClick={() => { const blob = new Blob([exportState(state)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'ninegrid-learning-backup.json'; link.click(); URL.revokeObjectURL(url); flash({ title: '档案已导出', body: '备份文件不含 API Key。', tone: 'success' }); }}><ArrowDown size={13}/>导出赛季情报档案</button>
          </aside>
        </div> : tab === 'archive' ? <ArchiveScreen state={state} allTasks={allTasks} onRestore={importBackup}/> : <ReviewScreen state={state} onRating={setReviewRating} rating={reviewRating} onComplete={completeReview}/>}

        <footer className="global-footer"><span>九格行动 <i>·</i> 每一格，都由真正掌握解锁。</span><span>SESSION <i>—</i> {timeLabel}</span><span>休息也是行动计划的一部分。</span></footer>
      </div>

      {goalOpen && <GoalModal goal={goal} level={level} days={days} minutes={dailyMinutes} reward={reward} connection={connection} model={model} busy={busy === 'generate'} apiKey={apiKey} onGoal={setGoal} onLevel={setLevel} onDays={setDays} onMinutes={setDailyMinutes} onReward={setReward} onModel={setModel} onApiKey={setApiKey} onClose={() => { setGoalOpen(false); setApiKey(''); }} onGenerate={runGeneration}/>}
      {settingsOpen && <SettingsModal apiKey={apiKey} model={model} connection={connection} onApiKey={setApiKey} onModel={setModel} onClose={() => { setSettingsOpen(false); setApiKey(''); }} onApply={() => { setSettingsOpen(false); flash({ title: '连接设置已应用', body: '密钥仅保留在当前页面内存，刷新后需要重新输入。', tone: 'success' }); }}/ >}
      {notification && <div className={`toast ${notification.tone ?? ''}`} role="status"><span className="toast-icon">{notification.tone === 'success' ? <CircleCheck size={16}/> : <Activity size={16}/>}</span><span><strong>{notification.title}</strong>{notification.body && <small>{notification.body}</small>}</span><button className="icon-button compact" onClick={() => setNotification(null)} aria-label="关闭通知"><X size={14}/></button></div>}
    </main>
  );
}

function GoalModal({ goal, level, days, minutes, reward, connection, model, busy, apiKey, onGoal, onLevel, onDays, onMinutes, onReward, onModel, onApiKey, onClose, onGenerate }: { goal: string; level: string; days: number; minutes: number; reward: string; connection: Connection; model: string; busy: boolean; apiKey: string; onGoal: (s:string)=>void; onLevel:(s:string)=>void; onDays:(n:number)=>void; onMinutes:(n:number)=>void; onReward:(s:string)=>void; onModel:(s:string)=>void; onApiKey:(s:string)=>void; onClose:()=>void; onGenerate:()=>void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="goal-modal" role="dialog" aria-modal="true" aria-labelledby="goal-modal-title">
    <div className="modal-topline"><span><Sparkles size={15}/> OPERATION DESIGN TERMINAL</span><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></div>
    <div className="modal-heading"><span className="modal-icon"><Target size={19}/></span><div><h2 id="goal-modal-title">新赛季，追踪一个新目标。</h2><p>输入具体成果。AI 会把路拆成有线索、有验收、有撤离奖励的阶段任务。</p></div></div>
    <label className="form-field goal-field"><span><b>01</b>最终行动目标 <small>写清楚你要会什么、要做出什么</small></span><textarea value={goal} onChange={event => onGoal(event.target.value)} minLength={12} maxLength={1000} placeholder="例如：六周内从零学会 SQL，分析开源电商数据，交付一个能回答 5 个经营问题的仪表盘。" /><small className="field-hint">越具体，部署出的主线、支线和撤离条件越准确。</small></label>
    <div className="form-columns"><label className="form-field"><span><b>02</b>当前基础</span><select value={level} onChange={event => onLevel(event.target.value)}><option>零基础</option><option>了解一些，需要补基础</option><option>已有基础，想进阶</option><option>有经验，冲刺专精</option></select></label><label className="form-field"><span><b>03</b>赛季长度 <small>天</small></span><input type="number" min={1} max={365} value={days} onChange={event => onDays(Math.max(1, Math.min(365, Number(event.target.value))))}/></label></div>
    <div className="form-columns"><label className="form-field"><span><b>04</b>每天的预算 <small>分钟</small></span><input type="number" min={10} max={240} step={5} value={minutes} onChange={event => onMinutes(Math.max(10, Math.min(240, Number(event.target.value))))}/></label><label className="form-field"><span><b>05</b>九格终极战利品</span><input value={reward} maxLength={120} onChange={event => onReward(event.target.value)} placeholder="比如：把真实作品发给第一个用户"/></label></div>
    <details className="model-connection"><summary><span><KeyRound size={14}/> DeepSeek 连接 <i>{connection.configured ? '· 本机服务已连接' : '· 也可在服务器 .env 配置'}</i></span><ChevronDown size={14}/></summary><div className="connection-fields"><label className="form-field"><span>模型</span><select value={model} onChange={event => onModel(event.target.value)}><option value="deepseek-flash">DeepSeek Flash · 高效部署</option><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><label className="form-field"><span>本次密钥 <small>离开页面即清除</small></span><input type="password" autoComplete="off" value={apiKey} onChange={event => onApiKey(event.target.value)} placeholder={connection.configured ? '已在本机 .env 配置，留空即可' : 'sk-… · 只发往官方 DeepSeek API'} /></label><p className="key-privacy"><ShieldCheck size={13}/> 密钥只在此页面内存中，并经本地服务端发送到 api.deepseek.com。不含在备份里。</p></div></details>
    <div className="method-callout"><Orbit size={16}/><span><strong>这条行动线会如何学习</strong><small>持续调查概念关系 → 关掉资料主动回忆 → 产出作品 → 按记忆情况安排复习。阶段梯度帮助开始和坚持，不以连续时长发奖。</small></span></div>
    <div className="modal-actions"><span>部署期间，原赛季情报仍保存在本设备。</span><button className="modal-submit" onClick={onGenerate} disabled={busy || goal.trim().length < 12}>{busy ? <><span className="spinner"/> 正在生成行动线…</> : <><Crosshair size={16}/>部署行动线<ArrowRight size={15}/></>}</button></div>
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

function ReviewScreen({ state, rating, onRating, onComplete }: { state: LearningState; rating:number; onRating:(n:number)=>void; onComplete:()=>void }) {
  const cards = state.reviews.slice().sort((a,b)=>new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime());
  const card = cards.find(item=>new Date(item.dueAt).getTime()<=Date.now());
  const task = card && state.campaign.stages.flatMap(stage=>stage.tasks).find(item=>item.id===card.taskId);
  return <section className="utility-screen review-screen"><div className="utility-hero"><span className="micro-label">MEMORY MAINTENANCE · ACTIVE RETRIEVAL</span><h2>记忆雷达，准备就绪。</h2><p>先合上笔记，试着从头回忆。发现薄弱的地方是有效线索，不是失败。</p></div><div className="review-workspace">{task&&card?<><div className="review-focus-card"><span className="detail-tag"><Radio size={13}/> 今日记忆信号 · 第 {card.repetitions+1} 次回访</span><h3>{task.recallQuestion}</h3><p>{task.curiosity}</p><details className="recall-hint"><summary>想不到线索？查看温和提示</summary><p>{task.hint}</p><button className="text-button" onClick={onComplete}>看过提示，记录本次复习</button></details><div className="rating-heading">你刚才回忆起来的程度是？<small>如实评分，下一次的间隔才会贴合你。</small></div><div className="rating-options">{[{value:1,label:'完全没想起',symbol:'1'},{value:2,label:'有點模糊',symbol:'2'},{value:3,label:'想起主要思路',symbol:'3'},{value:4,label:'完整讲清楚',symbol:'4'}].map(option=><button key={option.value} className={`rating-option ${rating===option.value?'rating-selected':''}`} onClick={()=>onRating(option.value)}><span>{option.symbol}</span>{option.label}</button>)}</div><button className="review-cta review-submit" onClick={onComplete}><Check size={15}/>保存回忆并安排下次复习</button></div><aside className="review-queue"><span className="micro-label">MEMORY SIGNAL QUEUE</span><h3>{cards.length} 条复习信号</h3>{cards.map((item,index)=><div className={`queue-item ${item.taskId===card.taskId?'queue-current':''}`} key={item.taskId}><span>{String(index+1).padStart(2,'0')}</span><span><strong>{state.campaign.stages.flatMap(stage=>stage.tasks).find(value=>value.id===item.taskId)?.title}</strong><small>预计 {new Date(item.dueAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})} 回访</small></span></div>)}</aside></>:<div className="review-clear"><span className="review-clear-icon"><ShieldCheck size={24}/></span><h3>此刻没有待复习的信号。</h3><p>完成任意行动后，我们会在未来的适当时点提醒你，把知识从记忆里重新取出来。</p><div className="rest-banner"><Headphones size={16}/>留白是复习节奏的一部分。回来时，档案还在。</div></div>}</div></section>;
}

export default App;
