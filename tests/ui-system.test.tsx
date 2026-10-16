// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountFeatureNavigation } from '../src/components/AccountFeatureNavigation';
import { TodaySchedule } from '../src/components/TodaySchedule';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import type { DailySchedule } from '../shared/types';

afterEach(cleanup);

describe('shared UI system', () => {
  it('uses the shared accessible button primitive for account navigation', () => {
    render(<AccountFeatureNavigation currentPath="/today" onNavigate={vi.fn()} />);
    const navigation = screen.getByRole('navigation', { name: '账号功能导航' });
    const today = screen.getByRole('button', { name: '今日学习' });

    expect(navigation.querySelector('[data-slot="button"]')).toBeTruthy();
    expect(today.getAttribute('aria-current')).toBe('page');
  });

  it('presents the recommended task as the primary next action', () => {
    const task = NUMPY_DEMO_CAMPAIGN.stages[0].tasks[0];
    const schedule: DailySchedule = {
      date: '2026-10-16',
      theme: '认识数组形状',
      items: [{ taskId: task.id, kind: 'lesson', minutes: 20, required: true, deliverable: '写下形状预测' }],
      totalMinutes: 20,
      outcome: '解释二维数组形状',
      nextUnlock: '轴与切片',
      revision: 1,
    };

    render(<TodaySchedule seasonTitle="NumPy 基础行动" schedule={schedule} tasks={[task]} progress={{}} reviews={[]} recommendedTask={task} budgetMinutes={30} onStart={vi.fn()} onGenerate={vi.fn()} onAdjust={vi.fn()} />);

    const recommendation = screen.getByRole('region', { name: '推荐学习任务' });
    expect(recommendation.textContent).toContain(task.title);
    expect(recommendation.querySelector('[data-slot="button"]')).toBeTruthy();
    expect(screen.getByText(/当前赛季 · NumPy 基础行动/)).toBeTruthy();
  });
});
