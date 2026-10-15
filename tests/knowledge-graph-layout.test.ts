import {expect,it} from 'vitest';
import {layoutKnowledgeNodes} from '../src/renderer/knowledge-graph-layout';
it('keeps full labels and fits every node within the scrollable drawing',()=>{
 const label='旧材料学习 · 完整名称应该换行显示而不是截断为相同的前缀';
 const nodes=Array.from({length:16},(_,i)=>({id:'n'+i,kind:'evidence',label:label+i}));
 const layout=layoutKnowledgeNodes(nodes);
 for(const node of nodes){
  const position=layout.positions.get(node.id)!;
  expect(position.lines.join('')).toBe(node.label);
  expect(position.y+position.height).toBeLessThan(layout.height);
  expect(position.x+position.width).toBeLessThan(layout.width);
 }
 const first=layout.positions.get('n0')!,second=layout.positions.get('n1')!;
 expect(second.y-first.y).toBeGreaterThan(first.height+30);
});
it('keeps Unicode characters whole and separates columns for provenance types',()=>{
 const nodes=[{id:'source',kind:'fragment',label:'来源📚'.repeat(20)},{id:'attempt',kind:'attempt',label:'原作答'},{id:'evidence',kind:'evidence',label:'独立表现'}];
 const layout=layoutKnowledgeNodes(nodes);
 expect(layout.positions.get('source')!.lines.join('')).toBe(nodes[0].label);
 expect(layout.positions.get('source')!.lines.every(line=>!/[\uD800-\uDBFF]$/.test(line))).toBe(true);
 expect(layout.positions.get('attempt')!.x).toBeGreaterThan(layout.positions.get('source')!.x+layout.positions.get('source')!.width);
});
