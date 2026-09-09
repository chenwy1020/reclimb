import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {PlainSourceText,reflowExtractedText,selectReadableSource} from '../src/renderer/SourceText';

describe('source reading text',()=>{
 it('never interprets raw PDF plus signs or broken lines as Markdown lists',()=>{
  const raw='r = { g ∈ C([0,1],E)\n+ g(0)=0, g(1)=e }.\n2 + 3 = 5';
  const html=renderToStaticMarkup(createElement(PlainSourceText,{text:raw,reflow:false}));
  expect(html).toContain('+ g(0)=0');expect(html).not.toContain('<ul');expect(html).not.toContain('<li');expect(html).not.toContain('katex');
 });

 it('reflows reliable prose but preserves paragraph and likely formula boundaries',()=>{
  expect(reflowExtractedText('The mountain pass theorem\nconnects geometry with critical points.\n\nI\'(u)=0')).toBe('The mountain pass theorem connects geometry with critical points.\n\nI\'(u)=0');
 });

 it('uses only a confirmed whole-page transcription as the primary rich reading version',()=>{
  const fragment={id:'f',projectId:'p',materialId:'m',locator:'第 13 页',pageNumber:13,ordinal:0,text:'broken + OCR',quality:{kind:'ocr-text' as const,needsVerification:true,reasons:['公式未核对']}};
  const machine={id:'machine',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:13,version:1,text:'machine text',status:'machine' as const,origin:'machine' as const,createdAt:'2026-09-09T00:00:00Z',uncertainties:[]};
  expect(selectReadableSource(fragment,[machine])).toMatchObject({kind:'raw',text:'broken + OCR',needsOriginal:true});
  const confirmed={...machine,id:'confirmed',version:2,status:'confirmed' as const,origin:'manual' as const,text:'$c=\\inf_{g\\in\\Gamma}\\max I(g(t))$',confirmedAt:'2026-09-09T00:01:00Z'};
  expect(selectReadableSource(fragment,[machine,confirmed])).toMatchObject({kind:'confirmed',text:confirmed.text,needsOriginal:false,transcriptionId:'confirmed'});
 });
});
