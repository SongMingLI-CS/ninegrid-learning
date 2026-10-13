import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowDownWideNarrow, ArrowUpDown, Check, ChevronLeft, ChevronRight, LockKeyhole, Search, ShieldCheck, Sparkles, Tag, UnlockKeyhole, X } from 'lucide-react';
import { COLLECTION_CATALOG, CATALOG_RARITY_COUNTS, type CollectionItem, type CollectionRarity } from '../../shared/catalog';
import { apiFetch } from '../lib/api';
import './WarehouseScreen.css';

type HeldItem = { item_id: string; definition: { itemId: string; name: string; description: string; rarity: string; icon: string }; quantity: number; acquired_at: string; sources: Array<{ seasonId: string; taskId: string; acquiredAt: string }>; is_locked: boolean; is_showcased: boolean };
type Sale = { operation_id: string; items: Array<{ name: string; quantity: number; total: number }>; coins: number; created_at: string };
type Props = { account: string; onExit: () => void; onLogout: () => void };
const rarityLabels: Record<CollectionRarity, string> = { 'small-purple': '小紫', 'small-gold': '小金', 'large-gold': '大金', 'small-red': '小红', 'large-red': '大红' };
const rarityOrder: Record<CollectionRarity, number> = { 'small-purple': 1, 'small-gold': 2, 'large-gold': 3, 'small-red': 4, 'large-red': 5 };
const money = (value: number) => value.toLocaleString('zh-CN');
const dateText = (value?: string) => value ? new Date(value).toLocaleDateString('zh-CN') : '暂无记录';

function Artwork({ item, dim = false }: { item: Pick<CollectionItem, 'id' | 'name' | 'imageKey' | 'rarity'> & { category: string }; dim?: boolean }) {
  const n = [...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const silhouettes: Record<string, number> = { '电子设备': 0, '工具零件': 1, '医疗用品': 2, '贵重物': 3, '情报档案': 4, '研究样本': 5, '纪念物': 6 };
  const shape = silhouettes[item.category] ?? n % 7;
  return <div className={`wh-art ${dim ? 'wh-art-dim' : ''}`} aria-hidden="true"><span className="wh-art-scan"/><svg viewBox="0 0 120 90" role="img">
    <ellipse cx="60" cy="76" rx="39" ry="6" fill="#000" opacity=".42"/>
    {shape === 0 ? <><path d="M34 29 67 20 86 31 84 58 49 68 31 56Z"/><path d="m34 29 33-9v27l-36 9M67 20l19 11-35 11-17-13M49 40v28M84 31l-2 27"/><circle cx="73" cy="33" r="4"/></> : shape === 1 ? <><path d="M25 52h21l10-20 12 2-7 17h27v10H60l-9 13h-8l5-13H25z"/><path d="m56 32 7-9 8 2-3 9m-27 18v10m30-10v10"/><circle cx="79" cy="31" r="5"/></> : shape === 2 ? <><path d="M39 22h40l8 13-8 34H40l-8-34Z"/><path d="M39 22v16l-7-3m47-13v16l8-3M40 50h39m-31-9v18m18-18v18"/><circle cx="59" cy="31" r="5"/></> : shape === 3 ? <><path d="m31 34 29-16 30 16-30 18Z"/><path d="M31 34v28l29 15V52m30-18v28L60 77m-17-35 29-16m-29 28v8m29-26v9"/><path d="m73 25 11 7"/></> : shape === 4 ? <><path d="M34 20h48l7 8v44H34z"/><path d="M42 29h29m-29 8h35m-35 9h28m-28 9h35m-35 9h20"/><path d="M73 20v12h16"/></> : shape === 5 ? <><path d="M47 19h26v9l7 8v32H40V36l7-8z"/><path d="M47 28h26m-33 28h40M51 20v8m18-8v8"/><path d="M47 44h26v12H47z"/></> : <><circle cx="60" cy="43" r="25"/><circle cx="60" cy="43" r="18"/><path d="M52 66 48 78l12-6 12 6-4-12m-19-24 8 8 15-17"/><circle cx="81" cy="22" r="3"/></>}
    <path d="M25 70h70" opacity=".45"/>
    {[0, 1, 2].map(index => <circle key={index} cx={22 + index * 9} cy={14 + (n % 7)} r="1" opacity=".4"/>)}
  </svg><span className="wh-art-ref">ILLUSTRATION · {item.imageKey.toUpperCase()}</span></div>;
}

export function WarehouseScreen({ account, onExit, onLogout }: Props) {
  const [items, setItems] = useState<HeldItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [seasons, setSeasons] = useState<Array<{ id: string; title: string; tasks: Record<string, string> }>>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'owned' | 'catalog'>('owned');
  const [search, setSearch] = useState('');
  const [rarity, setRarity] = useState('');
  const [category, setCategory] = useState('');
  const [season, setSeason] = useState('');
  const [sort, setSort] = useState('rarity');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [marked, setMarked] = useState<string[]>([]);
  const [confirmSale, setConfirmSale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [invResponse, walletResponse, seasonResponse] = await Promise.all([apiFetch('/api/inventory'), apiFetch('/api/wallet'), apiFetch('/api/seasons')]);
      if (![invResponse, walletResponse, seasonResponse].every(response => response.ok)) throw new Error('服务器连接失败。检查网络或重新登录后再试。');
      const inv = await invResponse.json(); const wallet = await walletResponse.json(); const seasonData = await seasonResponse.json();
      setItems(inv.items ?? []); setSales(inv.sales ?? []); setBalance(Number(wallet.wallets?.find((row: any) => row.currency === 'learning-coin')?.balance ?? 0)); setSeasons(seasonData.seasons?.map((row: any) => ({ id: row.id, title: row.title, tasks: Object.fromEntries((row.state?.campaign?.stages ?? []).flatMap((stage: any) => stage.tasks ?? []).map((task: any) => [task.id, task.title])) })) ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '库存暂时不可用。'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const heldById = useMemo(() => new Map(items.map(item => [item.item_id, item])), [items]);
  const ownedKinds = items.filter(item => item.quantity > 0).length;
  const catalogHeldKinds = COLLECTION_CATALOG.filter(item => (heldById.get(item.id)?.quantity ?? 0) > 0).length;
  const completionPercent = catalogHeldKinds ? Math.floor(catalogHeldKinds / COLLECTION_CATALOG.length * 100) : 0;
  const estimated = items.reduce((sum, held) => sum + (COLLECTION_CATALOG.find(item => item.id === held.item_id)?.displayValue ?? 0) * held.quantity, 0);
  const sellTotal = marked.reduce((sum, id) => sum + (COLLECTION_CATALOG.find(item => item.id === id)?.sellPrice ?? 0) * (heldById.get(id)?.quantity ?? 0), 0);
  const baseRows = tab === 'owned' ? items.filter(item => item.quantity > 0).map(held => ({ catalog: COLLECTION_CATALOG.find(item => item.id === held.item_id), held })) : COLLECTION_CATALOG.map(catalog => ({ catalog, held: heldById.get(catalog.id) }));
  const rows = baseRows.filter(({ catalog, held }) => {
    const name = catalog?.name ?? held?.definition.name ?? '';
    const categoryName = catalog?.category ?? '旧版收藏';
    return (!search || name.toLowerCase().includes(search.toLowerCase())) && (!rarity || (catalog?.rarity ?? held?.definition.rarity) === rarity) && (!category || categoryName === category) && (!season || held?.sources.some(source => source.seasonId === season));
  }).sort((a, b) => {
    const ac = a.catalog, bc = b.catalog;
    if (sort === 'price') return (bc?.sellPrice ?? 0) - (ac?.sellPrice ?? 0);
    if (sort === 'quantity') return (b.held?.quantity ?? 0) - (a.held?.quantity ?? 0);
    if (sort === 'recent') return Date.parse(b.held?.acquired_at ?? '') - Date.parse(a.held?.acquired_at ?? '');
    return rarityOrder[(ac?.rarity ?? 'small-purple') as CollectionRarity] - rarityOrder[(bc?.rarity ?? 'small-purple') as CollectionRarity] || (ac?.name ?? a.held?.definition.name ?? '').localeCompare(bc?.name ?? b.held?.definition.name ?? '', 'zh');
  });
  const pageSize = 48; const pages = Math.max(1, Math.ceil(rows.length / pageSize)); const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
  const selectedCatalog = COLLECTION_CATALOG.find(item => item.id === selected);
  const selectedHeld = selected ? heldById.get(selected) : undefined;
  const selectedLegacy = selected && !selectedCatalog ? selectedHeld : undefined;
  const selectedDefinition = selectedCatalog ?? (selectedLegacy ? { ...selectedLegacy.definition, category: '旧版收藏', rarity: 'small-purple' as CollectionRarity, size: '未知', displayValue: 0, sellPrice: 0, limited: false, sellable: false, seasonId: null, version: 0, imageKey: selectedLegacy.item_id, id: selectedLegacy.item_id } : undefined);

  async function savePreferences(next: { itemId: string; locked: boolean; showcased: boolean }[]) {
    setBusy(true); setNotice('');
    try { const response = await apiFetch('/api/inventory/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: next }) }); if (!response.ok) throw new Error('偏好保存失败，请刷新后重试。'); await refresh(); setNotice('仓库标记已保存。'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  function toggleMarked(id: string) { setMarked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); }
  async function sellMarked() {
    if (!marked.length) return;
    setBusy(true); setNotice('');
    try {
      const response = await apiFetch('/api/inventory/sell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: crypto.randomUUID(), items: marked.map(itemId => ({ itemId, quantity: heldById.get(itemId)?.quantity ?? 0 })) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error === 'ITEM_LOCKED' ? '锁定中的收藏不能出售。' : body.error === 'INSUFFICIENT_ITEM_QUANTITY' ? '库存数量已变化，请刷新后重新选择。' : `出售失败（${body.error ?? response.status}）。`);
      setMarked([]); setConfirmSale(false); setNotice(`已入账 ${money(Number(body.sale.coins))} 哈弗币。`); await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '出售失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <main className="warehouse-page">
    <header className="wh-topbar"><button className="wh-brand" onClick={onExit}><span className="wh-brand-mark">9</span><span>NINEGRID <small>FIELD ARCHIVE</small></span></button><div className="wh-breadcrumb">个人账户 <b>/</b> 仓库</div><div className="wh-account"><span>{account}</span><button onClick={onLogout}>退出</button></div></header>
    <section className="wh-intro"><div><span className="wh-kicker"><span/> ACCOUNT SHARED INVENTORY</span><h1>行动仓库</h1><p>跨赛季保存的个人收藏。物品的展示估值用于收藏统计，回收价才是可入账的哈弗币。</p></div><button className="wh-back" onClick={onExit}><ArrowLeft size={15}/> 返回课程</button></section>
    <section className="wh-metrics" aria-label="仓库统计"><article><small>哈弗币余额</small><strong>{money(balance)}</strong><span>账户共享余额</span></article><article><small>持有物品</small><strong>{money(items.reduce((sum,item)=>sum+item.quantity,0))}<i> 件</i></strong><span>{ownedKinds} 种不同物品</span></article><article><small>图鉴完成度</small><strong>{catalogHeldKinds}<i> / {COLLECTION_CATALOG.length}</i></strong><span>{completionPercent === 0 && catalogHeldKinds ? '<1%' : `${completionPercent}%`} 已收集种类</span></article><article><small>图鉴展示估值</small><strong>{money(estimated)}</strong><span>参考估值，不等于余额</span></article><article><small>可出售回收</small><strong>{money(items.reduce((sum,held)=>sum+(!held.is_locked?(COLLECTION_CATALOG.find(item=>item.id===held.item_id)?.sellPrice??0)*held.quantity:0),0))}</strong><span>已排除锁定和未知旧藏品</span></article></section>
    <div className="wh-subbar"><div className="wh-tabs"><button className={tab==='owned'?'active':''} onClick={()=>{setTab('owned');setPage(0);setSelected(null)}}>我的仓库 <span>{ownedKinds}</span></button><button className={tab==='catalog'?'active':''} onClick={()=>{setTab('catalog');setPage(0);setSelected(null)}}>完整图鉴 <span>{COLLECTION_CATALOG.length}</span></button></div><div className="wh-total">图鉴规格 {Object.entries(CATALOG_RARITY_COUNTS).map(([key,count])=><span key={key}>{rarityLabels[key as CollectionRarity]} {count}</span>)}</div></div>
    {error && <div className="wh-error" role="alert"><strong>仓库暂时不可用</strong><span>{error}</span><button onClick={()=>void refresh()}>重新连接</button></div>}
    {notice && <div className="wh-notice" role="status">{notice}<button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={14}/></button></div>}
    <section className="wh-workbench"><div className="wh-main">
      <div className="wh-controls"><label className="wh-search"><Search size={16}/><input aria-label="搜索藏品名称" value={search} onChange={event=>{setSearch(event.target.value);setPage(0)}} placeholder="搜索藏品名称"/></label><label><span>稀有度</span><select value={rarity} onChange={event=>{setRarity(event.target.value);setPage(0)}}><option value="">全部</option>{Object.entries(rarityLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label><span>类别</span><select value={category} onChange={event=>{setCategory(event.target.value);setPage(0)}}><option value="">全部类别</option>{['电子设备','工具零件','医疗用品','贵重物','情报档案','研究样本','纪念物','旧版收藏'].map(value=><option key={value}>{value}</option>)}</select></label><label><span>来源赛季</span><select value={season} onChange={event=>{setSeason(event.target.value);setPage(0)}}><option value="">全部赛季</option>{seasons.map(value=><option key={value.id} value={value.id}>{value.title}</option>)}</select></label><label><span>排序</span><select value={sort} onChange={event=>setSort(event.target.value)}><option value="rarity">稀有度</option><option value="price">回收价</option><option value="recent">获得时间</option><option value="quantity">持有数量</option></select></label></div>
      <div className="wh-grid-heading"><div><span className="wh-live-dot"/><strong>{tab==='owned'?'持有物品':'收藏图鉴'}</strong><small>{rows.length} 项</small></div><div className="wh-bulk"><button onClick={()=>setMarked(rows.flatMap(row=>row.catalog && row.held && !row.held.is_locked && row.catalog.sellable ? [row.catalog.id] : []))} disabled={tab!=='owned'}>选择可售</button><button onClick={()=>setMarked([])} disabled={!marked.length}>取消选择</button><button className="wh-sell" onClick={()=>setConfirmSale(true)} disabled={!marked.length}>出售已选 · {money(sellTotal)}</button></div></div>
      {loading ? <div className="wh-state">正在读取账户仓库…</div> : !rows.length ? <div className="wh-state"><span>⌕</span><strong>{tab==='owned' && !search && !rarity && !category && !season ? '仓库尚无藏品' : '没有符合条件的藏品'}</strong><p>{tab==='owned'?'完成课程行动后，服务器奖励会记录在此账号的仓库。':'调整筛选条件后继续查看图鉴。'}</p><button onClick={()=>{setSearch('');setRarity('');setCategory('');setSeason('')}}>清除筛选</button></div> : <><div className="wh-grid">{visible.map(({catalog,held})=>{const definition=catalog??{id:held!.item_id,name:held!.definition.name,category:'旧版收藏' as const,rarity:'small-purple' as const,size:'?',imageKey:held!.item_id,description:held!.definition.description,displayValue:0,sellPrice:0,limited:false,sellable:false,seasonId:null,version:0};const count=held?.quantity??0;const isSelected=selected===definition.id;return <article key={definition.id} className={`wh-card rarity-${definition.rarity} ${isSelected?'chosen':''} ${!count?'uncollected':''}`}>
        {tab==='owned' && catalog && held && <label className="wh-check"><input type="checkbox" checked={marked.includes(catalog.id)} onChange={()=>toggleMarked(catalog.id)} aria-label={`选择${catalog.name}出售`}/></label>}
        <button className="wh-card-open" onClick={()=>setSelected(definition.id)} aria-label={`查看${definition.name}详情`}><Artwork item={definition} dim={!count}/><span className="wh-card-flags">{held?.is_locked&&<i><LockKeyhole size={11}/>锁定</i>}{held?.is_showcased&&<i className="showcase"><Sparkles size={11}/>展示</i>}{!count&&<i className="missing">未收集</i>}</span><span className="wh-card-name">{definition.name}</span><span className="wh-card-meta">{definition.category} <i>/</i> {rarityLabels[definition.rarity]}</span><span className="wh-card-foot"><b>{count ? `× ${count}` : '—'}</b><span>{definition.sellable&&count?`回收 ${money(definition.sellPrice)}`:'未入库'}</span></span></button>
      </article>})}</div><div className="wh-pagination"><span>第 {page+1} / {pages} 页 · 共 {rows.length} 件</span><button onClick={()=>setPage(Math.max(0,page-1))} disabled={!page}><ChevronLeft size={16}/>上一页</button><button onClick={()=>setPage(Math.min(pages-1,page+1))} disabled={page+1>=pages}>下一页<ChevronRight size={16}/></button></div></>}
      <section className="wh-sales"><div><span className="wh-kicker">TRANSACTION LOG</span><h3>最近回收记录</h3><small>出售会同步更新库存、哈弗币余额与服务器流水。</small></div>{sales.length ? <ul>{sales.slice(0,5).map(sale=><li key={sale.operation_id}><span>{dateText(sale.created_at)} · {sale.items.map(item=>`${item.name} ×${item.quantity}`).join('，')}</span><b>+{money(Number(sale.coins))}</b></li>)}</ul> : <p>暂无出售记录</p>}</section>
    </div>
    <aside className="wh-detail">{selectedDefinition ? <><div className={`wh-detail-art rarity-${selectedDefinition.rarity}`}><Artwork item={selectedDefinition}/></div><div className="wh-detail-title"><div><span className="wh-kicker">ITEM INSPECTION · {selectedDefinition.id}</span><h2>{selectedDefinition.name}</h2></div><button onClick={()=>setSelected(null)} aria-label="关闭详情"><X size={16}/></button></div><p className="wh-detail-desc">{selectedDefinition.description}</p><div className="wh-detail-tags"><span>{selectedDefinition.category}</span><span>{rarityLabels[selectedDefinition.rarity]}</span><span>{selectedDefinition.size}</span>{selectedDefinition.limited&&<span>赛季限定</span>}</div><dl className="wh-detail-values"><div><dt>展示估值</dt><dd>{money(selectedDefinition.displayValue)} <small>收藏参考</small></dd></div><div><dt>出售回收价</dt><dd>{selectedDefinition.sellable?money(selectedDefinition.sellPrice):'不可出售'} <small>{selectedDefinition.limited?'限定品按配置不可出售':'服务器固定价格'}</small></dd></div><div><dt>持有数量</dt><dd>{selectedHeld?.quantity??0}</dd></div><div><dt>首次获得</dt><dd>{dateText(selectedHeld?.acquired_at)}</dd></div></dl>{selectedHeld?.sources?.length ? <div className="wh-source"><strong>获得来源</strong>{selectedHeld.sources.map((source,index)=>{const origin=seasons.find(item=>item.id===source.seasonId);return <p key={`${source.seasonId}-${source.taskId}-${index}`}>{origin?.title??`赛季 ${source.seasonId}`} · {origin?.tasks[source.taskId]??source.taskId}</p>})}</div> : <div className="wh-source"><strong>来源</strong><p>{selectedHeld?'旧版库存，历史来源未记录':'尚未收集 · 不属于真实持有库存'}</p></div>}
      {selectedHeld&&<div className="wh-detail-actions"><button disabled={busy} onClick={()=>void savePreferences([{itemId:selectedHeld.item_id,locked:!selectedHeld.is_locked,showcased:selectedHeld.is_showcased}])}>{selectedHeld.is_locked?<UnlockKeyhole size={15}/>:<LockKeyhole size={15}/>} {selectedHeld.is_locked?'解除收藏锁定':'锁定收藏'}</button><button disabled={busy} onClick={()=>void savePreferences([{itemId:selectedHeld.item_id,locked:selectedHeld.is_locked,showcased:!selectedHeld.is_showcased}])}><Sparkles size={15}/>{selectedHeld.is_showcased?'取消主页展示':'设为主页展示'}</button>{selectedCatalog?.sellable&&!selectedHeld.is_locked&&<button className="wh-sell" onClick={()=>{setMarked([selectedCatalog.id]);setConfirmSale(true)}}><Tag size={15}/>出售全部 · {money(selectedCatalog.sellPrice*selectedHeld.quantity)}</button>}</div>}
    </> : <div className="wh-detail-empty"><ShieldCheck size={28}/><strong>选择一件藏品</strong><p>查看物品档案、来源赛季、估值与仓库操作。</p></div>}</aside></section>
    <footer className="wh-footer"><span>原创虚构收藏 · 服务器账号资产</span><span>图鉴插画为临时原创矢量稿</span></footer>
    {confirmSale&&<div className="wh-modal-backdrop" role="presentation" onClick={()=>!busy&&setConfirmSale(false)}><section className="wh-modal" role="dialog" aria-modal="true" aria-labelledby="wh-sale-heading" onClick={event=>event.stopPropagation()}><span className="wh-kicker">SERVER SETTLEMENT</span><h2 id="wh-sale-heading">确认出售</h2><p>出售后将从账户共享仓库扣除下列物品，并按固定回收价增加哈弗币。</p><ul>{marked.map(id=>{const item=COLLECTION_CATALOG.find(entry=>entry.id===id)!;const quantity=heldById.get(id)?.quantity??0;return <li key={id}><span>{item.name} × {quantity}</span><b>{money(item.sellPrice*quantity)}</b></li>})}</ul><div className="wh-modal-total"><span>回收合计</span><strong>{money(sellTotal)} 哈弗币</strong></div><div className="wh-modal-actions"><button onClick={()=>setConfirmSale(false)} disabled={busy}>取消</button><button className="wh-sell" onClick={()=>void sellMarked()} disabled={busy}>{busy?'正在结算…':'确认出售'}</button></div></section></div>}
  </main>;
}
