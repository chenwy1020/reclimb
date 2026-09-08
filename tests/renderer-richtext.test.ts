import {describe,it,expect} from 'vitest';
import {normalizeMathDelimiters} from '../src/renderer/RichText';

describe('模型文字中的换行与数学命令',()=>{
  it('普通中文文字的字面换行会变成真正换行',()=>{
    expect(normalizeMathDelimiters(String.raw`第一段\n\n第二段\r\n第三段`)).toBe('第一段\n\n第二段\n第三段');
  });
  it('不改写以n开头的TeX命令',()=>{
    const text=String.raw`公式 $\nu+\nabla u$；定义 $\newcommand{\foo}{x}$`;
    expect(normalizeMathDelimiters(text)).toBe(text);
  });
  it('代码块和行内代码保留字面的换行及数学分隔符',()=>{
    const inline='`'+String.raw`\n\r\n\(\nu\)`+'`';
    const fenced='```text\n'+String.raw`\n\r\n\[\nabla u\]`+'\n```';
    expect(normalizeMathDelimiters(inline+'\n'+fenced)).toBe(inline+'\n'+fenced);
  });
});
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RichText} from '../src/renderer/RichText';

it('真实functional公式保持命令与换行并正常呈现',()=>{
  const text=String.raw`写成记号就是
$$
c_0=\min_{\gamma\in\Gamma_0}M(\gamma),\quad M(\gamma)=\max_{x\in\gamma}\;E(x).
$$

先只看内层：$M(\gamma)$ 概括沿这条路最高到过哪里。`;
  expect(normalizeMathDelimiters(text)).toBe(text);
  const html=renderToStaticMarkup(createElement(RichText,{text}));
  expect(html).toContain('katex-display');
  expect(html).toContain('γ');
  expect(html).not.toContain('katex-error');
});
