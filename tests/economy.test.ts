import { describe,expect,it } from 'vitest';
import { CATALOG_RARITY_COUNTS,COLLECTION_CATALOG } from '../shared/catalog';
import { BOXES,CHALLENGES,chainCompletionCoins,formatHafverCoins,learningCoinsForMinutes,poolExpectedRecovery,poolTotals,validateEconomy } from '../shared/economy';

describe('versioned economy rules',()=>{
  it('keeps the published 155-item collection and every display value above fixed recovery',()=>{
    expect(COLLECTION_CATALOG).toHaveLength(155);
    expect(CATALOG_RARITY_COUNTS).toEqual({'small-purple':45,'small-gold':35,'large-gold':15,'small-red':35,'large-red':25});
    expect(COLLECTION_CATALOG.every(item=>item.displayValue>item.sellPrice&&Math.abs(item.sellPrice/item.displayValue-.65)<0.00006)).toBe(true);
    const ranges:Record<string,[number,number]>={'small-purple':[20_000,80_000],'small-gold':[100_000,300_000],'large-gold':[400_000,900_000],'small-red':[600_000,1_000_000],'large-red':[1_000_000,2_000_000]};
    for(const [rarity,[min,max]] of Object.entries(ranges)){const items=COLLECTION_CATALOG.filter(item=>item.rarity===rarity);expect(Math.min(...items.map(item=>item.displayValue))).toBe(min);expect(Math.max(...items.map(item=>item.displayValue))).toBe(max);}
  });
  it('validates exact full-pool recovery expectation below each box price',()=>{
    const result=validateEconomy();
    for(const box of Object.values(BOXES)){
      expect(poolTotals(box.pool)).toBeCloseTo(1, 12);
      expect(result.boxes[box.id].expectedRecovery).toBe(poolExpectedRecovery(box.pool));
      expect(result.boxes[box.id].expectedRecovery).toBeLessThan(box.price);
      expect(box.pool.every(entry=>entry.quantity>0&&entry.probability>=0)).toBe(true);
    }
    expect(BOXES['small-safe'].price).toBe(200_000);
    expect(BOXES['large-safe'].price).toBe(600_000);
    expect(result.boxes['small-safe'].expectedRecovery).toBeGreaterThanOrEqual(130_000);
    expect(result.boxes['small-safe'].expectedRecovery).toBeLessThanOrEqual(150_000);
    expect(result.boxes['small-safe'].expectedRecovery).toBeCloseTo(132_274.557, 3);
    expect(result.boxes['large-safe'].expectedRecovery).toBeGreaterThanOrEqual(360_000);
    expect(result.boxes['large-safe'].expectedRecovery).toBeLessThanOrEqual(450_000);
    expect(result.boxes['large-safe'].expectedRecovery).toBeCloseTo(364_974.574, 3);
  });
  it('raises entry fee and rarer reward probabilities with challenge difficulty',()=>{
    const tiers=Object.values(CHALLENGES);
    expect(tiers.map(tier=>tier.entryFee)).toEqual([100_000,300_000,600_000]);
    expect(tiers.every(tier=>Math.abs(poolTotals(tier.pool)-1)<1e-12)).toBe(true);
    const rare=(id:string)=>CHALLENGES[id as keyof typeof CHALLENGES].pool.filter(row=>row.rarity==='large-gold'||row.rarity==='small-red'||row.rarity==='large-red').reduce((sum,row)=>sum+row.probability,0);
    expect(rare('ordinary')).toBeLessThan(rare('confidential'));
    expect(rare('confidential')).toBeLessThan(rare('top-secret'));
    expect(tiers.every(tier=>poolExpectedRecovery(tier.pool)<tier.entryFee)).toBe(true);
    expect(poolExpectedRecovery(CHALLENGES.ordinary.pool)).toBeCloseTo(72_929.555,3);
    expect(poolExpectedRecovery(CHALLENGES.confidential.pool)).toBeCloseTo(202_474.561,3);
    expect(poolExpectedRecovery(CHALLENGES['top-secret'].pool)).toBeCloseTo(368_549.574,3);
  });
  it('scales daily learning currency with minutes rather than task count',()=>{
    expect(learningCoinsForMinutes(20)).toBe(130_000);
    expect(learningCoinsForMinutes(45)).toBe(292_500);
    expect(learningCoinsForMinutes(60)).toBe(390_000);
    expect(learningCoinsForMinutes(1)).toBe(6_500);
    expect(chainCompletionCoins('main')).toBe(60_000);
    expect(chainCompletionCoins('branch')).toBe(0);
    expect(formatHafverCoins(130_000)).toBe('13万（130,000）');
    expect(formatHafverCoins(1_200_000)).toBe('120万（1,200,000）');
    expect(learningCoinsForMinutes(60)).toBeLessThan(BOXES['large-safe'].price);
  });
});
