import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';

const input = { goal: '从零学习 Python，四周内做出可预览、可撤销的文件整理工具。', level: '零基础', days: 28, dailyMinutes: 45, ultimateReward: '独立完成一个能真正用上的工具' };
const mission = (id: string, prerequisites: string[] = []) => ({
  id, title: '调查变量与文件路径', brief: '通过可运行示例调查文件如何被表示。', kind: 'investigate', minutes: 20, xp: 100, prerequisites,
  objectives: [{ id: id + '-o', text: '输出两个文件的路径并解释差异' }], curiosity: '为什么路径不能被当成普通字符串随意拼接？',
  steps: ['执行一个路径示例', '更换文件名称', '用自己的话解释结果'], acceptance: '展示运行结果和解释',
  recallQuestion: '路径与文件内容有什么区别？', hint: '先查看 pathlib 文档。', resources: [{ title: 'Python 文档', url: 'https://docs.python.org/3/' }],
});
const generated = {
  id: 'server-ignores-this', title: '路径追踪行动', subtitle: '从问题出发找到可运行的答案', goal: input.goal,
  level: input.level, days: 28, dailyMinutes: 45, ultimateReward: input.ultimateReward,
  createdAt: '2026-10-13T00:00:00.000Z', source: 'deepseek',
  stages: ['调查','实战','验收'].map((title, i) => ({ id: 's' + i, title, description: '通过验证进入下一阶段', tasks: [mission('t' + i, i ? ['t' + (i - 1)] : [])] })),
};
const provider = (value: unknown, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }), { status: 200 });

describe('DeepSeek boundary', () => {
  it('does not call the provider when no API credential is configured', async () => {
    const app = createApp({ apiKey: '' });
    const res = await request(app).post('/api/generate').send({ input });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('API_KEY_MISSING');
  });
  it('rejects invalid goals before any billable request', async () => {
    const app = createApp({ apiKey: 'test-only', fetchImpl: async () => { throw new Error('should not request'); } });
    const res = await request(app).post('/api/generate').send({ input: { ...input, days: 0 } });
    expect(res.status).toBe(400);
  });
  it('sends JSON mode to the official HTTPS endpoint and returns a validated plan', async () => {
    const fetchImpl: typeof fetch = async (url, options) => {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      const body = JSON.parse(String(options?.body));
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.model).toBe('deepseek-flash');
      return provider(generated);
    };
    const res = await request(createApp({ apiKey: 'test-only', fetchImpl })).post('/api/generate').send({ input });
    expect(res.status).toBe(200);
    expect(res.body.campaign.title).toBe('路径追踪行动');
    expect(res.body.campaign.source).toBe('deepseek');
    expect(res.body.campaign.id).not.toBe('server-ignores-this');
    expect(JSON.stringify(res.body)).not.toContain('test-only');
  });
  it('rejects invented or cyclical task dependencies', async () => {
    const invalid = structuredClone(generated);
    invalid.stages[0].tasks[0].prerequisites = ['does-not-exist'];
    const res = await request(createApp({ apiKey: 'test-only', fetchImpl: async () => provider(invalid) })).post('/api/generate').send({ input });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_OUTPUT');
  });
  it.each([['', 'stop'], ['{"title":', 'length']])('does not silently use demo data for empty or truncated responses', async (content, reason) => {
    const res = await request(createApp({ apiKey: 'test-only', fetchImpl: async () => provider(content, reason) })).post('/api/generate').send({ input });
    expect(res.status).toBe(502);
    expect(res.body.campaign).toBeUndefined();
  });
  it('hides provider diagnostics and credentials on authentication failure', async () => {
    const res = await request(createApp({ apiKey: 'test-only', fetchImpl: async () => new Response('test-only provider internal detail', { status: 401 }) })).post('/api/generate').send({ input });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PROVIDER_AUTH');
    expect(JSON.stringify(res.body)).not.toContain('test-only');
  });
  it('rejects requests from unrelated browser origins', async () => {
    const res = await request(createApp({ apiKey: 'test-only' })).post('/api/generate').set('Origin', 'https://unrelated.example').send({ input });
    expect(res.status).toBe(403);
  });
  it('returns feedback without turning a failing assessment into a pass', async () => {
    const evaluation = { passed: false, score: 40, feedback: '你混淆了路径和内容。', gaps: ['路径表示位置'], nextStep: '解释一个不存在的路径。' };
    const res = await request(createApp({ apiKey: 'test-only', fetchImpl: async () => provider(evaluation) })).post('/api/evaluate').send({ task: mission('t0'), evidence: '我认为路径就是文件里的全部文本，所以可以直接当成读取的内容。' });
    expect(res.status).toBe(200);
    expect(res.body.evaluation.passed).toBe(false);
    expect(res.body.evaluation.gaps).toEqual(['路径表示位置']);
  });
});
