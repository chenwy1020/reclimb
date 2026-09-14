import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TaskText} from '../src/companion/task-text';
describe('local companion task rendering',()=>{
 it('renders paragraphs, ordered steps, tables and supported math while retaining verbatim source',()=>{
  const source='# 阅读任务\n\n1. 比较 $x^2$ 与 $x$.\n2. 写出 \\(f(0)=0\\).\n\n| 条件 | 结果 |\n| --- | --- |\n| A | B |\n\n\\[ \\frac{1}{2} \\]';
  const html=renderToStaticMarkup(createElement(TaskText,{text:source}));expect(html).toContain('<ol>');expect(html).toContain('<table>');expect(html).toContain('katex');expect(html).toContain('查看原始文字与公式代码');expect(html).toContain('\\frac{1}{2}');
 });
 it('retains an invalid formula visibly rather than guessing or dropping it',()=>{const html=renderToStaticMarkup(createElement(TaskText,{text:'$\\badcommand{a}$'}));expect(html).toContain('公式暂不能排版，原式保留');expect(html).toContain('\\badcommand');});
 it('does not execute source HTML or create external-image, navigation or trusted-TeX endpoints',()=>{
  const source='<script>alert(1)</script>\n\n<img src="https://private.invalid/pixel" onerror="alert(2)">\n\n![外部图](https://private.invalid/image.png)\n\n[链接](javascript:alert(1))\n\n$\\href{https://private.invalid/leak}{x}$';
  const html=renderToStaticMarkup(createElement(TaskText,{text:source}));expect(html).not.toMatch(/<script|<img|<iframe|<a\s/);expect(html).not.toMatch(/(?:src|href)="(?:https?:|javascript:)/);expect(html).toContain('&lt;script&gt;');expect(html).toContain('[图片：外部图]');
 });
});
