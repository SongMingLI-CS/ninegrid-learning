// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLECTION_CATALOG } from '../shared/catalog';
import { WarehouseScreen } from '../src/components/WarehouseScreen';
import { formatHafverCoins } from '../shared/economy';

const item = COLLECTION_CATALOG[0];
let inventory: any;
let wallet: any;
let elementMethodDescriptors: Record<string, PropertyDescriptor | undefined> | null = null;
const seasons = { seasons: [{ id: 'season-a', title: '春季试验' }] };
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }); }

function serve() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/status') return response({ accounts: true, configured: false, model: 'deepseek-flash' });
    if (url === '/api/auth/csrf') return response({ token: 'test-csrf-token' });
    if (url === '/api/inventory' && (!init?.method || init.method === 'GET')) return response(inventory);
    if (url === '/api/wallet') return response(wallet);
    if (url === '/api/seasons') return response(seasons);
    if (url === '/api/profile') return response({ seasonalCollectibles: [] });
    if (url === '/api/inventory/preferences') return response({ saved: 1 });
    if (url === '/api/inventory/sell') {
      const request = JSON.parse(String(init?.body));
      inventory = { items: [], sales: [{ operation_id: request.operationId, items: [{ name: item.name, quantity: 2, total: item.sellPrice * 2 }], coins: item.sellPrice * 2, created_at: new Date().toISOString() }] };
      wallet = { wallets: [{ currency: 'learning-coin', balance: item.sellPrice * 2 }] };
      return response({ sale: inventory.sales[0], idempotent: false });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
}

describe('independent warehouse page', () => {
  afterEach(() => {
    cleanup(); vi.unstubAllGlobals();
    if (elementMethodDescriptors) {
      for (const [name, descriptor] of Object.entries(elementMethodDescriptors)) {
        if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
        else delete (Element.prototype as any)[name];
      }
      elementMethodDescriptors = null;
    }
  });

  it('separates owned inventory from the 155-item catalog and reports collection by kinds', async () => {
    inventory = { items: [{ item_id: item.id, definition: item, quantity: 2, acquired_at: '2026-10-10T08:00:00Z', sources: [{ seasonId: 'season-a', taskId: 'numpy-lesson' }], is_locked: false, is_showcased: false }], sales: [] };
    wallet = { wallets: [{ currency: 'learning-coin', balance: 50 }] }; serve();
    const onNavigate = vi.fn();
    const { container } = render(<WarehouseScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={onNavigate} />);
    expect(await screen.findByText('行动仓库')).toBeTruthy();
    expect(container.querySelector('.account-feature-navigation')).toBeTruthy();
    expect(container.querySelector('.wh-art img')?.getAttribute('src')).toBe('/assets/catalog/thumbs/small-purple-01.webp');
    fireEvent.click(screen.getByRole('button', { name: `查看${item.name}详情` }));
    expect(container.querySelector('.wh-detail-art .wh-art img')?.getAttribute('src')).toBe('/assets/catalog/items/small-purple-01.webp');
    expect(screen.getByLabelText('仓库统计').textContent).toContain('1 / 155');
    expect(screen.getByText('1 种不同物品')).toBeTruthy();
    const fullCatalogTab = screen.getByRole('tab', { name: /完整图鉴/ });
    fireEvent.mouseDown(fullCatalogTab, { button: 0 });
    fireEvent.click(fullCatalogTab);
    expect(await screen.findByText('收藏图鉴')).toBeTruthy();
    expect(screen.getAllByText('未收集').length).toBeGreaterThan(0);
    expect(screen.getByText('155')).toBeTruthy();
  });

  it('opens the selected item in a compact viewport Sheet', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 800px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    inventory = { items: [{ item_id: item.id, definition: item, quantity: 1, acquired_at: '2026-10-10T08:00:00Z', sources: [], is_locked: false, is_showcased: false }], sales: [] };
    wallet = { wallets: [{ currency: 'learning-coin', balance: 50 }] }; serve();
    render(<WarehouseScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: `查看${item.name}详情` }));
    const sheet = await screen.findByRole('dialog', { name: '藏品详情' });
    expect(within(sheet).getByRole('heading', { name: item.name })).toBeTruthy();
    expect(sheet.textContent).toContain('出售回收价');
  });

  it('uses accessible tabs and comboboxes for warehouse browsing filters', async () => {
    inventory = { items: [], sales: [] };
    wallet = { wallets: [{ currency: 'learning-coin', balance: 0 }] }; serve();
    render(<WarehouseScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    await screen.findByRole('heading', { name: '行动仓库' });
    expect(screen.getByRole('tab', { name: /我的仓库/ }).getAttribute('aria-selected')).toBe('true');
    const fullCatalogTab = screen.getByRole('tab', { name: /完整图鉴/ });
    fireEvent.mouseDown(fullCatalogTab, { button: 0 });
    fireEvent.click(fullCatalogTab);
    expect(fullCatalogTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('收藏图鉴')).toBeTruthy();
    const category = screen.getByRole('combobox', { name: '类别' });
    elementMethodDescriptors = Object.fromEntries(['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'].map(name => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)]));
    Object.defineProperty(Element.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
    Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    Object.defineProperty(Element.prototype, 'releasePointerCapture', { configurable: true, value: () => {} });
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
    fireEvent.pointerDown(category, { button: 0, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('option', { name: '研究样本' }));
    expect(screen.getByRole('combobox', { name: '类别' }).textContent).toContain('研究样本');
    expect(screen.getByRole('tab', { name: /完整图鉴/ })).toBeTruthy();
  });

  it('previews batch recovery value, then updates the account balance and quantity after sale', async () => {
    inventory = { items: [{ item_id: item.id, definition: item, quantity: 2, acquired_at: '2026-10-10T08:00:00Z', sources: [], is_locked: false, is_showcased: false }], sales: [] };
    wallet = { wallets: [{ currency: 'learning-coin', balance: 50 }] }; serve();
    render(<WarehouseScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    const checkbox = await screen.findByRole('checkbox', { name: `选择${item.name}出售` });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /出售已选/ }));
    const dialog = await screen.findByRole('dialog', { name: '确认出售' });
    expect(dialog.textContent).toContain(`${formatHafverCoins(item.sellPrice * 2)} 哈弗币`);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认出售' }));
    expect(await screen.findByText(`已入账 ${formatHafverCoins(item.sellPrice * 2)} 哈弗币。`)).toBeTruthy();
    expect(screen.getByText('仓库尚无藏品')).toBeTruthy();
    expect(screen.getByText(formatHafverCoins(item.sellPrice * 2))).toBeTruthy();
  });

  it('excludes locked collections from the default batch-sale action and recovery total', async () => {
    inventory = { items: [{ item_id: item.id, definition: item, quantity: 2, acquired_at: '2026-10-10T08:00:00Z', sources: [], is_locked: true, is_showcased: false }], sales: [] };
    wallet = { wallets: [{ currency: 'learning-coin', balance: 50 }] }; serve();
    render(<WarehouseScreen account="learner@example.com" onExit={() => {}} onLogout={() => {}} onNavigate={() => {}} />);
    const lockedCheckbox = await screen.findByRole('checkbox', { name: `选择${item.name}出售` });
    expect(lockedCheckbox.hasAttribute('disabled')).toBe(true);
    const saleTotal = screen.getByRole('button', { name: /出售已选 · 0/ });
    expect(saleTotal.hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('仓库统计').textContent).toContain('可出售回收0');
    fireEvent.click(screen.getByRole('button', { name: `查看${item.name}详情` }));
    expect(await screen.findByRole('button', { name: '解除收藏锁定' })).toBeTruthy();
  });
});
