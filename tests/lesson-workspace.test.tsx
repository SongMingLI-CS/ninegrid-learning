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
});
