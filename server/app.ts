import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import type { Campaign, Evaluation, GoalInput, Task } from '../shared/types';
import {
  campaignSchema,
  evaluationSchema,
  goalInputSchema,
  taskSchema,
} from '../shared/schema';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const BODY_LIMIT = '32kb';
const MAX_UPSTREAM_BYTES = 1_000_000;
const MAX_EVIDENCE_LENGTH = 20_000;
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_TOKENS = 8_192;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

type Options = { apiKey?: string; model?: string; fetchImpl?: typeof fetch };
type ErrorCode =
  | 'API_KEY_MISSING'
  | 'INVALID_REQUEST'
  | 'INVALID_AI_OUTPUT'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'ORIGIN_FORBIDDEN';

function sendError(res: Response, status: number, code: ErrorCode): void {
  res.status(status).json({ error: code.replaceAll('_', ' ').toLowerCase(), code });
}

function allowedOrigin(origin: string): boolean {
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]');
  } catch {
    return false;
  }
}

function campaignWithFreshIds(value: Campaign): Campaign {
  const campaignId = randomUUID();
  const taskIds = new Map<string, string>();
  const objectiveIds = new Map<string, string>();
  for (const stage of value.stages) {
    for (const task of stage.tasks) {
      taskIds.set(task.id, randomUUID());
      for (const objective of task.objectives) objectiveIds.set(objective.id, randomUUID());
    }
  }
  return {
    ...value,
    id: campaignId,
    createdAt: new Date().toISOString(),
    source: 'deepseek',
    stages: value.stages.map((stage) => ({
      ...stage,
      id: randomUUID(),
      tasks: stage.tasks.map((task) => ({
        ...task,
        id: taskIds.get(task.id)!,
        prerequisites: task.prerequisites.map((id) => taskIds.get(id)!),
        objectives: task.objectives.map((objective) => ({ ...objective, id: objectiveIds.get(objective.id)! })),
      })),
    })),
  };
}

function validateCampaignGraph(campaign: Campaign): boolean {
  const tasks = campaign.stages.flatMap((stage) => stage.tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) return false;
  const ids = [campaign.id, ...campaign.stages.map((stage) => stage.id), ...tasks.flatMap((task) => [
    task.id,
    ...task.objectives.map((objective) => objective.id),
  ])];
  if (new Set(ids).size !== ids.length) return false;
  for (const task of tasks) {
    if (new Set(task.prerequisites).size !== task.prerequisites.length) return false;
    if (task.prerequisites.some((id) => !byId.has(id) || id === task.id)) return false;
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (task: Task): boolean => {
    if (visiting.has(task.id)) return true;
    if (visited.has(task.id)) return false;
    visiting.add(task.id);
    for (const id of task.prerequisites) {
      const prerequisite = byId.get(id);
      if (!prerequisite || hasCycle(prerequisite)) return true;
    }
    visiting.delete(task.id);
    visited.add(task.id);
    return false;
  };
  return tasks.every((task) => !hasCycle(task));
}

function parseJsonContent(content: unknown): unknown {
  if (typeof content !== 'string' || !content.trim()) throw new Error('INVALID_AI_OUTPUT');
  return JSON.parse(content) as unknown;
}

export function createApp(options: Options = {}) {
  const app = express();
  const fetchImpl = options.fetchImpl ?? fetch;
  const configuredKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const configuredModel = options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
  const limits = new Map<string, { count: number; resetAt: number }>();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigin(origin)) {
      sendError(res, 403, 'ORIGIN_FORBIDDEN');
      return;
    }
    if (origin) res.setHeader('Vary', 'Origin');
    next();
  });
  app.use(express.json({ limit: BODY_LIMIT, strict: true, type: 'application/json' }));
  app.use((err: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE');
      return;
    }
    if (err instanceof SyntaxError) {
      sendError(res, 400, 'INVALID_REQUEST');
      return;
    }
    next(err);
  });

  app.get('/api/status', (_req, res) => {
    res.json({ configured: Boolean(configuredKey?.trim()), model: configuredModel });
  });

  const providerRequest = async (args: {
    req: Request;
    res: Response;
    key: string;
    model: string;
    system: string;
    prompt: string;
  }): Promise<unknown | undefined> => {
    const now = Date.now();
    const clientId = args.req.ip ?? args.req.socket.remoteAddress ?? 'unknown';
    const current = limits.get(clientId);
    if (current && now < current.resetAt && current.count >= RATE_LIMIT) {
      args.res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      sendError(args.res, 429, 'RATE_LIMITED');
      return undefined;
    }
    limits.set(clientId, !current || now >= current.resetAt
      ? { count: 1, resetAt: now + RATE_WINDOW_MS }
      : { ...current, count: current.count + 1 });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    try {
      const upstream = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: args.model,
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: args.prompt },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          max_tokens: MAX_TOKENS,
          stream: false,
        }),
        signal: abortController.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        if (upstream.status === 401 || upstream.status === 403) sendError(args.res, 502, 'PROVIDER_AUTH');
        else if (upstream.status === 429) sendError(args.res, 429, 'PROVIDER_RATE_LIMIT');
        else if (upstream.status >= 500) sendError(args.res, 502, 'PROVIDER_UNAVAILABLE');
        else sendError(args.res, 502, 'PROVIDER_ERROR');
        return undefined;
      }
      const reader = upstream.body?.getReader();
      if (!reader) {
        sendError(args.res, 502, 'INVALID_AI_OUTPUT');
        return undefined;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_UPSTREAM_BYTES) {
          await reader.cancel();
          sendError(args.res, 502, 'INVALID_AI_OUTPUT');
          return undefined;
        }
        chunks.push(value);
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      let envelope: { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
      try {
        envelope = JSON.parse(text) as typeof envelope;
      } catch {
        sendError(args.res, 502, 'INVALID_AI_OUTPUT');
        return undefined;
      }
      const choice = envelope.choices?.[0];
      if (!choice || choice.finish_reason !== 'stop') {
        sendError(args.res, 502, 'INVALID_AI_OUTPUT');
        return undefined;
      }
      try {
        return parseJsonContent(choice.message?.content);
      } catch {
        sendError(args.res, 502, 'INVALID_AI_OUTPUT');
        return undefined;
      }
    } catch (error) {
      if (abortController.signal.aborted) sendError(args.res, 504, 'REQUEST_TIMEOUT');
      else sendError(args.res, 502, 'PROVIDER_UNAVAILABLE');
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  };

  app.post('/api/generate', async (req: Request, res: Response) => {
    const body = req.body as { input?: unknown; apiKey?: unknown; model?: unknown };
    const parsedInput = goalInputSchema.safeParse(body?.input);
    if (!parsedInput.success || (body?.apiKey !== undefined && typeof body.apiKey !== 'string') ||
      (body?.model !== undefined && typeof body.model !== 'string')) {
      sendError(res, 400, 'INVALID_REQUEST');
      return;
    }
    const key = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : configuredKey?.trim();
    if (!key) {
      sendError(res, 503, 'API_KEY_MISSING');
      return;
    }
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : configuredModel;
    if (model.length > 100 || /[\r\n]/.test(model)) {
      sendError(res, 400, 'INVALID_REQUEST');
      return;
    }
    const input = parsedInput.data as GoalInput;
    const output = await providerRequest({
      req, res, key, model,
      system: 'Create a practical learning campaign as one JSON object matching the supplied type shape. Include staged tasks, useful prerequisites, measurable objectives, clear acceptance criteria, and varied investigation, recall, practice, and final boss work. IDs may be arbitrary. Do not claim progress. Output JSON only.',
      prompt: JSON.stringify({ input, requiredShape: 'Campaign with id,title,subtitle,goal,level,days,dailyMinutes,ultimateReward,createdAt,source,stages[].{id,title,description,tasks[]}. Tasks must include id,title,brief,kind,minutes,xp,prerequisites,objectives[].{id,text},curiosity,steps,acceptance,recallQuestion,hint,resources[].{title,url}.' }),
    });
    if (output === undefined) return;
    const validated = campaignSchema.safeParse(output);
    if (!validated.success) {
      sendError(res, 502, 'INVALID_AI_OUTPUT');
      return;
    }
    const cleaned: Campaign = {
      ...validated.data,
      goal: input.goal,
      level: input.level,
      days: input.days,
      dailyMinutes: input.dailyMinutes,
      ultimateReward: input.ultimateReward,
      source: 'deepseek',
    };
    if (!validateCampaignGraph(cleaned)) {
      sendError(res, 502, 'INVALID_AI_OUTPUT');
      return;
    }
    const campaign = campaignWithFreshIds(cleaned);
    if (!validateCampaignGraph(campaign)) {
      sendError(res, 502, 'INVALID_AI_OUTPUT');
      return;
    }
    res.json({ campaign });
  });

  app.post('/api/evaluate', async (req: Request, res: Response) => {
    const body = req.body as { task?: unknown; evidence?: unknown; apiKey?: unknown; model?: unknown };
    const parsedTask = taskSchema.safeParse(body?.task);
    if (!parsedTask.success || typeof body?.evidence !== 'string' || body.evidence.trim().length < 20 ||
      body.evidence.length > MAX_EVIDENCE_LENGTH || (body.apiKey !== undefined && typeof body.apiKey !== 'string') ||
      (body.model !== undefined && typeof body.model !== 'string')) {
      sendError(res, 400, 'INVALID_REQUEST');
      return;
    }
    const key = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : configuredKey?.trim();
    if (!key) {
      sendError(res, 503, 'API_KEY_MISSING');
      return;
    }
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : configuredModel;
    if (model.length > 100 || /[\r\n]/.test(model)) {
      sendError(res, 400, 'INVALID_REQUEST');
      return;
    }
    const task = parsedTask.data as Task;
    const evidence = body.evidence;
    const output = await providerRequest({
      req, res, key, model,
      system: 'You are a rigorous learning assessor. Return one JSON Evaluation object with passed:boolean, score:integer 0..100, feedback:string, gaps:string[], nextStep:string. Judge only the evidence against every objective and the acceptance criteria. A pass requires concrete, relevant evidence for the objectives and acceptance criteria and score >=70. Do not pass vague claims, copied claims without demonstrated understanding, or empty accomplishments. Score honestly; do not set all objectives as satisfied automatically. Output JSON only.',
      prompt: JSON.stringify({ task, evidence }),
    });
    if (output === undefined) return;
    const validated = evaluationSchema.safeParse(output);
    if (!validated.success || validated.data.passed !== (validated.data.score >= 70)) {
      sendError(res, 502, 'INVALID_AI_OUTPUT');
      return;
    }
    const evaluation: Evaluation = validated.data;
    res.json({ evaluation });
  });

  app.use((_req, res) => sendError(res, 404, 'INVALID_REQUEST'));
  return app;
}
