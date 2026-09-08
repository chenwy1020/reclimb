import {describe,it,expect} from 'vitest';
import {reserveCost,monthSpend,assertAffordable} from '../src/main/budget';
describe('budget safety',()=>{
 it('counts outstanding and uncertain charges conservatively',()=>{const rows=[{createdAt:'2026-09-07',status:'completed',estimatedCny:2},{createdAt:'2026-09-07',status:'uncertain',estimatedCny:3},{createdAt:'2026-09-07',status:'reserved',estimatedCny:4},{createdAt:'2026-08-30',status:'completed',estimatedCny:50}];expect(monthSpend(rows as any,'2026-09')).toBe(9);});
 it('blocks missing budget and projected warning threshold',()=>{expect(()=>assertAffordable(0,0,1)).toThrow();expect(()=>assertAffordable(100,89,2)).toThrow();expect(()=>assertAffordable(100,20,1)).not.toThrow();});
 it('includes both input and bounded output in reservation',()=>{expect(reserveCost(1000,4000,10,30)).toBeGreaterThanOrEqual(.13);});
});

