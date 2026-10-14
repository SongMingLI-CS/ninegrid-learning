// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHALLENGES, formatHafverCoins, poolExpectedRecovery, poolTotals } from '../shared/economy';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createProgressForCampaign } from '../src/lib/engine';
import { ChallengesScreen } from '../src/components/ChallengesScreen';

function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }); }

describe('learning challenge screen', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('formats fractional expected recovery as an accurate whole-coin amount', async () => {
    const tiers = Object.entries(CHALLENGES).map(([id, tier]) => ({ id, ...tier, rewardExpectedRecovery: poolExpectedRecovery(tier.pool), poolTotal: poolTotals(tier.pool) }));
    const state = { version: 2, campaign: structuredClone(NUMPY_DEMO_CAMPAIGN), progress: createProgressForCampaign(NUMPY_DEMO_CAMPAIGN), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return response({ accounts: true });
      if (url === '/api/challenges') return response({ tiers });
      if (url === '/api/seasons') return response({ seasons: [{ id: 'season-a', title: 'NumPy', state }] });
      if (url === '/api/wallet') return response({ wallets: [{ currency: 'learning-coin', balance: 1000000 }] });
      if (url === '/api/challenges/history') return response({ challenges: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<ChallengesScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    await screen.findByRole('heading', { name: '学习挑战' });
    expect(screen.queryByText(/金额超出安全范围/)).toBeNull();
    for (const tier of tiers) expect(screen.getByText(`奖励池回收期望 ${formatHafverCoins(Math.round(tier.rewardExpectedRecovery))} 币`)).toBeTruthy();
  });
});
