// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryScreen } from '../src/components/InventoryScreen';
import { createInitialState } from '../src/lib/storage';

const firstDate = '2026-10-01T08:00:00Z';
const secondDate = '2026-10-02T09:00:00Z';
const definition = { itemId: 'compass', name: '方向罗盘', description: '记录探索方向的原创收藏。', rarity: 'rare', icon: '◇' };
const inventory = { items: [
  { item_id: 'compass', definition, quantity: 3, acquired_at: firstDate, sources: [
    { seasonId: 's1', taskId: 't1', acquiredAt: firstDate },
    { seasonId: 's2', taskId: 't2', acquiredAt: secondDate },
  ] },
  { item_id: 'badge', definition: { itemId: 'badge', name: '能力徽章', description: '完成行动的印记。', rarity: 'legendary', icon: '⬡' }, quantity: 1, acquired_at: secondDate, sources: [{ seasonId: 's2', taskId: 't2', acquiredAt: secondDate }] },
] };
const wallet = { wallets: [{ currency: 'learning-coin', balance: 120 }, { currency: '探索券', balance: 0 }], ledger: [
  { id: 'r1', season_id: 's1', task_id: 't1', kind: 'mission', reward: { xp: 20, coins: 5, items: [{ ...definition, quantity: 2 }] }, created_at: firstDate },
  { id: 'r2', season_id: 's2', task_id: 't2', kind: 'review', reward: { xp: 10, coins: -2, items: [] }, created_at: secondDate },
] };
const state = createInitialState();
state.campaign.stages[0].tasks[0].id = 't1';
state.campaign.stages[0].tasks[0].title = '校准方向';
const seasons = [{ id: 's1', title: '探索赛季', state }, { id: 's2', title: '进阶赛季' }];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function serve(items = inventory, balances = wallet) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.credentials).toBe('same-origin');
    expect(init?.signal).toBeTruthy();
    if (String(input) === '/api/wallet') return respond(balances);
    if (String(input) === '/api/inventory') return respond(items);
    throw new Error(`Unexpected request: ${String(input)}`);
  }));
}

describe('InventoryScreen', () => {
  beforeEach(() => serve());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads authenticated balances, quantities, rarity and named season sources', async () => {
    render(<InventoryScreen seasons={seasons} />);
    expect(screen.getByRole('status').textContent).toContain('加载');
    const balances = await screen.findByRole('region', { name: '账户余额' });
    expect(balances.textContent).toContain('120');
    expect(balances.textContent).toContain('探索券');
    expect(balances.textContent).toContain('0');
    const card = screen.getByRole('button', { name: '查看方向罗盘详情' });
    expect(card.textContent).toContain('持有 3');
    expect(card.textContent).toContain('稀有');
    expect(card.textContent).toContain('探索赛季');
    expect(card.textContent).toContain('进阶赛季');
  });

  it('filters multi-source items and history by season without changing account totals', async () => {
    render(<InventoryScreen seasons={seasons} />);
    await screen.findByRole('button', { name: '查看方向罗盘详情' });
    fireEvent.change(screen.getByRole('combobox', { name: '来源赛季' }), { target: { value: 's1' } });
    expect(screen.getByRole('button', { name: '查看方向罗盘详情' }).textContent).toContain('持有 3');
    expect(screen.queryByRole('button', { name: '查看能力徽章详情' })).toBeNull();
    const history = screen.getByRole('region', { name: '奖励记录' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(1);
    expect(history.textContent).toContain('校准方向');
    expect(screen.getByRole('region', { name: '账户余额' }).textContent).toContain('120');
    fireEvent.change(screen.getByRole('combobox', { name: '稀有度' }), { target: { value: 'legendary' } });
    expect(screen.getByText('没有符合筛选条件的收藏。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('button', { name: '查看能力徽章详情' })).toBeTruthy();
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);
  });

  it('opens accessible details with all acquisition dates and provenance, and closes with Escape', async () => {
    render(<InventoryScreen seasons={seasons} />);
    const card = await screen.findByRole('button', { name: '查看方向罗盘详情' });
    fireEvent.click(card);
    const details = screen.getByRole('region', { name: '方向罗盘详情' });
    expect(details.textContent).toContain(definition.description);
    expect(details.textContent).toContain('校准方向');
    expect(details.textContent).toContain('t2');
    expect(details.querySelectorAll(`time[datetime="${firstDate}"]`)).toHaveLength(2);
    expect(details.querySelector(`time[datetime="${secondDate}"]`)).toBeTruthy();
    expect(document.activeElement).toBe(details);
    fireEvent.keyDown(details, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '方向罗盘详情' })).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it('shows newest rewards first, signed amounts, item quantities and timestamps', async () => {
    render(<InventoryScreen seasons={seasons} />);
    const history = await screen.findByRole('region', { name: '奖励记录' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('复习');
    expect(rows[0].textContent).toContain('−2（2） 哈弗币');
    expect(rows[1].textContent).toContain('+20 XP');
    expect(rows[1].textContent).toContain('+5（5） 哈弗币');
    expect(rows[1].textContent).toContain('方向罗盘 ×2');
    expect(rows[0].querySelector('time')?.dateTime).toBe(secondDate);
  });

  it('works without season props and derives filter choices from API provenance', async () => {
    render(<InventoryScreen />);
    await screen.findByRole('button', { name: '查看方向罗盘详情' });
    expect(screen.getByRole('option', { name: '赛季 s1' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '来源赛季' }), { target: { value: 's1' } });
    expect(screen.queryByRole('button', { name: '查看能力徽章详情' })).toBeNull();
  });

  it('shows empty inventory, wallet and history states', async () => {
    serve({ items: [] }, { wallets: [], ledger: [] });
    render(<InventoryScreen />);
    expect(await screen.findByText('还没有收藏。完成学习任务后，在这里查看获得的物品。')).toBeTruthy();
    expect(screen.getByText('暂无余额记录。')).toBeTruthy();
    expect(screen.getByText('暂无奖励记录。')).toBeTruthy();
  });

  it.each(['/api/wallet', '/api/inventory'])('offers retry after %s fails and then displays fresh data', async failedPath => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === failedPath ? respond({ error: 'failure' }, 503) : respond(String(input) === '/api/wallet' ? wallet : inventory)));
    render(<InventoryScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain('503');
    expect(screen.queryByRole('button', { name: '查看方向罗盘详情' })).toBeNull();
    serve();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: '查看方向罗盘详情' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers retry for a network error or invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<InventoryScreen />);
    await screen.findByRole('alert');
    vi.stubGlobal('fetch', vi.fn(async () => respond({})));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect((await screen.findByRole('alert')).textContent).toContain('格式');
  });

  it('aborts old account requests and ignores late responses after a keyed account switch', async () => {
    const pending: { signal: AbortSignal; resolve: (response: Response) => void; path: string }[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init: RequestInit) => new Promise<Response>(resolve => pending.push({ signal: init.signal as AbortSignal, resolve, path: String(input) }))));
    const view = render(<InventoryScreen key="old-account" />);
    expect(pending).toHaveLength(2);
    serve({ items: [] }, { wallets: [{ currency: 'learning-coin', balance: 7 }], ledger: [] });
    view.rerender(<InventoryScreen key="new-account" />);
    expect(pending.every(request => request.signal.aborted)).toBe(true);
    await screen.findByText('还没有收藏。完成学习任务后，在这里查看获得的物品。');
    await act(async () => { pending.forEach(request => request.resolve(respond(request.path === '/api/wallet' ? wallet : inventory))); });
    expect(screen.queryByRole('button', { name: '查看方向罗盘详情' })).toBeNull();
    expect(screen.getByRole('region', { name: '账户余额' }).textContent).toContain('7');
  });
});
