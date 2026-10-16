import { COLLECTION_CATALOG, type CollectionRarity } from './catalog';

export type BoxId = 'small-safe' | 'large-safe';
export type ChallengeTier = 'ordinary' | 'confidential' | 'top-secret';
export interface RewardPoolEntry { rarity: CollectionRarity; probability: number; quantity: number }
export const ECONOMY_VERSION = '2026-10-v2';
export const LEGACY_ECONOMY_VERSION = '2026-10-v1';
export const LEGACY_CURRENCY_CONVERSION = 10_000;
export const MAX_HAFVER_COINS = Number.MAX_SAFE_INTEGER;
export const LEARNING_COIN_RATE_PER_MINUTE = 6_500;
export const MAIN_CHAIN_COMPLETION_COINS = 60_000;
export const BRANCH_CHAIN_COMPLETION_COINS = 0;
export const STAGE_COMPLETION_COINS = 200_000;
export const VERIFIED_SEASON_COMPLETION_COINS = 1_000_000;
export const EFFECTIVE_REVIEW_COINS = 60_000;
export const RARITY_DISPLAY_VALUE_RANGES: Record<CollectionRarity, readonly [number, number]> = {
  'small-purple': [20_000, 80_000], 'small-gold': [100_000, 300_000], 'large-gold': [400_000, 900_000],
  'small-red': [600_000, 1_000_000], 'large-red': [1_000_000, 2_000_000],
};
export const SEASONAL_ITEM_POLICY = { sellable: false, eligibleForStandardPools: false } as const;
export function isStandardPoolEligible(item: (typeof COLLECTION_CATALOG)[number]) { return !item.limited; }

export function learningCoinsForMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('Learning minutes must be non-negative');
  return Math.floor(minutes * LEARNING_COIN_RATE_PER_MINUTE);
}
export function chainCompletionCoins(track: 'main' | 'branch') {
  return track === 'main' ? MAIN_CHAIN_COMPLETION_COINS : BRANCH_CHAIN_COMPLETION_COINS;
}
export function formatHafverCoins(value: number | string | bigint): string {
  const amount = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return '金额超出安全范围';
  const compact = amount >= 1_000_000 ? `${(amount / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: amount % 10_000 ? 2 : 0 })}万`
    : amount >= 10_000 ? `${(amount / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}万`
    : amount.toLocaleString('zh-CN');
  return `${compact}（${amount.toLocaleString('zh-CN')}）`;
}

export const BOXES: Record<BoxId, { id: BoxId; title: string; price: number; pulls: number; pool: RewardPoolEntry[]; description: string }> = {
  'small-safe': { id: 'small-safe', title: '小保险', price: 200_000, pulls: 1, description: '一次随机回收，小紫为主，也可能出现高稀有度藏品。', pool: [
    { rarity: 'small-purple', probability: 0.52, quantity: 1 }, { rarity: 'small-gold', probability: 0.32, quantity: 1 }, { rarity: 'large-gold', probability: 0.12, quantity: 1 }, { rarity: 'small-red', probability: 0.035, quantity: 1 }, { rarity: 'large-red', probability: 0.005, quantity: 1 },
  ] },
  'large-safe': { id: 'large-safe', title: '大保险', price: 600_000, pulls: 1, description: '一次随机回收，中高稀有度藏品出现率更高。', pool: [
    { rarity: 'small-purple', probability: 0.15, quantity: 1 }, { rarity: 'small-gold', probability: 0.24, quantity: 1 }, { rarity: 'large-gold', probability: 0.30, quantity: 1 }, { rarity: 'small-red', probability: 0.22, quantity: 1 }, { rarity: 'large-red', probability: 0.09, quantity: 1 },
  ] },
};
export const CHALLENGES: Record<ChallengeTier, { title: string; entryFee: number; minutes: number; hintLimit: number; pool: RewardPoolEntry[] }> = {
  ordinary: { title: '普通学习挑战', entryFee: 100_000, minutes: 20, hintLimit: 2, pool: [{rarity:'small-purple',probability:.75,quantity:1},{rarity:'small-gold',probability:.20,quantity:1},{rarity:'large-gold',probability:.04,quantity:1},{rarity:'small-red',probability:.009,quantity:1},{rarity:'large-red',probability:.001,quantity:1}] },
  confidential: { title: '机密学习挑战', entryFee: 300_000, minutes: 35, hintLimit: 1, pool: [{rarity:'small-purple',probability:.35,quantity:1},{rarity:'small-gold',probability:.35,quantity:1},{rarity:'large-gold',probability:.20,quantity:1},{rarity:'small-red',probability:.08,quantity:1},{rarity:'large-red',probability:.02,quantity:1}] },
  'top-secret': { title: '绝密学习挑战', entryFee: 600_000, minutes: 50, hintLimit: 0, pool: [{rarity:'small-purple',probability:.15,quantity:1},{rarity:'small-gold',probability:.25,quantity:1},{rarity:'large-gold',probability:.27,quantity:1},{rarity:'small-red',probability:.23,quantity:1},{rarity:'large-red',probability:.10,quantity:1}] },
};
export function poolTotals(pool: RewardPoolEntry[]) { return pool.reduce((sum, entry) => sum + entry.probability, 0); }
export function poolExpectedRecovery(pool: RewardPoolEntry[]) { return pool.reduce((sum, entry) => {
  const rows = COLLECTION_CATALOG.filter(item => item.rarity === entry.rarity && isStandardPoolEligible(item));
  if (!rows.length) throw new Error(`Empty reward rarity: ${entry.rarity}`);
  return sum + entry.probability * rows.reduce((value, item) => value + item.sellPrice * entry.quantity, 0) / rows.length;
}, 0); }
// Free action success pays a fixed coin value equal to one tenth of the confidential pool's expected recovery.
export const FREE_CHALLENGE_REWARD_COINS = Math.floor(poolExpectedRecovery(CHALLENGES.confidential.pool) / 10);
function validatePool(id: string, pool: RewardPoolEntry[]) {
  if (Math.abs(poolTotals(pool) - 1) > 1e-12 || pool.some(entry => entry.probability < 0 || !Number.isFinite(entry.probability) || !Number.isInteger(entry.quantity) || entry.quantity < 1 || !COLLECTION_CATALOG.some(item => item.rarity === entry.rarity && isStandardPoolEligible(item)))) throw new Error(`Invalid probability configuration: ${id}`);
}
export function validateEconomy() {
  for (const [id, box] of Object.entries(BOXES)) {
    validatePool(id, box.pool);
    if (poolExpectedRecovery(box.pool) >= box.price) throw new Error(`Box EV must remain below its price: ${id}`);
  }
  const challenges=Object.fromEntries(Object.entries(CHALLENGES).map(([id,tier])=>{validatePool(id,tier.pool);const expectedRecovery=poolExpectedRecovery(tier.pool);if(expectedRecovery>=tier.entryFee)throw new Error(`Challenge reward EV must remain below its entry fee: ${id}`);return [id,{entryFee:tier.entryFee,expectedRecovery,poolTotal:poolTotals(tier.pool)}]}));
  if(COLLECTION_CATALOG.some(item=>{const [min,max]=RARITY_DISPLAY_VALUE_RANGES[item.rarity];return item.sellPrice>=item.displayValue||item.displayValue<min||item.displayValue>max||(item.limited&&item.sellable!==SEASONAL_ITEM_POLICY.sellable)}))throw new Error('Catalog price or seasonal sale policy is invalid');
  const rareOdds=(tier:ChallengeTier)=>CHALLENGES[tier].pool.filter(entry=>entry.rarity==='large-gold'||entry.rarity==='small-red'||entry.rarity==='large-red').reduce((sum,entry)=>sum+entry.probability,0);
  if(!(CHALLENGES.ordinary.entryFee<CHALLENGES.confidential.entryFee&&CHALLENGES.confidential.entryFee<CHALLENGES['top-secret'].entryFee&&rareOdds('ordinary')<rareOdds('confidential')&&rareOdds('confidential')<rareOdds('top-secret')))throw new Error('Challenge difficulty must scale with fee and rare-item odds');
  return {version:ECONOMY_VERSION,boxes:Object.fromEntries(Object.entries(BOXES).map(([id, box]) => [id, { price: box.price, expectedRecovery: poolExpectedRecovery(box.pool), poolTotal: poolTotals(box.pool) }])),challenges};
}
export const rarityBoxItem = (box: BoxId, version = ECONOMY_VERSION) => ({ id: `box-${box}-${version}`, itemId: `box-${box}-${version}`, name: BOXES[box].title, description: BOXES[box].description, rarity: 'common' as const, icon: '▣', quantity: 1 });
