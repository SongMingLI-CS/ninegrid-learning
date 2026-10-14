import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchTaskVideos } from '../server/youtube';
import { buildTaskVideoQuery } from '../shared/videoSearch';

const task = { id: 'numpy-axis', title: 'NumPy axis reductions', brief: 'Predict output shape when reducing axis=0 and axis=1.', kind: 'practice' as const, minutes: 20, xp: 100, prerequisites: [], objectives: [{ id: 'o', text: 'Predict and verify the output shape.' }], curiosity: 'Why does axis change the result?', steps: ['Predict', 'Run', 'Explain'], acceptance: 'Code and explanation match the result.', recallQuestion: 'What remains after axis=0?', hint: 'Track the dimension that is reduced.', resources: [] };

describe('YouTube candidate verification', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses concise subject keywords rather than repeated instructions and acceptance text', async () => {
    const repeated = { ...task, knowledgePoints: ['NumPy axis reductions', 'axis=0 axis=1 shape'],
      brief: 'NumPy axis reductions '.repeat(30), acceptance: 'Submit code, screenshots, explanation and a grading checklist.' };
    const result = await searchTaskVideos(repeated, { apiKey: '', budgetMinutes: 20, language: 'en' });
    expect(result.query).toBe('NumPy reductions axis=0 axis=1 shape tutorial');
    expect(new URL(result.searchUrl).searchParams.get('search_query')).toBe(result.query);
    expect(result.query).toBe(buildTaskVideoQuery(repeated, 'en'));
    expect(result.query).not.toMatch(/Submit|screenshots|checklist|Predict/);
  });

  it('preserves Chinese topic phrases and applies the same bounded query to failed-request fallback', () => {
    const chinese = { title: '雅思 主旨句定位', knowledgePoints: ['主旨句定位 证据匹配', '雅思 证据匹配'] };
    expect(buildTaskVideoQuery(chinese, 'zh')).toBe('雅思 主旨句定位 证据匹配 中文教程');
    const long = buildTaskVideoQuery({ title: 'Python ' + 'unrelated '.repeat(70), knowledgePoints: ['data analysis'] }, 'en');
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long).toContain('Python');
    expect(long).toContain('data analysis');
    expect(long.match(/unrelated/g)).toHaveLength(1);
  });

  it('returns only API-searched and videos.list-verified public items with exact duration and provenance', async () => {
    const fetchImpl: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'NumPy axis explained', channelTitle: 'University Lab', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'abcdefghijk', snippet: { title: 'NumPy axis explained', channelTitle: 'University Lab', defaultAudioLanguage: 'en' }, contentDetails: { duration: 'PT12M30S', caption: 'true' }, status: { privacyStatus: 'public', embeddable: true } }] }), { status: 200 }));
    const result = await searchTaskVideos(task, { apiKey: 'youtube-test-key', budgetMinutes: 20, fetchImpl });
    expect(result.status).toBe('metadata-verified');
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toMatchObject({ videoId: 'abcdefghijk', title: 'NumPy axis explained', channel: 'University Lab', durationSeconds: 750, language: 'en', metadataOnly: true, source: 'youtube-data-api-v3' });
    expect(result.videos[0].watchUrl).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(result.videos[0].verifiedAt).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never invents a verified resource when search credentials or upstream metadata are unavailable', async () => {
    const noKey = await searchTaskVideos(task, { apiKey: '', budgetMinutes: 20, fetchImpl: fetch });
    expect(noKey.status).toBe('search-fallback');
    expect(noKey.videos).toEqual([]);
    expect(noKey.searchUrl).toContain('youtube.com/results?search_query=');
    const failed = await searchTaskVideos(task, { apiKey: 'test-key', budgetMinutes: 20, fetchImpl: async () => new Response('{}', { status: 403 }) });
    expect(failed.status).toBe('search-fallback');
    expect(failed.videos).toEqual([]);
  });

  it('rejects non-public, non-embeddable and over-budget items', async () => {
    const fetchImpl: typeof fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'candidate', channelTitle: 'Channel', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'abcdefghijk', snippet: { title: 'candidate', channelTitle: 'Channel' }, contentDetails: { duration: 'PT21M' }, status: { privacyStatus: 'public', embeddable: true } }] }), { status: 200 }));
    const result = await searchTaskVideos(task, { apiKey: 'youtube-budget-key', budgetMinutes: 20, fetchImpl });
    expect(result.videos).toEqual([]);
    expect(result.status).toBe('search-fallback');
    expect(result.notice).toMatch(/预算/i);
  });
});
