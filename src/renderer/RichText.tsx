import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/** Normalize common TeX delimiters and literal newlines only outside fenced and inline code. */
export function normalizeMathDelimiters(text: string): string {
  return text.split(/(\x60{3}[\s\S]*?\x60{3}|\x60[^\x60\n]*\x60)/g).map((piece, i) => i % 2 ? piece : piece
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n(?![A-Za-z])/g, '\n')
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => '\n$$\n' + math.trim() + '\n$$\n')
    .replace(/\\\(([^\n]*?)\\\)/g, (_, math: string) => '$' + math + '$')).join('');
}

export function RichText({text, className=''}: {text?: string; className?: string}) {
  if (!text) return null;
  return <div className={'rich-text '+className}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex,{trust:false,throwOnError:false,strict:'ignore',maxExpand:1000}]]}
      skipHtml
      urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}
      components={{
        a: ({children,href}) => href ? <button className="markdown-link" title={'复制链接：'+href} onClick={() => void navigator.clipboard.writeText(href)}>{children}<span aria-hidden="true"> ↗</span></button> : <span>{children}</span>,
        img: ({alt}) => <span className="markdown-image-placeholder">[图片：{alt || '请返回原始材料查看'}]</span>,
        table: ({children}) => <div className="markdown-table"><table>{children}</table></div>,
        input: ({checked}) => <span aria-label={checked?'已选':'未选'}>{checked?'☑':'☐'}</span>,
      }}
    >{normalizeMathDelimiters(text)}</ReactMarkdown>
  </div>;
}
