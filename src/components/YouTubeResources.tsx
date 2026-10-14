import { useEffect, useState } from 'react';
import { ExternalLink, PlayCircle, Youtube } from 'lucide-react';
import type { DailySchedule, Task } from '../../shared/types';
import type { VerifiedVideo, YouTubeSearchResult } from '../../server/youtube';
import { apiFetch } from '../lib/api';
import { getVideoScheduleOptions, isSafeYouTubeUrl } from '../lib/videoSchedule';
import { buildTaskVideoQuery } from '../../shared/videoSearch';

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

// With schedule, budgetMinutes is the effective DAILY budget, including persisted adjustments.
// Without schedule it retains the legacy meaning of available minutes.
export function YouTubeResources({ task, budgetMinutes, schedule, language = 'mixed', onScheduleVideo }: { task: Task; budgetMinutes: number; schedule?: DailySchedule; language?: 'en' | 'zh' | 'mixed'; onScheduleVideo?: (video: VerifiedVideo, replace: boolean) => void }) {
  const [result, setResult] = useState<YouTubeSearchResult>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const usedMinutes = schedule?.items.reduce((sum, item) => sum + item.minutes, 0) ?? 0;
  const replaceMinutes = schedule?.items.find(item => item.taskId === task.id && item.kind === 'lesson')?.minutes ?? 0;
  const searchBudgetMinutes = Math.max(1, Math.floor(budgetMinutes - usedMinutes + replaceMinutes));
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading'); setResult(undefined);
    void apiFetch('/api/resources/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, budgetMinutes: searchBudgetMinutes, language }), signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('资源检索暂不可用'); return response.json() as Promise<YouTubeSearchResult>; })
      .then(value => { if (!controller.signal.aborted) { setResult(value); setStatus('ready'); } })
      .catch(error => { if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); });
    return () => controller.abort();
  }, [task.id, task.title, task.brief, task.acceptance, searchBudgetMinutes, language]);

  const fallbackQuery = buildTaskVideoQuery(task, language);
  const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackQuery)}`;
  return <section className="youtube-resources" aria-label="本任务视频资源">
    <header><span><Youtube size={16}/> 任务视频情报</span><small>只在本任务内检索 · 不自动播放</small></header>
    <p>建议看前：先读本任务目标。视频时间计入 {budgetMinutes} 分钟{schedule ? '今日总' : '可用'}预算，剩余 {Math.max(0, budgetMinutes - usedMinutes)} 分钟；可显式替换本任务讲解，必做练习和复习会保留。看完仍需完成独立练习。</p>
    {status === 'loading' && <div role="status">正在检索并核验候选视频元数据…</div>}
    {status === 'error' && <div className="youtube-fallback"><p>视频检索请求失败；没有视频被标记为已核验。</p><a href={fallbackUrl} target="_blank" rel="noopener noreferrer">搜索：{fallbackQuery}<ExternalLink size={13}/></a></div>}
    {status === 'ready' && result && <>
      {result.videos.filter(video => isSafeYouTubeUrl(video.watchUrl) && Number.isFinite(video.durationSeconds) && video.durationSeconds > 0).map(video => {
        const options = getVideoScheduleOptions(schedule, task.id, video, budgetMinutes);
        return <article className="youtube-resource" key={video.videoId}>
          <a className="youtube-thumb" href={video.watchUrl} target="_blank" rel="noopener noreferrer" aria-label={`在 YouTube 打开 ${video.title}`}><img src={video.thumbnail} alt="" loading="lazy"/><PlayCircle size={26}/></a>
          <div className="youtube-copy"><strong>{video.title}</strong><span>{video.channel} · {formatDuration(video.durationSeconds)} · {video.language}</span><p>{video.matchReason}</p><small>官方元数据核验 · {new Date(video.verifiedAt).toLocaleString()} · 不代表逐段审阅或已观看</small><a href={video.watchUrl} target="_blank" rel="noopener noreferrer">在 YouTube 新标签页打开 <ExternalLink size={13}/></a>{onScheduleVideo && <>
            <button type="button" className="text-button" disabled={!options.canAdd} onClick={() => onScheduleVideo(video, false)}>{options.selected ? '已加入今日节目表' : `加入今日节目表（${options.minutes} 分钟）`}</button>
            {!options.selected && options.lessonIndex >= 0 && <button type="button" className="text-button" disabled={!options.canReplace} onClick={() => onScheduleVideo(video, true)}>替换本任务讲解（{options.minutes} 分钟）</button>}
            {!options.selected && !options.canAdd && <small role="status">剩余预算不足，请替换本任务讲解或调整今日预算。</small>}
          </>}</div>
        </article>;
      })}
      <p className="youtube-notice">{result.notice}</p>
      <div className="youtube-after"><strong>看完后：</strong>合上视频，不照抄步骤；先预测结果，再独立完成“{task.acceptance}”。</div>
      <a className="youtube-search-link" href={isSafeYouTubeUrl(result.searchUrl) ? result.searchUrl : fallbackUrl} target="_blank" rel="noopener noreferrer">{result.videos.length ? '更多搜索结果' : `搜索：${result.query}`} <ExternalLink size={13}/></a>
    </>}
  </section>;
}
