import { describe,expect,it } from 'vitest';
import { CATALOG_RARITY_COUNTS,COLLECTION_CATALOG } from '../shared/catalog';
import { BOXES,CHALLENGES,chainCoinsForMinutes,learningCoinsForMinutes,poolExpectedRecovery,poolTotals,validateEconomy } from '../shared/economy';

describe('versioned economy rules',()=>{
  it('keeps the published 155-item collection and every display value above fixed recovery',()=>{
    expect(COLLECTION_CATALOG).toHaveLength(155);
    expect(CATALOG_RARITY_COUNTS).toEqual({'small-purple':45,'small-gold':35,'large-gold':15,'small-red':35,'large-red':25});
    expect(COLLECTION_CATALOG.every(item=>item.displayValue>item.sellPrice)).toBe(true);
  });
  it('validates exact full-pool recovery expectation below each box price',()=>{
    const result=validateEconomy();
    for(const box of Object.values(BOXES)){
      expect(poolTotals(box.pool)).toBe(1);
      expect(result.boxes[box.id].expectedRecovery).toBe(poolExpectedRecovery(box.pool));
      expect(result.boxes[box.id].expectedRecovery).toBeLessThan(box.price);
      expect(box.pool.every(entry=>entry.quantity>0&&entry.probability>=0)).toBe(true);
    }
    expect(result.boxes['small-safe'].expectedRecovery).toBeCloseTo(615.559,6);
    expect(result.boxes['large-safe'].expectedRecovery).toBeCloseTo(980.09,6);
  });
  it('raises entry fee and rarer reward probabilities with challenge difficulty',()=>{
    const tiers=Object.values(CHALLENGES);
    expect(tiers.map(tier=>tier.entryFee)).toEqual([900,1850,3300]);
    expect(tiers.every(tier=>poolTotals(tier.pool)===1)).toBe(true);
    const rare=(id:string)=>CHALLENGES[id as keyof typeof CHALLENGES].pool.filter(row=>row.rarity==='large-gold'||row.rarity==='small-red'||row.rarity==='large-red').reduce((sum,row)=>sum+row.probability,0);
    expect(rare('ordinary')).toBeLessThan(rare('confidential'));
    expect(rare('confidential')).toBeLessThan(rare('top-secret'));
    expect(tiers.every(tier=>poolExpectedRecovery(tier.pool)<tier.entryFee)).toBe(true);
  });
  it('scales daily learning currency with minutes rather than task count',()=>{
    expect(learningCoinsForMinutes(20)).toBe(13);
    expect(learningCoinsForMinutes(45)).toBe(29);
    expect(learningCoinsForMinutes(1)).toBe(0);
    expect(chainCoinsForMinutes(20,'main')).toBe(2);
    expect(chainCoinsForMinutes(20,'branch')).toBe(1);
    expect(learningCoinsForMinutes(20)).toBeLessThan(BOXES['small-safe'].price);
    expect(learningCoinsForMinutes(45)).toBeLessThan(BOXES['small-safe'].price);
  });
});
