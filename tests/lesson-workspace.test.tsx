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

  it('provides an explicit focus-mode control without hiding the learning objective', () => {
    const onToggleFocusMode = vi.fn();
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence: '', status: 'active' }} content={content} focusMode={false} onToggleFocusMode={onToggleFocusMode} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '专注学习' }));
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);
    expect(screen.getByText(task.title)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '学习答案与成果' })).toBeTruthy();
  });

  it('keeps earlier answer attempts visible with their version and decision', () => {
    const attempts = [
      { at: '2026-10-14T00:00:00.000Z', answer: '第一份答案：我混淆了 axis。', hintLevelsUsed: 0, verification: 'ai' as const, passed: false, feedback: 'axis 方向需修正。', lessonRevision: 1 },
      { at: '2026-10-15T00:00:00.000Z', answer: '第二份答案：我用 2×3 数组验证 axis=0。', hintLevelsUsed: 1, verification: 'ai' as const, passed: true, feedback: '结果和输出形状正确。', lessonRevision: 2 },
    ];
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence: attempts[1].answer, status: 'active' }} content={{ ...content, revision: 2 }} attempts={attempts} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()}/>);
    fireEvent.click(screen.getByText(/查看作答历史/));
    expect(screen.getByText(attempts[0].answer)).toBeTruthy();
    expect(screen.getAllByText(attempts[1].answer)).toHaveLength(2);
    expect(screen.getByText(/版本 1 · 未通过/)).toBeTruthy();
    expect(screen.getByText(/版本 2 · 通过/)).toBeTruthy();
  });

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

  it('requires explicit disclosure in the final rescue layer and records it before showing the answer', () => {
    const onAnswerRevealed = vi.fn();
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence: '第一次错误答案', status: 'active', answerRevealed: false }} content={content} rescueLevel={4} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onAnswerRevealed={onAnswerRevealed} onRequestTransfer={vi.fn()}/>);
    expect(screen.queryByText(content.challenge.referenceAnswer)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /查看示范答案/ }));
    expect(onAnswerRevealed).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(content.challenge.referenceAnswer).length).toBeGreaterThan(0);
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
    const latestFailedAttempt={at:'2026-10-14T00:00:00.000Z',answer:evidence,hintLevelsUsed:0,verification:'ai' as const,passed:false,errorType:'operation' as const,feedback:'索引列方向写反了。',evaluation:{passed:false,score:42,feedback:'列索引方向不正确。',gaps:['需要先写清行索引，再写列索引。'],nextStep:'用 2×3 数组测试。'}};
    render(<LessonWorkspace task={task} progress={{ completedObjectives: [], evidence, status: 'active' }} content={content} failedAttempts={3} latestFailedAttempt={latestFailedAttempt} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onRescue={vi.fn()}/>);
    expect(screen.getByText(/连续多次独立尝试未通过/)).toBeTruthy();
    expect(screen.getByText('索引列方向写反了。')).toBeTruthy();
    expect(screen.getByText(/需要先写清行索引，再写列索引/)).toBeTruthy();
    expect((screen.getByLabelText('学习答案与成果') as HTMLTextAreaElement).value).toBe(evidence);
    fireEvent.click(screen.getByRole('button', { name: '开始分层救援' }));
  });

  it('stores the prerequisite rescue exercise separately from the original answer', () => {
    const evidence='保留的原始作答证据';
    const onSupplementalEvidence=vi.fn();
    render(<LessonWorkspace task={task} progress={{completedObjectives:[],evidence,status:'active',supplementalEvidence:'旧补充记录'}} content={content} rescueLevel={3} onEvidence={vi.fn()} onSupplementalEvidence={onSupplementalEvidence} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onRescue={vi.fn()}/>);
    const practice=screen.getByRole('textbox',{name:'救援前置练习'}) as HTMLTextAreaElement;
    expect(practice.value).toBe('旧补充记录');
    fireEvent.change(practice,{target:{value:'新短练习：预测并核对形状。'}});
    expect(onSupplementalEvidence).toHaveBeenCalledWith('新短练习：预测并核对形状。');
    expect((screen.getByLabelText('学习答案与成果') as HTMLTextAreaElement).value).toBe(evidence);
  });
  it('offers staged rescue after the first failed answer and can request a transfer without generated lesson content', () => {
    const evidence = 'Shape 顺序写错，并误以为不规则列表会自动补零。';
    const onRescue = vi.fn();
    const onRequestTransfer = vi.fn();
    const latestFailedAttempt = { at:'2026-10-15T00:00:00.000Z', answer:evidence, hintLevelsUsed:0, verification:'ai' as const, passed:false, errorType:'concept' as const, feedback:'shape 应按行、列排列。', evaluation:{passed:false,score:30,feedback:'维数与不规则列表结论均不正确。',gaps:['二维 shape 是 (行数, 列数)。'],nextStep:'先用 2×3 数组核对输出。'} };
    const { rerender } = render(<LessonWorkspace task={task} progress={{completedObjectives:[],evidence,status:'active'}} failedAttempts={1} latestFailedAttempt={latestFailedAttempt} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onRescue={onRescue} onRequestTransfer={onRequestTransfer}/>);
    expect(screen.getByRole('button',{name:'开始分层救援'})).toBeTruthy();
    expect(screen.getByText('shape 应按行、列排列。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'开始分层救援'}));
    expect(onRescue).toHaveBeenCalledTimes(1);
    rerender(<LessonWorkspace task={task} progress={{completedObjectives:[],evidence,status:'active'}} rescueLevel={4} failedAttempts={1} latestFailedAttempt={latestFailedAttempt} onEvidence={vi.fn()} onEvaluate={vi.fn()} onSelfCheck={vi.fn()} onComplete={vi.fn()} onRescue={onRescue} onRequestTransfer={onRequestTransfer}/>);
    fireEvent.click(screen.getByRole('button',{name:'生成新的独立变式'}));
    expect(onRequestTransfer).toHaveBeenCalledTimes(1);
  });
});
