import { COLLECTION_CATALOG, type CollectionRarity } from './catalog';

export type BoxId = 'small-safe' | 'large-safe';
export type ChallengeTier = 'ordinary' | 'confidential' | 'top-secret';
export interface RewardPoolEntry { rarity: CollectionRarity; probability: number; quantity: number }
export const ECONOMY_VERSION = '2026-10-v1';
export const LEARNING_COIN_RATE_PER_MINUTE = 0.65;
export function learningCoinsForMinutes(minutes:number){return Math.floor(minutes*LEARNING_COIN_RATE_PER_MINUTE);}
export function chainCoinsForMinutes(minutes:number,track:'main'|'branch'){return Math.floor(minutes*(track==='main'?0.1:0.05));}
export const BOXES: Record<BoxId, { id: BoxId; title: string; price: number; pulls: number; pool: RewardPoolEntry[]; description: string }> = {
  'small-safe': { id: 'small-safe', title: '小保险', price: 850, pulls: 1, description: '一次随机回收，常见结果为小紫藏品。', pool: [
    { rarity: 'small-purple', probability: 0.97, quantity: 1 }, { rarity: 'small-gold', probability: 0.025, quantity: 1 }, { rarity: 'large-gold', probability: 0.003, quantity: 1 }, { rarity: 'small-red', probability: 0.0018, quantity: 1 }, { rarity: 'large-red', probability: 0.0002, quantity: 1 },
  ] },
  'large-safe': { id: 'large-safe', title: '大保险', price: 1800, pulls: 1, description: '一次随机回收，小金与高稀有度藏品出现率更高。', pool: [
    { rarity: 'small-purple', probability: 0.8, quantity: 1 }, { rarity: 'small-gold', probability: 0.15, quantity: 1 }, { rarity: 'large-gold', probability: 0.03, quantity: 1 }, { rarity: 'small-red', probability: 0.018, quantity: 1 }, { rarity: 'large-red', probability: 0.002, quantity: 1 },
  ] },
};
export const CHALLENGES: Record<ChallengeTier, { title: string; entryFee: number; minutes: number; hintLimit: number; pool: RewardPoolEntry[] }> = {
  ordinary: { title: '普通学习挑战', entryFee: 900, minutes: 20, hintLimit: 2, pool: [{rarity:'small-purple',probability:.82,quantity:1},{rarity:'small-gold',probability:.16,quantity:1},{rarity:'large-gold',probability:.015,quantity:1},{rarity:'small-red',probability:.004,quantity:1},{rarity:'large-red',probability:.001,quantity:1}] },
  confidential: { title: '机密学习挑战', entryFee: 1850, minutes: 35, hintLimit: 1, pool: [{rarity:'small-purple',probability:.5,quantity:1},{rarity:'small-gold',probability:.35,quantity:1},{rarity:'large-gold',probability:.11,quantity:1},{rarity:'small-red',probability:.035,quantity:1},{rarity:'large-red',probability:.005,quantity:1}] },
  'top-secret': { title: '绝密学习挑战', entryFee: 3300, minutes: 50, hintLimit: 0, pool: [{rarity:'small-purple',probability:.2,quantity:1},{rarity:'small-gold',probability:.38,quantity:1},{rarity:'large-gold',probability:.25,quantity:1},{rarity:'small-red',probability:.14,quantity:1},{rarity:'large-red',probability:.03,quantity:1}] },
};
export function poolTotals(pool: RewardPoolEntry[]) { return pool.reduce((sum, entry) => sum + entry.probability, 0); }
export function poolExpectedRecovery(pool: RewardPoolEntry[]) { return pool.reduce((sum, entry) => {
  const rows = COLLECTION_CATALOG.filter(item => item.rarity === entry.rarity && (!item.limited || Boolean(item.seasonId)));
  if (!rows.length) throw new Error(`Empty reward rarity: ${entry.rarity}`);
  return sum + entry.probability * rows.reduce((value, item) => value + item.sellPrice * entry.quantity, 0) / rows.length;
}, 0); }
export function validateEconomy() {
  for (const [id, box] of Object.entries(BOXES)) {
    if (Math.abs(poolTotals(box.pool) - 1) > 1e-12 || box.pool.some(entry => entry.probability < 0 || !Number.isInteger(entry.quantity) || entry.quantity < 1)) throw new Error(`Invalid probability configuration: ${id}`);
    if (poolExpectedRecovery(box.pool) >= box.price) throw new Error(`Box EV must remain below its price: ${id}`);
  }
  const challenges=Object.fromEntries(Object.entries(CHALLENGES).map(([id,tier])=>{if(Math.abs(poolTotals(tier.pool)-1)>1e-12||tier.pool.some(entry=>entry.probability<0||!COLLECTION_CATALOG.some(item=>item.rarity===entry.rarity&&(!item.limited||Boolean(item.seasonId)))))throw new Error(`Invalid challenge pool: ${id}`);return [id,{entryFee:tier.entryFee,expectedRecovery:poolExpectedRecovery(tier.pool),poolTotal:poolTotals(tier.pool)}]}));
  if(COLLECTION_CATALOG.some(item=>item.sellPrice>=item.displayValue))throw new Error('Display value must exceed fixed recovery price');
  return {boxes:Object.fromEntries(Object.entries(BOXES).map(([id, box]) => [id, { price: box.price, expectedRecovery: poolExpectedRecovery(box.pool), poolTotal: poolTotals(box.pool) }])),challenges};
}
export const rarityBoxItem = (box: BoxId) => ({ id: `box-${box}-${ECONOMY_VERSION}`, itemId: `box-${box}-${ECONOMY_VERSION}`, name: BOXES[box].title, description: BOXES[box].description, rarity: 'common' as const, icon: '▣', quantity: 1 });
