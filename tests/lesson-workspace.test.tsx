// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonWorkspace } from '../src/components/LessonWorkspace';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import type { LessonContent } from '../shared/types';

const task = NUMPY_DEMO_CAMPAIGN.stages[0].tasks[0];
const content: LessonContent = {
  purpose: 'Understand the task.', explanation: 'Explanation.', terms: [],
  example: { kind: 'code', prompt: 'Worked example.', content: 'x = 1', walkthrough: 'Run the example.' },
  guidedPractice: { prompt: 'Complete this example.', expected: '1', hint: 'Inspect the first value.' },
  challenge: { prompt: 'Complete the assigned task.', rubric: ['Show your own result.'], referenceAnswer: 'This is the reference answer.', hints: ['Start by checking the shape.', 'Then explain each dimension.'] },
  language: 'mixed', generatedAt: '2026-10-14T00:00:00.000Z', revision: 1,
};

describe('lesson challenge disclosure', () => {
  afterEach(() => cleanup());

  it('keeps the answer out of the page until the learner asks, while exposing only the task rubric first', async () => {
    const onAnswerRevealed = vi.fn();
    const onHintUsed = vi.fn();
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence: '', status: 'active' }} content={content} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onAnswerRevealed={onAnswerRevealed} onHintUsed={onHintUsed}/>);
    expect(document.body.textContent).not.toContain(content.challenge.referenceAnswer);
    expect(screen.getAllByText(task.objectives[0].text).length).toBeGreaterThan(0);
    const summary = screen.getByText(/需要提示/);
    fireEvent.click(summary);
    await waitFor(() => expect(onHintUsed).toHaveBeenCalledWith(1));
    expect(screen.getByText('Start by checking the shape.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看参考答案' }));
    expect(onAnswerRevealed).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(content.challenge.referenceAnswer).length).toBeGreaterThan(0);
  });

  it('marks an exposed worked answer as assisted even when the learner did not click reveal', async () => {
    const leaked = { ...content, example: { ...content.example, walkthrough: content.challenge.referenceAnswer } };
    const onAnswerRevealed = vi.fn();
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence: '', status: 'active' }} content={leaked} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onAnswerRevealed={onAnswerRevealed}/>);
    await waitFor(() => expect(onAnswerRevealed).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/教学示例已包含本题参考答案/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '参考答案已出现在示例中' })).toBeTruthy();
  });

  it('offers optional Feynman assessment and preserves the learner evidence and independent challenge context', () => {
    const onEvaluate = vi.fn();
    const onEvidence = vi.fn();
    render(<LessonWorkspace task={{ ...task, kind: 'boss' }} progress={{ completedObjectives: [], evidence: '', status: 'active' }} content={content} feynmanAvailable onEvidence={onEvidence} onEvaluate={onEvaluate} onSelfCheck={vi.fn()} onComplete={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '开始费曼验收' }));
    expect(screen.getByText(/最多两轮追问/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('学习答案与成果'), { target: { value: '概念解释：\nshape 表示各轴长度。\n具体例子：二维数组有两行三列。\n适用条件或常见误区：元素总数不因 reshape 改变。' } });
    expect(screen.getByRole('button', { name: '根据解释生成追问' })).toBeTruthy();
    expect(onEvidence).toHaveBeenCalled();
    expect(onEvaluate).not.toHaveBeenCalled();
  });

  it('shows staged rescue after three failed attempts without replacing saved evidence', () => {
    const evidence = '原始答案仍在这里：我预测 shape 并记录了真实运行输出。';
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence, status: 'active' }} content={content} failedAttempts={3} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onRescue={vi.fn()}/>);
    expect(screen.getByText(/连续三次独立尝试未通过/)).toBeTruthy();
    expect((screen.getByLabelText('学习答案与成果') as HTMLTextAreaElement).value).toBe(evidence);
    fireEvent.click(screen.getByRole('button', { name: '开始分层救援' }));
  });
});
