import { createHash } from 'node:crypto';
import type { Task } from '../shared/types';

export interface VerifiedVideo {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSeconds: number;
  language: string;
  captionsAvailable: boolean;
  watchUrl: string;
  verifiedAt: string;
  source: 'youtube-data-api-v3';
  metadataOnly: true;
  matchReason: string;
}
export interface YouTubeSearchResult {
  status: 'metadata-verified' | 'search-fallback';
  query: string;
  searchUrl: string;
  videos: VerifiedVideo[];
  notice: string;
}
interface Candidate { id: string; title: string; channel: string; thumbnail: string }
interface VideoDetails { id: string; title: string; channel: string; duration: number; language: string; captions: boolean; privacy: string; embeddable: boolean }
const cache = new Map<string, { expires: number; result: YouTubeSearchResult }>();
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_NOTICE = '当前没有可用的 YouTube 元数据检索服务；以下仅是搜索入口，不代表任何视频已核验。';

function fallback(query: string, notice = FALLBACK_NOTICE): YouTubeSearchResult {
  return { status: 'search-fallback', query, searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, videos: [], notice };
}

function durationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function metadataRows(payload: unknown): Candidate[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload) || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((raw): Candidate[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as { id?: { videoId?: unknown }; snippet?: { title?: unknown; channelTitle?: unknown; thumbnails?: { medium?: { url?: unknown }; default?: { url?: unknown } } } };
    const id = item.id?.videoId;
    const title = item.snippet?.title;
    const channel = item.snippet?.channelTitle;
    const thumbnail = item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url;
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || typeof title !== 'string' || typeof channel !== 'string' || typeof thumbnail !== 'string') return [];
    try {
      const parsed = new URL(thumbnail);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'i.ytimg.com') return [];
    } catch { return []; }
    return [{ id, title: title.slice(0, 300), channel: channel.slice(0, 200), thumbnail }];
  });
}

function detailsRows(payload: unknown): VideoDetails[] {
  if (!payload || typeof payload !== 'object' || !('items' in payload) || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((raw): VideoDetails[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as { id?: unknown; snippet?: { title?: unknown; channelTitle?: unknown; defaultAudioLanguage?: unknown; defaultLanguage?: unknown }; contentDetails?: { duration?: unknown; caption?: unknown }; status?: { privacyStatus?: unknown; embeddable?: unknown } };
    const duration = durationSeconds(item.contentDetails?.duration);
    if (typeof item.id !== 'string' || typeof item.snippet?.title !== 'string' || typeof item.snippet?.channelTitle !== 'string' || duration === undefined) return [];
    return [{ id: item.id, title: item.snippet.title, channel: item.snippet.channelTitle, duration, language: String(item.snippet.defaultAudioLanguage ?? item.snippet.defaultLanguage ?? 'unknown').slice(0, 40), captions: item.contentDetails?.caption === 'true', privacy: String(item.status?.privacyStatus ?? ''), embeddable: item.status?.embeddable === true }];
  });
}

export async function searchTaskVideos(task: Pick<Task, 'id' | 'title' | 'brief' | 'acceptance'>, options: {
  apiKey?: string; budgetMinutes: number; language?: 'en' | 'zh' | 'mixed'; fetchImpl?: typeof fetch; now?: () => Date;
}): Promise<YouTubeSearchResult> {
  const language = options.language ?? 'mixed';
  const query = `${task.title} ${task.brief}`.slice(0, 300);
  const fallbackResult = fallback(query);
  const key = options.apiKey?.trim();
  if (!key || !Number.isInteger(options.budgetMinutes) || options.budgetMinutes < 1 || options.budgetMinutes > 1440) return fallbackResult;
  const apiKeyFingerprint = createHash('sha256').update(key).digest('hex').slice(0, 16);
  const cacheKey = `${apiKeyFingerprint}:${task.id}:${language}:${options.budgetMinutes}:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.result;
  const fetcher = options.fetchImpl ?? fetch;
  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.search = new URLSearchParams({ part: 'snippet', q: query, type: 'video', maxResults: '12', safeSearch: 'moderate', videoEmbeddable: 'true', relevanceLanguage: language === 'en' ? 'en' : language === 'zh' ? 'zh-Hans' : 'en', key }).toString();
    const searchResponse = await fetcher(searchUrl, { signal: AbortSignal.timeout(10_000) });
    if (!searchResponse.ok) return fallbackResult;
    const candidates = metadataRows(await searchResponse.json());
    if (!candidates.length) return fallback(query, 'YouTube 检索没有返回可核验的视频候选；请使用下方搜索入口。');
    const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailsUrl.search = new URLSearchParams({ part: 'snippet,contentDetails,status', id: candidates.map(item => item.id).join(','), key }).toString();
    const detailsResponse = await fetcher(detailsUrl, { signal: AbortSignal.timeout(10_000) });
    if (!detailsResponse.ok) return fallbackResult;
    const details = new Map(detailsRows(await detailsResponse.json()).map(item => [item.id, item]));
    const checkedAt = (options.now?.() ?? new Date()).toISOString();
    const videos: VerifiedVideo[] = candidates.flatMap(candidate => {
      const detail = details.get(candidate.id);
      if (!detail || detail.privacy !== 'public' || !detail.embeddable) return [];
      if (detail.duration > options.budgetMinutes * 60) return [];
      return [{ videoId: candidate.id, title: detail.title, channel: detail.channel, thumbnail: candidate.thumbnail, durationSeconds: detail.duration, language: detail.language, captionsAvailable: detail.captions, watchUrl: `https://www.youtube.com/watch?v=${candidate.id}`, verifiedAt: checkedAt, source: 'youtube-data-api-v3' as const, metadataOnly: true as const, matchReason: `标题、简介与任务「${task.title}」及目标「${task.acceptance}」由官方 YouTube 搜索索引匹配；这里只核实公开状态、可嵌入属性与时长，不代表已逐段审看或看完。` }];
    }).slice(0, 3);
    const result = videos.length ? { status: 'metadata-verified' as const, query, searchUrl: fallbackResult.searchUrl, videos, notice: '元数据已核验；尚未进行逐段内容审阅，也不会自动计为已观看或掌握。' } : fallback(query, '检索结果不满足公开/可用条件或单条视频超出本次预算；已提供搜索入口，可自行选择替代内容。');
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { result, expires: Date.now() + 60 * 60_000 });
    return result;
  } catch { return fallbackResult; }
}
