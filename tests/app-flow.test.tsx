// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

function stubOfflineApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/status') return new Response(JSON.stringify({ configured: false, model: 'deepseek-flash' }), { status: 200 });
    return new Response(JSON.stringify({ error: 'API_KEY_MISSING' }), { status: 503 });
  }));
}
function openFirstNumpyTask() {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.mission-row')).find(button => button.textContent?.includes('校准仪表：读懂 shape 与 axis'));
  if (!row) throw new Error('NumPy mainline task row was not rendered');
  fireEvent.click(row);
}

describe('NumPy learning flow in the interface', () => {
  beforeEach(() => { window.localStorage.clear(); stubOfflineApi(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('starts with a beginner-aware NumPy blueprint, records a completion, reloads it, and switches goals', async () => {
    const view = render(<App/>);
    expect(await screen.findByRole('heading', { name: 'NumPy 数据准备行动' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '课程总览' }));
    openFirstNumpyTask();
    expect(await screen.findByRole('heading', { name: '校准仪表：读懂 shape 与 axis' })).toBeTruthy();
    expect(screen.getByText(/shape 是每个维度的长度/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开中文辅助' }));
    expect(screen.getByText('shape')).toBeTruthy();
    const evidence = '我创建了一个 3×2 ndarray，预测 axis=1 会得到三个值，运行后核对 shape 和结果。';
    fireEvent.change(screen.getByRole('textbox', { name: '学习答案与成果' }), { target: { value: evidence } });
    fireEvent.click(screen.getByRole('button', { name: '我已独立完成 · 自评' }));
    expect(screen.getByText(/这不是 AI 掌握度/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '结算任务与奖励' }));
    await waitFor(() => expect(screen.getByText(/成果已保存 · 由你自行完成/)).toBeTruthy());
    expect(window.localStorage.getItem('ninegrid.learning.v1')).toContain(evidence);
    await waitFor(() => expect(window.localStorage.getItem('ninegrid.learning.v1')).toContain(evidence));

    view.unmount();
    render(<App/>);
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '课程总览' }));
    openFirstNumpyTask();
    expect((await screen.findByRole('textbox', { name: '学习答案与成果' }) as HTMLTextAreaElement).value).toBe(evidence);
    const switcher = screen.getByRole('combobox', { name: '切换学习目标' });
    fireEvent.change(switcher, { target: { value: 'python-intelligence' } });
    await screen.findByRole('heading', { name: '情报归档行动' });
    fireEvent.change(screen.getByRole('combobox', { name: '切换学习目标' }), { target: { value: 'numpy-first-analysis' } });
    await screen.findByRole('heading', { name: 'NumPy 数据准备行动' });
    const restored = JSON.parse(window.localStorage.getItem('ninegrid.learning.v1') ?? '{}');
    expect(restored.campaign.id).toBe('numpy-first-analysis');
    expect(restored.progress['numpy-read-shape'].evidence).toBe(evidence);
  });
});
