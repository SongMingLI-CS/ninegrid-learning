import { useEffect, useId, useRef, useState } from 'react';
import type { LearningState, RewardBundle } from '../../shared/types';
import { formatHafverCoins } from '../../shared/economy';
import { apiFetch } from '../lib/api';
import './InventoryScreen.css';

export interface InventoryScreenProps {
  seasons?: { id: string; title: string; state?: LearningState }[];
}

interface InventoryItem {
  item_id: string;
  definition: { itemId: string; name: string; description: string; rarity: string; icon: string };
  quantity: number;
  acquired_at: string;
  sources: { seasonId: string; taskId: string; acquiredAt: string }[];
}
interface LedgerEntry {
  id: string;
  season_id: string | null;
  task_id: string | null;
  kind: string;
  reward: RewardBundle;
  economy_version?: string;
  created_at: string;
}
interface InventoryData {
  items: InventoryItem[];
  wallets: { currency: string; balance: number }[];
  ledger: LedgerEntry[];
}
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: InventoryData };
const rarityNames: Record<string, string> = { common: '普通', rare: '稀有', legendary: '传说' };
const rewardNames: Record<string, string> = { mission: '任务', verification: '核验', chain: '任务链', stage: '阶段', season: '赛季', review: '复习', challenge: '免费行动' };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
function AcquisitionTime({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? <span>日期未知</span> : <time dateTime={value}>{dateFormat.format(date)}</time>;
}
function signed(value: number) { return `${value >= 0 ? '+' : ''}${value.toLocaleString('zh-CN')}`; }
function signedCoins(value: number) { return `${value < 0 ? '−' : '+'}${formatHafverCoins(Math.abs(value))}`; }
async function getPayload(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await apiFetch(path, { signal });
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录后重试。' : `读取个人收藏失败（HTTP ${response.status}），请重试。`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('收藏数据格式错误，请重试。');
  return payload as Record<string, unknown>;
}

/** Mount with key={accountId} so an account change clears data and aborts pending requests. */
export function InventoryScreen({ seasons = [] }: InventoryScreenProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [seasonFilter, setSeasonFilter] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const headingId = useId();
  const detailsId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoad({ status: 'loading' });
    setSelectedId(null);
    async function loadInventory() {
      try {
        const [wallet, inventory] = await Promise.all([
          getPayload('/api/wallet', controller.signal),
          getPayload('/api/inventory', controller.signal),
        ]);
        if (!Array.isArray(wallet.wallets) || !Array.isArray(wallet.ledger) || !Array.isArray(inventory.items)) {
          throw new Error('收藏数据格式错误，请重试。');
        }
        if (active) setLoad({ status: 'ready', data: {
          wallets: wallet.wallets as InventoryData['wallets'],
          ledger: wallet.ledger as LedgerEntry[],
          items: inventory.items as InventoryItem[],
        } });
      } catch (error) {
        if (!active) return;
        controller.abort();
        setLoad({ status: 'error', message: error instanceof Error && error.message !== 'Failed to fetch' ? error.message : '无法连接服务器，请检查网络后重试。' });
      }
    }
    void loadInventory();
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  useEffect(() => { if (selectedId) detailsRef.current?.focus(); }, [selectedId]);

  function closeDetails() {
    setSelectedId(null);
    selectedButton.current?.focus();
  }
  function seasonName(id: string | null) {
    return id ? seasons.find(season => season.id === id)?.title ?? `赛季 ${id}` : '来源赛季未知';
  }
  function taskName(seasonId: string | null, taskId: string | null) {
    if (!taskId) return '无关联任务';
    return seasons.find(season => season.id === seasonId)?.state?.campaign.stages
      .flatMap(stage => stage.tasks).find(task => task.id === taskId)?.title ?? `任务 ${taskId}`;
  }
  function clearFilters() { setSeasonFilter(''); setRarityFilter(''); setSelectedId(null); }

  const data = load.status === 'ready' ? load.data : null;
  const seasonIds = new Set(seasons.map(season => season.id));
  data?.items.forEach(item => item.sources.forEach(source => { if (source.seasonId) seasonIds.add(source.seasonId); }));
  data?.ledger.forEach(entry => { if (entry.season_id) seasonIds.add(entry.season_id); });
  const rarities = Array.from(new Set(data?.items.map(item => item.definition.rarity) ?? []));
  const items = data?.items.filter(item => (!seasonFilter || item.sources.some(source => source.seasonId === seasonFilter)) && (!rarityFilter || item.definition.rarity === rarityFilter)) ?? [];
  const ledger = data?.ledger.filter(entry => !seasonFilter || entry.season_id === seasonFilter)
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)) ?? [];
  const selected = items.find(item => item.item_id === selectedId);

  return <section className="personal-inventory" aria-labelledby={headingId} aria-busy={load.status === 'loading'}>
    <header className="pi-header"><div><span className="pi-eyebrow">PERSONAL COLLECTION / 个人档案</span><h2 id={headingId}>个人收藏库</h2><p>每一件收藏，都有属于你的学习来路。</p></div><span className="pi-stamp">学习行动 · 收藏档案</span></header>
    {load.status === 'loading' && <p className="pi-notice" role="status">正在加载余额与收藏…</p>}
    {load.status === 'error' && <div className="pi-notice pi-error"><p role="alert">{load.message}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
    {data && <>
      <section className="pi-wallet" aria-label="账户余额"><h3>账户余额</h3><p>全账户余额 · 不随收藏筛选变化</p>
        {data.wallets.length ? <dl>{data.wallets.map(wallet => <div key={wallet.currency}><dt>{wallet.currency==='learning-coin'?'哈弗币':wallet.currency}</dt><dd>{wallet.currency==='learning-coin'?formatHafverCoins(wallet.balance):wallet.balance.toLocaleString('zh-CN')}</dd></div>)}</dl> : <p>暂无余额记录。</p>}
      </section>
      <div className="pi-filters"><label>来源赛季<select aria-label="来源赛季" value={seasonFilter} onChange={event => { setSeasonFilter(event.target.value); setSelectedId(null); }}><option value="">全部赛季</option>{Array.from(seasonIds).map(id => <option key={id} value={id}>{seasonName(id)}</option>)}</select></label>
        <label>稀有度<select aria-label="稀有度" value={rarityFilter} onChange={event => { setRarityFilter(event.target.value); setSelectedId(null); }}><option value="">全部稀有度</option>{rarities.map(rarity => <option key={rarity} value={rarity}>{rarityNames[rarity] ?? rarity}</option>)}</select></label>
        {(seasonFilter || rarityFilter) && <button type="button" onClick={clearFilters}>清除筛选</button>}
      </div>
      <section aria-label="收藏物品"><div className="pi-section-heading"><h3>收藏物品</h3><span aria-live="polite">{items.length} 种收藏</span></div>
        <div className="pi-grid">{items.map(item => <button type="button" key={item.item_id} className={`pi-card pi-rarity-${rarityNames[item.definition.rarity] ? item.definition.rarity : 'common'}`} aria-label={`查看${item.definition.name}详情`} aria-expanded={selected?.item_id === item.item_id} aria-controls={selected?.item_id === item.item_id ? detailsId : undefined} onClick={event => { selectedButton.current = event.currentTarget; setSelectedId(item.item_id); }}>
          <span className="pi-card-top"><span>{rarityNames[item.definition.rarity] ?? item.definition.rarity}</span><span>持有 {item.quantity}</span></span>
          <span className="pi-emblem" aria-hidden="true">{item.definition.icon || '◇'}</span><strong>{item.definition.name}</strong><span className="pi-description">{item.definition.description}</span>
          <span className="pi-source">来源：{Array.from(new Set(item.sources.map(source => seasonName(source.seasonId)))).join(' / ') || '来源未记录'}</span><span className="pi-card-action">查看收藏详情 ↗</span>
        </button>)}</div>
        {!items.length && <p className="pi-notice">{data.items.length ? '没有符合筛选条件的收藏。' : '还没有收藏。完成学习任务后，在这里查看获得的物品。'}</p>}
      </section>
      {selected && <section id={detailsId} ref={detailsRef} tabIndex={-1} className="pi-details" aria-label={`${selected.definition.name}详情`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDetails(); } }}>
        <div className="pi-section-heading"><h3>{selected.definition.name}详情</h3><button type="button" onClick={closeDetails}>关闭详情</button></div>
        <p>{selected.definition.description}</p><dl className="pi-metadata"><div><dt>稀有度</dt><dd>{rarityNames[selected.definition.rarity] ?? selected.definition.rarity}</dd></div><div><dt>全账户持有</dt><dd>{selected.quantity}</dd></div><div><dt>首次获得</dt><dd><AcquisitionTime value={selected.acquired_at} /></dd></div></dl>
        <h4>获得记录 · 全部来源</h4>{selected.sources.length ? <ul className="pi-provenance">{selected.sources.map((source, index) => <li key={`${source.seasonId}-${source.taskId}-${source.acquiredAt}-${index}`}><strong>{seasonName(source.seasonId)}</strong><span>{taskName(source.seasonId, source.taskId)}</span><AcquisitionTime value={source.acquiredAt} /></li>)}</ul> : <p>来源未记录。</p>}
      </section>}
      <section className="pi-history" aria-label="奖励记录"><div className="pi-section-heading"><h3>奖励记录</h3><span>{ledger.length} 笔</span></div><p>按获得时间倒序 · 跟随来源赛季筛选</p>
        {ledger.length ? <ol>{ledger.map(entry => <li key={entry.id}><div className="pi-history-heading"><strong>{rewardNames[entry.kind] ?? entry.kind}</strong><AcquisitionTime value={entry.created_at} /></div><p>{seasonName(entry.season_id)} · {taskName(entry.season_id, entry.task_id)}{entry.economy_version&&entry.economy_version!=='2026-10-v2'?` · 历史经济版本 ${entry.economy_version}`:''}</p><div className="pi-rewards"><span>{signed(entry.reward.xp)} XP</span><span>{signedCoins(entry.reward.coins)} 哈弗币</span>{entry.reward.items.map((item, index) => <span key={`${item.itemId}-${index}`}>{item.name} ×{item.quantity}</span>)}</div></li>)}</ol> : <p className="pi-notice">{seasonFilter && data.ledger.length ? '此赛季暂无奖励记录。' : '暂无奖励记录。'}</p>}
      </section>
    </>}
  </section>;
}

export default InventoryScreen;
