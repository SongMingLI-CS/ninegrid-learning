// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { completeTask, createProgressForCampaign, markSelfChecked, setEvidence, updateObjective } from '../src/lib/engine';
import { createInitialState, exportState } from '../src/lib/storage';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';

function stubOfflineApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/status') return new Response(JSON.stringify({ configured: false, model: 'deepseek-flash' }), { status: 200 });
    return new Response(JSON.stringify({ error: 'API_KEY_MISSING' }), { status: 503 });
  }));
}

describe('local entry and account feature discoverability', () => {
  beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as Window & { nineGridDesktop?: unknown }).nineGridDesktop; });

  it('lets a new learner choose their own goal before any sample campaign is opened', async () => {
    stubOfflineApi();
    render(<App/>);
    expect(await screen.findByRole('heading', { name: '先设定你自己的学习目标' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始创建我的目标' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Python 入门/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /NumPy 数据准备/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '情报归档行动' })).toBeNull();
    expect(window.localStorage.getItem('ninegrid.learning.v1')).toBeNull();
  });

  it('requires an explicit choice before resuming an old local sample and preserves that archive', async () => {
    stubOfflineApi();
    const legacy = createInitialState();
    window.localStorage.setItem('ninegrid.learning.v1', exportState(legacy));
    render(<App/>);
    expect(await screen.findByRole('heading', { name: '发现本机旧课程' })).toBeTruthy();
    expect(screen.getByText('预置示例课程 · Python')).toBeTruthy();
    expect(screen.getByText('情报归档行动')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续这份本机档案' }));
    expect(await screen.findByRole('heading', { name: '情报归档行动' })).toBeTruthy();
    expect(window.localStorage.getItem('ninegrid.learning.v1')).toContain('情报归档行动');
  });

  it('does not downgrade a failed status request to a healthy local demo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<App/>);
    expect((await screen.findByRole('alert')).textContent).toMatch(/服务状态暂不可用/);
    expect(screen.getByRole('button', { name: '重试连接' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '明确使用本机档案' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '情报归档行动' })).toBeNull();
    expect(window.localStorage.getItem('ninegrid.learning.v1')).toBeNull();
  });

  it('shows account-only product destinations in the main navigation while local mode is active', async () => {
    stubOfflineApi();
    window.sessionStorage.setItem('ninegrid.local-choice', 'sample-python');
    render(<App/>);
    await screen.findByRole('heading', { name: '情报归档行动' });
    expect(document.body.textContent).not.toContain('哈弗币');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getAllByRole('button')).toHaveLength(8);
    for (const name of ['今日学习', '赛季', '学习记录', '复习', '仓库', '商城', '挑战', '个人主页']) {
      expect(within(nav).getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    fireEvent.click(within(nav).getByRole('button', { name: /仓库/ }));
    expect(await screen.findByRole('dialog', { name: '仓库需要账号存档' })).toBeTruthy();
  });

  it('does not silently create a NumPy demo season for a new authenticated account', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET'; requests.push({ url, method });
      if (url === '/api/status') return new Response(JSON.stringify({ configured: false, model: 'deepseek-flash', accounts: true, accountAvailability: 'enabled' }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'new-user', email: 'learner@example.test', createdAt: new Date().toISOString() } }), { status: 200 });
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [], currentSeasonId: null, selectionRevision: 0 }), { status: 200 });
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 404 });
    }));
    render(<App/>);
    expect(await screen.findByRole('heading', { name: '创建你的第一个学习赛季' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始设定学习目标' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'NumPy 数据准备行动' })).toBeNull();
    expect(requests.some(request => request.url === '/api/seasons' && request.method === 'POST')).toBe(false);
  });

  it('allows a fully loaded account with no season to complete the safe desktop exit', async () => {
    let requestClose: (() => void) | undefined;
    const confirmClose = vi.fn(async () => true);
    Object.defineProperty(window, 'nineGridDesktop', {
      configurable: true,
      value: {
        onRequestClose: (handler: () => void) => { requestClose = handler; return () => undefined; },
        confirmClose,
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: true, accounts: true, model: 'deepseek-flash', accountAvailability: 'enabled' }));
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'empty-account', email: 'empty@example.test', createdAt: new Date().toISOString() } }));
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [], currentSeasonId: null, selectionRevision: 0 }));
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [] }));
      if (url.startsWith('/api/diagnostics?')) return new Response(JSON.stringify({ session: null }));
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 404 });
    }));

    render(<App/>);
    expect(await screen.findByRole('heading', { name: '创建你的第一个学习赛季' })).toBeTruthy();
    await waitFor(() => expect(requestClose).toBeTypeOf('function'));
    requestClose!();
    fireEvent.click(await screen.findByRole('button', { name: '保存完成后退出' }));

    await waitFor(() => expect(confirmClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    delete (window as Window & { nineGridDesktop?: unknown }).nineGridDesktop;
  });

  it('does not block safe exit when the season is loaded but optional wallet hydration fails', async () => {
    let requestClose: (() => void) | undefined;
    const confirmClose = vi.fn(async () => true);
    Object.defineProperty(window, 'nineGridDesktop', {
      configurable: true,
      value: {
        onRequestClose: (handler: () => void) => { requestClose = handler; return () => undefined; },
        confirmClose,
      },
    });
    const state = createInitialState();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: true, accounts: true, model: 'deepseek-flash', accountAvailability: 'enabled' }));
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'wallet-down-user', email: 'wallet@example.test', createdAt: new Date().toISOString() } }));
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [{ id: 'season-1', revision: 3, title: state.campaign.title, state, lifecycleStatus: 'active' }], currentSeasonId: 'season-1', selectionRevision: 1 }));
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [] }));
      if (url === '/api/wallet' || url === '/api/inventory') return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 });
      if (url === '/api/seasons/season-1') return new Response(JSON.stringify({ season: { id: 'season-1', revision: 4, state } }));
      if (url.startsWith('/api/diagnostics?')) return new Response(JSON.stringify({ session: null }));
      return new Response('{}', { status: 404 });
    }));

    render(<App/>);
    expect(await screen.findByRole('heading', { name: '情报归档行动' })).toBeTruthy();
    await waitFor(() => expect(requestClose).toBeTypeOf('function'));
    requestClose!();
    fireEvent.click(await screen.findByRole('button', { name: '保存完成后退出' }));

    await waitFor(() => expect(confirmClose).toHaveBeenCalledTimes(1));
    delete (window as Window & { nineGridDesktop?: unknown }).nineGridDesktop;
  });

  it('restores a saved first-course draft after login even before any season has been activated', async () => {
    const goal = '学习 NumPy 二维数组的 shape、dtype 与 axis 求和';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: true, accounts: true, model: 'deepseek-flash', accountAvailability: 'enabled' }));
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'draft-owner', email: 'draft@example.test', createdAt: new Date().toISOString() } }));
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [], currentSeasonId: null, selectionRevision: 0 }));
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [{ id: 'first-course', revision: 4, rulesVersion: 4, status: 'failed', input: { goal, level: '了解一些，需要补基础', days: 1, dailyMinutes: 30, ultimateReward: '解释数组的形状与轴' }, batches: {}, progress: { completedTasks: 0, totalTasks: 2 } }] }));
      if (url.startsWith('/api/diagnostics?')) return new Response(JSON.stringify({ session: null }));
      return new Response('{}', { status: 404 });
    }));
    render(<App/>);
    await screen.findByRole('heading', { name: '创建你的第一个学习赛季' });
    fireEvent.click(await screen.findByRole('button', { name: '恢复生成草稿' }));
    expect((screen.getByPlaceholderText(/例如：我刚学 NumPy/) as HTMLTextAreaElement).value).toBe(goal);
    expect((screen.getByRole('spinbutton', { name: /赛季长度/ }) as HTMLInputElement).value).toBe('1');
    expect((screen.getByRole('spinbutton', { name: /每天预算/ }) as HTMLInputElement).value).toBe('30');
    expect(screen.getByText(/服务器草稿已恢复/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /继续生成/ })).toBeTruthy();
    expect(calls.some(url => url.startsWith('/api/generation/'))).toBe(false);
  });

  it('does not offer a cancelled self-assessment draft as a recoverable course', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: true, accounts: true, model: 'deepseek-flash', accountAvailability: 'enabled' }));
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'diagnostic-owner', email: 'learner@example.test', createdAt: new Date().toISOString() } }));
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [], currentSeasonId: null, selectionRevision: 0 }));
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [{
        id: 'cancelled-self-assessment', revision: 2, rulesVersion: 4, status: 'cancelled',
        input: { goal: '学习 NumPy shape', level: '了解一些，需要补基础', days: 1, dailyMinutes: 30, ultimateReward: '解释 shape' },
        batches: {}, progress: { basicSelfAssessment: { answer: '已有 Python 基础' } },
      }] }));
      if (url.startsWith('/api/diagnostics?')) return new Response(JSON.stringify({ session: null }));
      return new Response('{}', { status: 404 });
    }));
    render(<App/>);
    await screen.findByRole('heading', { name: '创建你的第一个学习赛季' });
    expect(screen.queryByRole('button', { name: '恢复生成草稿' })).toBeNull();
    expect(screen.queryByText(/服务器有可恢复的课程草稿/)).toBeNull();
  });

  it('offers optional goal-level quick diagnostics and saves the self-report before generation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: false, model: 'deepseek-flash', accounts: true, accountAvailability: 'enabled' }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'diagnostic-user', email: 'learner@example.test', createdAt: new Date().toISOString() } }), { status: 200 });
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [], currentSeasonId: null, selectionRevision: 0 }), { status: 200 });
      if (url.startsWith('/api/diagnostics?')) return new Response(JSON.stringify({ session: null }), { status: 200 });
      if (url === '/api/generation-drafts' && init?.method === 'POST') return new Response(JSON.stringify({ draft: { id: 'diagnostic-draft', revision: 1 } }), { status: 201 });
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [] }), { status: 200 });
      if (url === '/api/generation-drafts/diagnostic-draft' && init?.method === 'PATCH') { const revision=JSON.parse(String(init.body)).revision; return new Response(JSON.stringify({ draft: { id: 'diagnostic-draft', revision: revision + 1 } }), { status: 200 }); }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 404 });
    }));
    render(<App/>);
    await screen.findByRole('heading', { name: '创建你的第一个学习赛季' });
    fireEvent.click(screen.getByRole('button', { name: '开始设定学习目标' }));
    const goal = '学习 NumPy 数组索引并完成一个数据筛选小项目';
    fireEvent.change(screen.getByPlaceholderText(/例如：我刚学 NumPy/), { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: '开始基础自评' }));
    await screen.findAllByRole('button', { name: '能解释' });
    fireEvent.click(screen.getAllByRole('button', { name: '能解释' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: '1 自评回答' }), { target: { value: '我知道数组用整数位置选出一行。' } });
    expect(window.localStorage.getItem('ninegrid.quick-diagnostic.v1.diagnostic-user')).toContain(goal);
    const saved = JSON.parse(window.localStorage.getItem('ninegrid.quick-diagnostic.v1.diagnostic-user') ?? '{}');
    expect(saved.goal).toBe(goal);
    expect(saved.answers['diagnostic-concept']).toMatchObject({ confidence: 'known', response: '我知道数组用整数位置选出一行。' });
  });

  it('starts a new diagnostic idempotency attempt when retry settings differ from the failed attempt', async () => {
    const goal = '学习 NumPy 布尔索引并完成测量数据汇总函数';
    const failedInput = { goal, level: '零基础', days: 28, dailyMinutes: 45, desiredArtifact: '旧交付目标', language: 'mixed' };
    let submitted: { idempotencyKey: string; input: typeof failedInput } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: true, model: 'deepseek-flash', accounts: true, accountAvailability: 'enabled' }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'retry-user', email: 'retry@example.test', createdAt: new Date().toISOString() } }), { status: 200 });
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [], currentSeasonId: null, selectionRevision: 0 }), { status: 200 });
      if (url.startsWith('/api/diagnostics?')) return new Response(JSON.stringify({ session: { id: 'failed-session', idempotencyKey: 'failed-idempotency-key', revision: 3, rulesVersion: 'learning-loop-1', status: 'failed', input: failedInput, questions: [], answers: {}, result: null } }), { status: 200 });
      if (url === '/api/diagnostics' && init?.method === 'POST') {
        const requestBody = JSON.parse(String(init.body)) as NonNullable<typeof submitted>;
        submitted = requestBody;
        return new Response(JSON.stringify({ session: { id: 'new-session', idempotencyKey: requestBody.idempotencyKey, revision: 1, rulesVersion: 'learning-loop-1', status: 'answering', input: requestBody.input, questions: [], answers: {}, result: null } }), { status: 201 });
      }
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [] }), { status: 200 });
      if (url === '/api/wallet') return new Response(JSON.stringify({ wallets: [], ledger: [] }), { status: 200 });
      if (url === '/api/inventory') return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 404 });
    }));
    render(<App/>);
    await screen.findByRole('heading', { name: '创建你的第一个学习赛季' });
    fireEvent.click(screen.getByRole('button', { name: '开始设定学习目标' }));
    fireEvent.change(screen.getByPlaceholderText(/例如：我刚学 NumPy/), { target: { value: goal } });
    await screen.findByText('上次请求失败；失败记录保留。');
    fireEvent.change(screen.getByRole('combobox', { name: /当前基础/ }), { target: { value: '已有基础，想进阶' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /赛季长度/ }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /每天预算/ }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('textbox', { name: /最终交付成果/ }), { target: { value: '一个可测试的 NumPy 筛选与汇总函数' } });
    fireEvent.click(screen.getByRole('button', { name: '快速摸底' }));
    fireEvent.click(screen.getByRole('button', { name: '重试快速摸底' }));
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted!.idempotencyKey).not.toBe('failed-idempotency-key');
    expect(submitted!.input).toMatchObject({ goal, level: '已有基础，想进阶', days: 7, dailyMinutes: 30, desiredArtifact: '一个可测试的 NumPy 筛选与汇总函数' });
  });

  it('labels a server-backed demo season and its saves as account storage', async () => {
    const numpyState = { ...createInitialState(), campaign: structuredClone(NUMPY_DEMO_CAMPAIGN), progress: createProgressForCampaign(NUMPY_DEMO_CAMPAIGN) };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/status') return new Response(JSON.stringify({ configured: false, model: 'deepseek-flash', accounts: true, accountAvailability: 'enabled', branch: 'codex/learning-loop-fixes', commit: 'ce51c842b267' }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'account-123', email: 'learner@example.test', createdAt: new Date().toISOString() } }), { status: 200 });
      if (url === '/api/seasons') return new Response(JSON.stringify({ seasons: [{ id: 'season-123', revision: 1, title: NUMPY_DEMO_CAMPAIGN.title, state: numpyState, lifecycleStatus: 'active' }], currentSeasonId: 'season-123', selectionRevision: 1 }), { status: 200 });
      if (url === '/api/generation-drafts') return new Response(JSON.stringify({ drafts: [] }), { status: 200 });
      if (url === '/api/wallet') return new Response(JSON.stringify({ wallets: [{ currency: 'learning-coin', balance: 0 }], ledger: [] }), { status: 200 });
      if (url === '/api/inventory') return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 404 });
    }));
    render(<App/>);
    expect(await screen.findByText('账号赛季 · 预置示例')).toBeTruthy();
    expect(screen.getByText('可选示例')).toBeTruthy();
    expect(screen.getAllByText('服务器已同步').length).toBeGreaterThan(0);
    expect(screen.getByText('服务器为主存档 · 本机恢复缓存未加密')).toBeTruthy();
    expect(screen.queryByText('只保存在此设备')).toBeNull();
    expect(screen.queryByText('本机自动保存')).toBeNull();
    expect(screen.queryByText('浏览器本地存储；未启用加密')).toBeNull();
  });
});
function openFirstNumpyTask() {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.mission-row')).find(button => button.textContent?.includes('校准仪表：读懂 shape 与 axis'));
  if (!row) throw new Error('NumPy mainline task row was not rendered');
  fireEvent.click(row);
}

describe('NumPy learning flow in the interface', () => {
  beforeEach(() => { window.localStorage.clear(); window.sessionStorage.setItem('ninegrid.local-choice', 'sample-numpy'); stubOfflineApi(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('starts with a beginner-aware NumPy blueprint, records a completion, reloads it, and switches goals', async () => {
    const view = render(<App/>);
    expect(await screen.findByRole('heading', { name: 'NumPy 数据准备行动' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '赛季' }));
    openFirstNumpyTask();
    expect(await screen.findByRole('heading', { name: '校准仪表：读懂 shape 与 axis' })).toBeTruthy();
    expect(screen.getByText(/shape 是每个维度的长度/)).toBeTruthy();
    expect(screen.queryByText('参考答案已出现在教学示例中')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开中文辅助' }));
    expect(screen.getByText('shape')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}').progress['numpy-read-shape'].completedObjectives).toEqual(['numpy-read-shape-outcome']));
    const evidence = '我创建了一个 3×2 ndarray，预测 axis=1 会得到三个值，运行后核对 shape 和结果。';
    fireEvent.change(screen.getByRole('textbox', { name: '学习答案与成果' }), { target: { value: evidence } });
    fireEvent.click(screen.getByRole('button', { name: '我已独立完成 · 自评' }));
    expect(screen.getAllByRole('status').map(node => node.textContent).join(' ')).toContain('自行完成记录');
    fireEvent.click(screen.getByRole('button', { name: '结算任务与奖励' }));
    await waitFor(() => expect(screen.getAllByRole('status').map(node => node.textContent).join(' ')).toContain('成果已保存'));
    expect(window.localStorage.getItem('ninegrid.learning.v1')).toContain(evidence);
    await waitFor(() => expect(window.localStorage.getItem('ninegrid.learning.v1')).toContain(evidence));
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '今日学习' }));
    expect(await screen.findByText(/实时推荐/)).toBeTruthy();
    expect(screen.getByText('建立测量样本：从 Python 列表创建数组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始推荐任务建立测量样本：从 Python 列表创建数组' }));
    expect(await screen.findByRole('heading', { name: '建立测量样本：从 Python 列表创建数组' })).toBeTruthy();

    view.unmount();
    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '赛季' }));
    openFirstNumpyTask();
    expect((await screen.findByRole('textbox', { name: '学习答案与成果' }) as HTMLTextAreaElement).value).toBe(evidence);
    const switcher = screen.getByRole('combobox', { name: '切换学习目标' });
    fireEvent.change(switcher, { target: { value: 'python-intelligence' } });
    await screen.findByRole('heading', { name: '情报归档行动' });
    fireEvent.change(screen.getByRole('combobox', { name: '切换学习目标' }), { target: { value: 'numpy-data-ops-v3' } });
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    const restored = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
    expect(restored.campaign.id).toBe('numpy-data-ops-v3');
    expect(restored.progress['numpy-read-shape'].evidence).toBe(evidence);
  });

  it('explains full mainline completion and separates optional branch task counts', async () => {
    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '赛季' }));
    expect(screen.getByText(/主线\s+0\s*\/\s*15\s*项完成 · 全部\s+24\s*项 · 支线自愿/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /主线 · 主线 · 数组构造、形状与数据类型/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /支线 · 支线 · 应用探索/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起已完成' })).toBeTruthy();
  });

  it('allows a self-completed task to keep its evidence and upgrade to AI verification once', async () => {
    let evaluationCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/status') return new Response(JSON.stringify({ configured: false, model: 'deepseek-flash' }), { status: 200 });
      if (String(input) === '/api/evaluate') {
        evaluationCalls += 1;
        const evaluation = evaluationCalls === 1 ? { passed: false, score: 55, feedback: '请补充实际输出。', gaps: ['缺少运行结果'], nextStep: '补充输出后重试' } : { passed: true, score: 92, feedback: '预测和实测一致。', gaps: [], nextStep: '继续' };
        return new Response(JSON.stringify({ verification: 'ai', evaluation }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'API_KEY_MISSING' }), { status: 503 });
    }));
    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '赛季' }));
    openFirstNumpyTask();
    const evidence = '我创建了一个 3×2 ndarray，预测 axis=1 会得到三个值，运行后核对 shape 和结果。';
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.change(screen.getByRole('textbox', { name: '学习答案与成果' }), { target: { value: evidence } });
    fireEvent.click(screen.getByRole('button', { name: '我已独立完成 · 自评' }));
    fireEvent.click(screen.getByRole('button', { name: '结算任务与奖励' }));
    await waitFor(() => expect(screen.getAllByRole('status').map(node => node.textContent).join(' ')).toContain('成果已保存'));
    const before = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
    const beforeCoins = before.wallet.balance;
    const beforeMissions = before.rewardLedger.filter((entry: { kind: string }) => entry.kind === 'mission').length;
    fireEvent.click(screen.getByRole('button', { name: '基于原证据请求 AI 核验' }));
    expect(await screen.findAllByText('请补充实际输出。')).toBeTruthy();
    const afterFailure = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
    expect(afterFailure.progress['numpy-read-shape']).toMatchObject({ status: 'completed', verification: 'self', evidence });
    fireEvent.change(screen.getByRole('textbox', { name: '补充证据' }), { target: { value: '补充实际输出：shape=(3, 2)，axis=1 的结果含 3 个均值；运行日志与预测完全一致。' } });
    fireEvent.click(screen.getByRole('button', { name: '基于原证据请求 AI 核验' }));
    expect(await screen.findAllByText('预测和实测一致。')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '学习答案与成果' }) as HTMLTextAreaElement).value).toBe(evidence);
    fireEvent.click(screen.getByRole('button', { name: '升级为 AI 验证' }));
    await screen.findByText(/成果已保存 · AI 已核验/);
    expect(screen.queryByText(/自动保存失败/)).toBeNull();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}').progress['numpy-read-shape'].verification).toBe('ai'));
    const after = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
    expect(after.progress['numpy-read-shape'].status).toBe('completed');
    expect(after.progress['numpy-read-shape'].evidence).toBe(evidence);
    expect(after.progress['numpy-read-shape'].supplementalEvidence).toContain('shape=(3, 2)');
    expect(after.attempts['numpy-read-shape'].at(-1).answer).toContain('补充证据');
    expect(after.wallet.balance).toBe(beforeCoins);
    expect(after.rewardLedger.filter((entry: { kind: string }) => entry.kind === 'mission')).toHaveLength(beforeMissions);
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '赛季' }));
    expect(screen.getByRole('textbox', { name: 'shape解释成果' })).toBeTruthy();
  });

  it('opens the scheduled review question from its Today Schedule entry', async () => {
    let state = createInitialState();
    state.campaign = NUMPY_DEMO_CAMPAIGN;
    state.progress = createProgressForCampaign(NUMPY_DEMO_CAMPAIGN);
    const target = NUMPY_DEMO_CAMPAIGN.stages[0].tasks[0];
    const old = new Date(Date.now() - 3 * 86400000);
    let prepared = updateObjective(state, target.id, target.objectives[0].id);
    prepared = setEvidence(prepared, target.id, '我预测 shape 会保留行列维度，并实际运行数组检查输出。');
    prepared = markSelfChecked(prepared, target.id);
    prepared = completeTask(prepared, target.id, 'self', old);
    window.localStorage.setItem('ninegrid.learning.v1', exportState(prepared));

    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '今日学习' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始复习校准仪表：读懂 shape 与 axis' }));
    expect(await screen.findByRole('heading', { name: '一个 shape=(2, 3) 的数组做 sum(axis=0)，结果有几个数？' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '闭卷回忆答案' })).toBeTruthy();
  });

  it('saves the second due review from today only to that task card', async () => {
    let state = createInitialState();
    state.campaign = NUMPY_DEMO_CAMPAIGN;
    state.progress = createProgressForCampaign(NUMPY_DEMO_CAMPAIGN);
    const [first, second] = NUMPY_DEMO_CAMPAIGN.stages[0].tasks;
    const old = new Date(Date.now() - 3 * 86400000);
    for (const item of [first, second]) {
      state.progress[item.id] = { completedObjectives: item.objectives.map(objective => objective.id), evidence: '我写出预测并运行程序，核对输出后解释了每个维度的含义。', status: 'active' };
      state = completeTask(state, item.id, 'self', old);
    }
    window.localStorage.setItem('ninegrid.learning.v1', exportState(state));

    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '今日学习' }));
    fireEvent.click(await screen.findByRole('button', { name: `开始复习${second.title}` }));
    const secondQuestion = screen.getByRole('heading', { name: second.recallQuestion });
    expect(secondQuestion).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '闭卷回忆答案' }), { target: { value: 'shape 描述数组每一维长度；axis=0 沿行方向汇总，所以每列留下一个值。' } });
    fireEvent.click(screen.getByRole('button', { name: '锁定答案并核对' }));
    fireEvent.click(screen.getByRole('button', { name: '保存回答并安排下次复习' }));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
      expect(saved.reviews.find((card: { taskId: string }) => card.taskId === second.id).history).toHaveLength(1);
      expect(saved.reviews.find((card: { taskId: string }) => card.taskId === first.id).history).toHaveLength(0);
    });
  });

  it('runs a short mastery diagnostic instead of silently removing a branch', async () => {
    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '今日学习' }));
    fireEvent.click(screen.getByRole('button', { name: '这部分已经会了' }));
    expect(await screen.findByText('两分钟掌握诊断')).toBeTruthy();
    const diagnostic = 'axis=0 输出每列一个结果，所以这个数组会保留 3 个数；我能说明原因。';
    fireEvent.change(screen.getByRole('textbox', { name: '两分钟诊断回答' }), { target: { value: diagnostic } });
    fireEvent.click(screen.getByRole('button', { name: '我达到标准 · 记录诊断通关' }));
    expect(screen.getAllByRole('status').map(node => node.textContent).join(' ')).toContain('诊断通过 · 已记录掌握');
    expect(screen.getByText('诊断通过 · 已记录掌握')).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
    expect(saved.progress['numpy-read-shape'].status).toBe('completed');
    expect(saved.progress['numpy-read-shape'].verification).toBe('self');
    expect(saved.progress['numpy-v3-foundation-m15'].status).toBe('idle');
    expect(saved.campaign.stages[0].gateTaskIds).toEqual(['numpy-v3-foundation-m15']);
    expect(saved.progress['numpy-read-shape'].evidence).toBe(diagnostic);
    expect(saved.attempts['numpy-read-shape'].at(-1)).toMatchObject({ answer: diagnostic, verification: 'none', passed: true });
    expect(saved.rewardLedger.find((entry: { kind: string }) => entry.kind === 'mission').reward.items).toEqual([]);
  });
});
