import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, ShieldCheck, Swords } from 'lucide-react';
import { CHALLENGE_MODE_SETTINGS, type ChallengeMode } from '../../shared/challengeRules';
import { formatHafverCoins } from '../../shared/economy';
import type { LearningState, Task } from '../../shared/types';
import { isTaskUnlocked } from '../lib/engine';
import { apiFetch } from '../lib/api';
import { AccountFeatureNavigation } from './AccountFeatureNavigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import './EconomyScreens.css';

type Season = { id: string; title: string; state: LearningState };
type ChallengeQuestion = { id: string; taskId: string; taskTitle: string; prompt: string; requiredCriteria: Array<{ id: string; text: string }>; hints: string[]; lessonRevision: number; difficulty: string };
type ChallengeAnswer = { questionId: string; answer: string; hintLevelsUsed: number };
type QuestionResult = { questionId: string; correct: boolean; score: number; feedback: string; gaps: string[]; nextStep: string };
type Run = {
  id: string; season_id: string; task_id: string; tier: ChallengeMode; status: string; entry_fee: number; prompt: string;
  questions?: ChallengeQuestion[]; answers?: ChallengeAnswer[]; question_count?: number; pass_threshold?: number; correct_answers?: number;
  evidence?: string; evaluation?: { passed: boolean; score: number; feedback: string; gaps: string[]; nextStep: string; correctAnswers?: number; questionResults?: QuestionResult[] };
  reward_item?: any; reward_coins?: number; rewardCoins?: number; deadline_at: string; settled_at?: string;
};
type Mode = { id: ChallengeMode; title: string; entryFee: number; minutes: number; hintLimit: number; questionCount: number; correctToPass: number; difficulty: string; questionStyle: string; paid: boolean; pool: Array<{ rarity: string; probability: number }>; rewardExpectedRecovery: number; rewardCoins?: number };
type KdStat = { correctAnswers: number; settledRounds: number; kd: number | null };
type KdStats = Record<ChallengeMode, KdStat> & { overall: KdStat; overallPaid: KdStat };
type ModeAvailability = { available: number; required: number; ready: boolean };

const rarityLabels: Record<string, string> = { 'small-purple': '小紫', 'small-gold': '小金', 'large-gold': ' 大金', 'small-red': '小红', 'large-red': '大红' };
const money = formatHafverCoins;
const moneyExpectation = (value: number) => formatHafverCoins(Math.round(value));
const emptyStat: KdStat = { correctAnswers: 0, settledRounds: 0, kd: null };
const emptyStats: KdStats = { free: emptyStat, ordinary: emptyStat, confidential: emptyStat, 'top-secret': emptyStat, overall: emptyStat, overallPaid: emptyStat };
const emptyAnswer = (question: ChallengeQuestion): ChallengeAnswer => ({ questionId: question.id, answer: '', hintLevelsUsed: 0 });

export function ChallengesScreen({ account, onExit, onLogout, onNavigate }: { account: string; onExit: () => void; onLogout: () => void; onNavigate: (path: string) => void }) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [modes, setModes] = useState<Mode[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [availability, setAvailability] = useState<Partial<Record<ChallengeMode, ModeAvailability>>>({});
  const [kdStats, setKdStats] = useState<KdStats>(emptyStats);
  const [balance, setBalance] = useState(0);
  const [seasonId, setSeasonId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [modeId, setModeId] = useState<ChallengeMode>('ordinary');
  const [active, setActive] = useState<Run | null>(null);
  const [answers, setAnswers] = useState<ChallengeAnswer[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const entryOperationId = useRef<string | null>(null);

  async function refresh() {
    try {
      const [challengeResponse, seasonResponse, walletResponse, historyResponse] = await Promise.all([
        apiFetch('/api/challenges'), apiFetch('/api/seasons'), apiFetch('/api/wallet'), apiFetch('/api/challenges/history'),
      ]);
      if (![challengeResponse, seasonResponse, walletResponse, historyResponse].every(response => response.ok)) throw new Error('挑战档案载入失败');
      const [challengeData, seasonData, walletData, historyData] = await Promise.all([
        challengeResponse.json(), seasonResponse.json(), walletResponse.json(), historyResponse.json(),
      ]);
      setModes(challengeData.tiers);
      setSeasons(seasonData.seasons);
      setBalance(Number(walletData.wallets?.find((item: any) => item.currency === 'learning-coin')?.balance ?? 0));
      const allRuns = historyData.challenges as Run[];
      setRuns(allRuns);
      setKdStats(historyData.kdStats ?? emptyStats);
      setSeasonId(value => value || seasonData.seasons?.[0]?.id || '');
      const current = allRuns.find(run => ['active', 'evaluating', 'ready_to_extract'].includes(run.status));
      if (current) {
        setActive(current);
        setAnswers(Array.isArray(current.answers) ? current.answers : (current.questions ?? []).map(emptyAnswer));
        setSaveState('saved');
        setModeId(current.tier);
        setSeasonId(current.season_id);
        setTaskId(current.task_id);
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败，挑战状态仍保存在服务器。');
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!seasonId) return;
    let alive = true;
    apiFetch(`/api/challenges/availability?seasonId=${encodeURIComponent(seasonId)}`).then(async response => {
      if (!response.ok) throw new Error('无法读取已解锁目标数量');
      const data = await response.json();
      if (alive) setAvailability(data.byMode ?? {});
    }).catch(() => { if (alive) setAvailability({}); });
    return () => { alive = false; };
  }, [seasonId]);

  const season = seasons.find(item => item.id === seasonId);
  const allTasks = useMemo(() => season?.state.campaign.stages.flatMap(stage => stage.tasks) ?? [], [season]);
  const ready = useMemo(() => season ? allTasks.filter(task => season.state.progress[task.id]?.status === 'completed' || isTaskUnlocked(season.state.campaign, season.state.progress, task.id)) : [], [season, allTasks]);
  useEffect(() => {
    if (ready.length && !ready.some(task => task.id === taskId)) setTaskId(ready[0].id);
  }, [ready, taskId]);
  const task = ready.find(item => item.id === taskId) as Task | undefined;
  const activeSeason = active ? seasons.find(item => item.id === active.season_id) : undefined;
  const mode = modes.find(item => item.id === modeId);
  const eligibleCount = ready.reduce((sum, item) => sum + item.objectives.length, 0);

  async function persistAnswers(value = answers) {
    if (!active) return false;
    const revision = ++saveRevision.current;
    setSaveState('saving');
    const runId = active.id;
    let success = false;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const response = await apiFetch(`/api/challenges/${runId}/answers`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: value }),
        });
        if (!response.ok) throw new Error('答案暂未保存，请检查连接后重试。');
        success = true;
        if (revision === saveRevision.current) setSaveState('saved');
      } catch (e) {
        if (revision === saveRevision.current) { setSaveState('failed'); setError(e instanceof Error ? e.message : '答案暂未保存。'); }
      }
    });
    await saveQueue.current;
    return success;
  }

  useEffect(() => {
    if (!active || active.status !== 'active' || !answers.length) return;
    const timer = window.setTimeout(() => { void persistAnswers(answers); }, 500);
    return () => window.clearTimeout(timer);
  }, [active?.id, active?.status, answers]);

  function updateAnswer(questionId: string, answer: string) {
    setAnswers(previous => {
      const found = previous.some(item => item.questionId === questionId);
      return found ? previous.map(item => item.questionId === questionId ? { ...item, answer } : item) : [...previous, { questionId, answer, hintLevelsUsed: 0 }];
    });
    setSaveState('idle');
  }

  function revealNextHint(question: ChallengeQuestion) {
    const current = answers.find(item => item.questionId === question.id) ?? emptyAnswer(question);
    const hintLimit = active ? CHALLENGE_MODE_SETTINGS[active.tier].hintLimit : 0;
    if (current.hintLevelsUsed >= hintLimit || current.hintLevelsUsed >= question.hints.length) return;
    setAnswers(previous => {
      const found = previous.some(item => item.questionId === question.id);
      return found ? previous.map(item => item.questionId === question.id ? { ...item, hintLevelsUsed: item.hintLevelsUsed + 1 } : item) : [...previous, { ...current, hintLevelsUsed: current.hintLevelsUsed + 1 }];
    });
    setSaveState('idle');
  }

  async function enter() {
    if (!season || !task || !mode) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch('/api/challenges/enter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId: season.id, taskId: task.id, tier: modeId, operationId: entryOperationId.current ??= crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'CHALLENGE_QUESTION_BANK_INSUFFICIENT') throw new Error(`当前已解锁目标只有 ${data.available} 题，此档需要 ${data.required} 道不同目标。继续学习并生成更多任务讲解后再参加。`);
        if (data.error === 'INSUFFICIENT_BALANCE') throw new Error(`余额不足，需要 ${money(data.required)} 哈弗币。`);
        if (data.error === 'PAID_CHALLENGE_IN_PROGRESS') { await refresh(); throw new Error('已有一局付费行动尚未结束，已恢复该局。'); }
        if (data.error === 'FREE_CHALLENGE_IN_PROGRESS') { await refresh(); throw new Error('已有一局免费训练尚未结束，已恢复该局。'); }
        if (data.error === 'CHALLENGE_ENTRY_IDEMPOTENCY_CONFLICT') { await refresh(); throw new Error('入场操作编号已用于另一项请求，行动记录已重新读取。'); }
        throw new Error(data.error ?? '无法进入挑战');
      }
      const run: Run = { ...data.challenge, season_id: season.id, task_id: task.id, entry_fee: data.challenge.entryFee, deadline_at: data.challenge.deadlineAt };
      entryOperationId.current = null;
      setActive(run);
      setAnswers(data.challenge.answers ?? (data.challenge.questions as ChallengeQuestion[]).map(emptyAnswer));
      setSaveState('saved');
      setBalance(data.balance);
      setNotice(mode.paid ? `已扣除 ${money(mode.entryFee)} 入场费。题目和答案将保存在服务器，可稍后继续。` : `免费训练已开始，不扣入场费；达标并确认结算后获得 ${money(mode.rewardCoins ?? 0)} 哈弗币。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '挑战进入失败');
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!active) return;
    setBusy(true); setError('');
    try {
      if (saveState === 'failed' || !(await persistAnswers(answers))) throw new Error('答案未保存成功；保留输入后可以重试。');
      const response = await apiFetch(`/api/challenges/${active.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code === 'CHALLENGE_RETRYABLE' ? '评价服务暂不可用；本局答案已保存，可以稍后重试。' : data.error === 'EVALUATION_IN_PROGRESS' ? '服务器正在评价；稍后刷新查看结果。' : data.error === 'CHALLENGE_EVALUATION_INVALID' ? '评价格式异常，入场费已自动退回。' : data.error ?? '验收失败');
      const completed = { ...active, ...data.challenge, reward_item: data.challenge.rewardItem ?? data.challenge.reward_item };
      setActive(completed); setRuns(previous => [completed, ...previous.filter(run => run.id !== completed.id)]);
      setNotice(completed.status === 'ready_to_extract' ? '已达到本档标准。确认撤离后才会结算奖励。' : completed.status === 'technical_refund' ? '技术问题导致评价未完成，入场费已退回。' : '未达到本档通过线；课程进度和本局逐题记录均保留。');
      setSaveState('saved'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败；答案已保留，可以重试。'); }
    finally { setBusy(false); }
  }

  async function extract() {
    if (!active || active.status !== 'ready_to_extract') return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`/api/challenges/${active.id}/extract`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code === 'CHALLENGE_NOT_READY_TO_EXTRACT' ? '服务器尚未确认撤离条件；本局状态仍保留。' : data.error ?? '撤离结算失败；可以重试。');
      const completed = { ...active, ...data.challenge, reward_item: data.challenge.rewardItem ?? data.challenge.reward_item };
      setActive(completed); setRuns(previous => [completed, ...previous.filter(run => run.id !== completed.id)]);
      setNotice(completed.tier === 'free' ? `训练结果已保存，获得 ${money(completed.rewardCoins ?? completed.reward_coins ?? 0)} 哈弗币；免费训练不产出藏品。` : `已确认撤离，${completed.reward_item?.name ?? '行动奖励'}已收入仓库。`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '撤离结算失败；本局仍可重试。'); }
    finally { setBusy(false); }
  }

  async function abandon() {
    if (!active) return;
    setBusy(true); setError('');
    try {
      if (active.status === 'active' && !(await persistAnswers(answers))) throw new Error('答案尚未保存，不能放弃本局。');
      if (!window.confirm(active.tier === 'free' ? '结束这局免费训练？答案会保留在行动记录中。' : '放弃本局？入场费不退，尚未撤离的奖励不会结算。')) return;
      const response = await apiFetch(`/api/challenges/${active.id}/abandon`, { method: 'POST' });
      if (!response.ok) throw new Error('本局已结算或不再有效');
      setActive(null); setAnswers([]); setNotice(active.tier === 'free' ? '已结束免费训练，未完成撤离结算，因此没有发放奖励。' : '已结束本局，入场费不退还。'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '结束本局失败'); }
    finally { setBusy(false); }
  }

  const settled = kdStats.overall;
  const paidSettled = kdStats.overallPaid;
  const activeQuestions = active?.questions ?? [];
  const modeLabel = (id: ChallengeMode) => CHALLENGE_MODE_SETTINGS[id].title;

  return <main className="economy-page challenge-page">
    <header className="econ-header"><button onClick={onExit}><ArrowLeft size={16}/>返回课程</button><div><span>NINEGRID · ACTION RECORD</span><h1>赛季行动</h1></div><div className="econ-user">{account} <button onClick={onLogout}>退出</button></div></header>
    <AccountFeatureNavigation currentPath="/challenges" onNavigate={onNavigate}/>
    <section className="challenge-hero"><div><span className="econ-kicker">训练场与赛季行动</span><h2>用已学目标完成一局。</h2><p>免费训练可无限参加：达标并确认结算后，按机密奖池期望值的 1/10 折算发币（按整数向下取整）；普通、机密、绝密行动按档位扣费并结算藏品。已开始的行动会保存在服务器。</p></div><strong>哈弗币 · {money(balance)}</strong></section>
    {error&&<div className="econ-error" role="alert">{error}<button onClick={()=>void refresh()}>重试/读取状态</button></div>}
    {notice&&<div className="econ-notice" role="status">{notice}</div>}

    <section className="challenge-kd" aria-label="行动 KD 统计">
      <div><span>总行动 KD</span><strong>{settled.kd === null ? '—' : settled.kd.toFixed(2)}</strong><small>答对题数 / 已结算局数（含免费训练）· {settled.correctAnswers}/{settled.settledRounds}</small></div>
      <div><span>付费行动 KD</span><strong>{paidSettled.kd === null ? '—' : paidSettled.kd.toFixed(2)}</strong><small>付费行动答对题数 / 已结算付费局数 · {paidSettled.correctAnswers}/{paidSettled.settledRounds}</small></div>
      {(['ordinary','confidential','top-secret','free'] as ChallengeMode[]).map(id => {
        const stat = kdStats[id];
        return <div key={id}><span>{modeLabel(id)} KD</span><strong>{stat.kd === null ? '—' : stat.kd.toFixed(2)}</strong><small>{stat.correctAnswers} 题 / {stat.settledRounds} 局</small></div>;
      })}
    </section>

    {active ? <section className="active-challenge">
      <span className="econ-kicker">{modeLabel(active.tier)} · {active.status === 'evaluating' ? '评价中' : '进行中'}</span>
      <h2>{active.prompt}</h2>
      <p>服务器截止：{new Date(active.deadline_at).toLocaleString('zh-CN')} · {activeQuestions.length} 题，答对 {active.evaluation?.correctAnswers ?? active.correct_answers ?? 0} 题。刷新或重新启动后可继续本局。</p>
      {active.status === 'active' && activeQuestions.length > 0 && <>
        <div className="challenge-answer-status" role="status">{saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '答案已保存到服务器' : saveState === 'failed' ? '保存失败，输入仍保留' : '输入后自动保存'}
          {saveState === 'failed' && <button className="econ-secondary" onClick={() => void persistAnswers(answers)}>重试保存</button>}
        </div>
        <div className="challenge-question-list">{activeQuestions.map((question, index) => {
          const answer = answers.find(item => item.questionId === question.id)?.answer ?? '';
          return <article className="challenge-question" key={question.id}>
            <div className="challenge-question-heading"><span>题目 {String(index + 1).padStart(2, '0')} / {activeQuestions.length}</span><strong>{question.taskTitle}</strong></div>
            <p>{question.prompt}</p>
            <details className="challenge-rubric"><summary>查看本题验收要点</summary><ul>{question.requiredCriteria.map(criterion=><li key={criterion.id}>{criterion.text}</li>)}</ul></details>
            <div className="challenge-hints"><button type="button" className="econ-secondary" disabled={busy || (answers.find(item => item.questionId === question.id)?.hintLevelsUsed ?? 0) >= Math.min(CHALLENGE_MODE_SETTINGS[active.tier].hintLimit, question.hints.length)} onClick={() => revealNextHint(question)}>查看提示 · {answers.find(item => item.questionId === question.id)?.hintLevelsUsed ?? 0}/{CHALLENGE_MODE_SETTINGS[active.tier].hintLimit}</button>{(question.hints ?? []).slice(0, answers.find(item => item.questionId === question.id)?.hintLevelsUsed ?? 0).map((hint, hintIndex) => <p key={hintIndex}>提示 {hintIndex + 1}：{hint}</p>)}</div>
            <label>你的答案<Textarea aria-label={`第 ${index + 1} 题答案`} value={answer} onChange={event => updateAnswer(question.id, event.target.value)} maxLength={20_000} placeholder="写下这题的作答和必要依据。答案会自动保存。"/></label>
          </article>;
        })}</div>
        <div className="challenge-actions"><Button disabled={busy || saveState === 'saving'} onClick={() => void submit()}><ShieldCheck size={16}/>{busy ? '正在评价…' : '提交答案并验收'}</Button><Button variant="outline" disabled={busy} onClick={() => void abandon()}>{active.tier === 'free' ? '结束训练' : '放弃行动（入场费不退）'}</Button></div>
      </>}
      {active.status === 'evaluating' && <p role="status">服务器正在处理已保存的答案。刷新可读取最新结果。</p>}
      {active.status === 'ready_to_extract' && <div className="challenge-extraction"><h3>撤离条件已满足</h3><p>{active.evaluation?.feedback} · {active.evaluation?.score ?? 0}/100</p><p>{active.tier === 'free' ? `确认结算后获得 ${money(modes.find(item=>item.id==='free')?.rewardCoins ?? 0)} 哈弗币，不产出藏品。` : '评价已保存。确认撤离后，行动奖励才会收入仓库。'}</p><button className="econ-primary" disabled={busy} onClick={() => void extract()}>{busy ? '正在结算…' : active.tier === 'free' ? '确认结束训练并领取奖励' : '确认撤离并结算奖励'}</button><button className="econ-secondary" disabled={busy} onClick={() => void abandon()}>{active.tier === 'free' ? '结束训练' : '放弃行动（入场费不退）'}</button></div>}
      {!['active','evaluating','ready_to_extract'].includes(active.status) && <div className={`challenge-result ${active.status}`}>
        <strong>{active.status === 'passed' ? '本局通过' : active.status === 'technical_refund' ? '技术故障 · 已退款' : '本局未通过'}</strong>
        {active.evaluation && <><p>{active.evaluation.feedback} · {active.evaluation.score}/100</p><ol className="challenge-question-results">{active.evaluation.questionResults?.map((result,index)=><li key={result.questionId}><b>{result.correct ? '答对' : '待补强'} · 第 {index + 1} 题</b><span>{result.feedback}</span></li>)}</ol>{active.evaluation.gaps?.length>0&&<p>待补强：{active.evaluation.gaps.join('；')}</p>}<p>下一步：{active.evaluation.nextStep}</p></>}
        {active.reward_item&&<p>行动奖励：{active.reward_item.name} · {active.reward_item.rarity} <button onClick={()=>onNavigate('/inventory')}>查看仓库<ArrowRight size={14}/></button></p>}
        {active.tier === 'free' && <p>{active.status === 'passed' ? `免费训练结算奖励：${money(active.rewardCoins ?? active.reward_coins ?? 0)} 哈弗币。` : '免费训练未通过，不发放奖励。'}</p>}
        <small>K/D 统计已按本局答对题数记录；技术退款不计入 K/D。</small>
      </div>}
    </section> : <>
      <div className="challenge-entry">
        <div className="challenge-selectors">
          <label>选择赛季<select value={seasonId} onChange={event => { setSeasonId(event.target.value); setTaskId(''); entryOperationId.current = null; }}>{seasons.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>选择行动重点<select value={task?.id ?? ''} onChange={event=>{setTaskId(event.target.value);entryOperationId.current=null;}}>{ready.map(item=><option key={item.id} value={item.id}>{item.title} · {item.minutes} 分钟</option>)}</select></label>
        </div>
        {!ready.length && <p>当前没有已完成或已解锁的任务目标。先在赛季中学习并完成若干目标，再进入行动。</p>}
        {task && <article className="challenge-task"><Swords/><div><strong>{task.title}</strong><p>{task.brief}</p><small>每局从已解锁目标抽题并轮换情境；可以反复参加挑战，但不会改变课程任务验收。当前有 {availability.ordinary?.available ?? eligibleCount} 个可用目标。</small></div></article>}
        <div className="challenge-tiers">{modes.map(item=>{
          const fresh = availability[item.id];
          const enoughQuestions = fresh ? fresh.ready : eligibleCount >= item.questionCount;
          return <button key={item.id} className={modeId===item.id?'selected':''} disabled={!enoughQuestions} onClick={()=>setModeId(item.id)}>
            <span>{item.title}</span><b>{item.paid ? `${money(item.entryFee)} 币` : '免费'}</b>
            <small>{item.questionCount} 题 · {item.minutes} 分钟 · 通过线 {item.correctToPass} 题</small>
            <small>{item.difficulty} · 提示 {item.hintLimit} 次</small>
            {item.paid ? <><div>{item.pool.map(entry=><span key={entry.rarity}>{rarityLabels[entry.rarity] ?? entry.rarity} {(entry.probability*100).toFixed(entry.probability<.01?2:1)}%</span>)}</div><small>奖励池回收期望 {moneyExpectation(item.rewardExpectedRecovery)} 币</small></> : <small>不扣币 · 达标并确认结算固定获得 {money(item.rewardCoins ?? 0)} 哈弗币（机密奖池期望值 1/10，按整数向下取整）· 不产出藏品</small>}
            {!enoughQuestions && <small>还需 {Math.max(0,(fresh?.required??item.questionCount)-(fresh?.available??eligibleCount))} 个已解锁目标；达到门槛后可无限参加</small>}
          </button>;
        })}</div>
        <div className="challenge-fee"><span><Clock3/>行动不限每日次数；同账号同时只能保留一局未结束的挑战。付费失败或主动放弃不退入场费，免费行动达标并确认结算后获得机密奖池期望值 1/10。</span><button className="econ-primary" disabled={busy||!task||!mode||!(availability[mode.id]?.ready??(eligibleCount>=(mode?.questionCount??Infinity)))||(mode.paid&&balance<mode.entryFee)} onClick={()=>void enter()}>{busy?'正在准备…':mode?.paid?`确认入场 · ${money(mode.entryFee)} 哈弗币`:'开始免费训练'}</button>{mode?.paid&&balance<mode.entryFee&&<small>余额不足</small>}</div>
      </div>
      <section className="challenge-history"><h2>行动记录</h2>{runs.length?runs.map(run=><article key={run.id}><span>{modeLabel(run.tier)} · {new Date(run.settled_at??run.deadline_at).toLocaleDateString('zh-CN')} · 答对 {run.correct_answers ?? run.evaluation?.correctAnswers ?? 0}/{run.question_count ?? 1}</span><b>{run.status==='passed'?'通过':run.status==='failed'?'未通过':run.status==='technical_refund'?'技术退款':run.status==='abandoned'?'已放弃':run.status}</b>{run.reward_item&&<small>{run.reward_item.name}</small>}{run.tier==='free'&&Number(run.reward_coins)>0&&<small>+{money(run.reward_coins??0)} 哈弗币</small>}</article>):<p>暂无行动记录。</p>}</section>
    </>}
    <nav className="econ-shortcuts"><button onClick={()=>onNavigate('/inventory')}>进入仓库</button><button onClick={()=>onNavigate('/shop')}>物资商城</button><button onClick={()=>onNavigate('/profile')}>个人主页</button></nav>
  </main>;
}
