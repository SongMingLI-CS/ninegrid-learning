// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHALLENGES, FREE_CHALLENGE_REWARD_COINS, formatHafverCoins, poolExpectedRecovery, poolTotals } from '../shared/economy';
import { CHALLENGE_MODE_SETTINGS } from '../shared/challengeRules';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createProgressForCampaign } from '../src/lib/engine';
import { ChallengesScreen } from '../src/components/ChallengesScreen';

function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }); }

describe('learning challenge screen', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('formats fractional expected recovery as an accurate whole-coin amount', async () => {
    const tiers = Object.entries(CHALLENGE_MODE_SETTINGS).map(([id, setting]) => id === 'free'
      ? ({ id, ...setting, pool: [], rewardCoins: FREE_CHALLENGE_REWARD_COINS, rewardExpectedRecovery: FREE_CHALLENGE_REWARD_COINS, poolTotal: 0 })
      : ({ id, ...setting, ...CHALLENGES[id as keyof typeof CHALLENGES], rewardExpectedRecovery: poolExpectedRecovery(CHALLENGES[id as keyof typeof CHALLENGES].pool), poolTotal: poolTotals(CHALLENGES[id as keyof typeof CHALLENGES].pool) }));
    const state = { version: 2, campaign: structuredClone(NUMPY_DEMO_CAMPAIGN), progress: createProgressForCampaign(NUMPY_DEMO_CAMPAIGN), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return response({ accounts: true });
      if (url === '/api/challenges') return response({ tiers });
      if (url === '/api/seasons') return response({ seasons: [{ id: 'season-a', title: 'NumPy', state }] });
      if (url === '/api/wallet') return response({ wallets: [{ currency: 'learning-coin', balance: 1000000 }] });
      if (url === '/api/challenges/history') return response({ challenges: [], kdStats: {
        overall: { correctAnswers: 16, settledRounds: 5, kd: 3.2 },
        overallPaid: { correctAnswers: 14, settledRounds: 4, kd: 3.5 },
        free: { correctAnswers: 2, settledRounds: 1, kd: 2 },
        ordinary: { correctAnswers: 9, settledRounds: 2, kd: 4.5 },
        confidential: { correctAnswers: 3, settledRounds: 1, kd: 3 },
        'top-secret': { correctAnswers: 2, settledRounds: 1, kd: 2 },
      } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<ChallengesScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    await screen.findByRole('heading', { name: '赛季行动' });
    const kd = document.querySelector('.challenge-kd') as HTMLElement;
    expect(within(kd).getByText('总行动 KD')).toBeTruthy();
    expect(within(kd).getByText('付费行动 KD')).toBeTruthy();
    expect(within(kd).getByText('3.20')).toBeTruthy();
    expect(screen.queryByText(/金额超出安全范围/)).toBeNull();
    for (const tier of tiers.filter((item: any) => item.paid)) expect(screen.getByText(`奖励池回收期望 ${formatHafverCoins(Math.round(tier.rewardExpectedRecovery))} 币`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`固定获得 ${formatHafverCoins(FREE_CHALLENGE_REWARD_COINS)} 哈弗币`))).toBeTruthy();
  });

  it('shows the server-fixed criteria before a challenge answer is submitted', async () => {
    const tiers = Object.entries(CHALLENGE_MODE_SETTINGS).map(([id, setting]) => id === 'free'
      ? ({ id, ...setting, pool: [], rewardCoins: FREE_CHALLENGE_REWARD_COINS, rewardExpectedRecovery: FREE_CHALLENGE_REWARD_COINS, poolTotal: 0 })
      : ({ id, ...setting, ...CHALLENGES[id as keyof typeof CHALLENGES], rewardExpectedRecovery: poolExpectedRecovery(CHALLENGES[id as keyof typeof CHALLENGES].pool), poolTotal: poolTotals(CHALLENGES[id as keyof typeof CHALLENGES].pool) }));
    const state = { version: 2, campaign: structuredClone(NUMPY_DEMO_CAMPAIGN), progress: createProgressForCampaign(NUMPY_DEMO_CAMPAIGN), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [] };
    const question = { id: 'campaign:task:objective:r1', taskId: 'task', taskTitle: '概念练习', objectiveId: 'objective', prompt: '在新情境中应用数组索引。', requiredCriteria: [{ id: 'objective', text: '正确解释索引结果。' }, { id: 'challenge-top-secret-1-1', text: '检查一个边界条件。' }], hints: [], lessonRevision: 1, difficulty: '综合迁移与边界验证' };
    const run = { id: '00000000-0000-4000-8000-000000000099', season_id: 'season-a', task_id: 'task', tier: 'top-secret', status: 'active', entry_fee: 600000, prompt: '绝密行动', questions: [question], answers: [], question_count: 15, pass_threshold: 12, deadline_at: new Date(Date.now() + 30 * 60_000).toISOString() };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return response({ accounts: true });
      if (url === '/api/challenges') return response({ tiers });
      if (url === '/api/seasons') return response({ seasons: [{ id: 'season-a', title: 'NumPy', state }] });
      if (url === '/api/wallet') return response({ wallets: [{ currency: 'learning-coin', balance: 1000000 }] });
      if (url === '/api/challenges/history') return response({ challenges: [run] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<ChallengesScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    await screen.findByRole('heading', { name: '绝密行动' });
    expect(screen.getByText('在新情境中应用数组索引。')).toBeTruthy();
    expect(screen.getByText('检查一个边界条件。')).toBeTruthy();
  });
});
