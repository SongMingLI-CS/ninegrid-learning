import { useEffect, useState } from 'react';
import { ExternalLink, PlayCircle, Youtube } from 'lucide-react';
import type { Task } from '../../shared/types';
import type { YouTubeSearchResult } from '../../server/youtube';
import { apiFetch } from '../lib/api';

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function YouTubeResources({ task, budgetMinutes, language = 'mixed' }: { task: Task; budgetMinutes: number; language?: 'en' | 'zh' | 'mixed' }) {
  const [result, setResult] = useState<YouTubeSearchResult>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading'); setResult(undefined);
    void apiFetch('/api/resources/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, budgetMinutes: Math.max(1, Math.floor(budgetMinutes)), language }), signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('资源检索暂不可用'); return response.json() as Promise<YouTubeSearchResult>; })
      .then(value => { setResult(value); setStatus('ready'); })
      .catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); });
    return () => controller.abort();
  }, [task.id, task.title, task.brief, task.acceptance, budgetMinutes, language]);

  const fallbackQuery = `${task.title} ${language === 'zh' ? '中文' : language === 'en' ? 'beginner tutorial' : 'tutorial'}`;
  const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(fallbackQuery)}`;
  return <section className="youtube-resources" aria-label="本任务视频资源">
    <header><span><Youtube size={16}/> 任务视频情报</span><small>只在本任务内检索 · 不自动播放</small></header>
    <p>建议看前：先读本任务目标。视频时间计入 {budgetMinutes} 分钟任务预算，请替换一段讲解时间，不额外堆时长；看完仍需完成独立练习。</p>
    {status === 'loading' && <div role="status">正在检索并核验候选视频元数据…</div>}
    {status === 'error' && <div className="youtube-fallback"><p>视频检索请求失败；没有视频被标记为已核验。</p><a href={fallbackUrl} target="_blank" rel="noopener noreferrer">搜索：{fallbackQuery}<ExternalLink size={13}/></a></div>}
    {status === 'ready' && result && <>
      {result.videos.map(video => <article className="youtube-resource" key={video.videoId}>
        <a className="youtube-thumb" href={video.watchUrl} target="_blank" rel="noopener noreferrer" aria-label={`在 YouTube 打开 ${video.title}`}><img src={video.thumbnail} alt="" loading="lazy"/><PlayCircle size={26}/></a>
        <div className="youtube-copy"><strong>{video.title}</strong><span>{video.channel} · {formatDuration(video.durationSeconds)} · {video.language}</span><p>{video.matchReason}</p><small>官方元数据核验 · {new Date(video.verifiedAt).toLocaleString()} · 不代表逐段审阅或已观看</small><a href={video.watchUrl} target="_blank" rel="noopener noreferrer">在 YouTube 新标签页打开 <ExternalLink size={13}/></a></div>
      </article>)}
      <p className="youtube-notice">{result.notice}</p>
      <div className="youtube-after"><strong>看完后：</strong>合上视频，不照抄步骤；先预测结果，再独立完成“{task.acceptance}”。</div>
      <a className="youtube-search-link" href={result.searchUrl} target="_blank" rel="noopener noreferrer">{result.videos.length ? '更多搜索结果' : `搜索：${result.query}`} <ExternalLink size={13}/></a>
    </>}
  </section>;
}
