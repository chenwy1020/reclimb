import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import { normalizeMathDelimiters } from '../shared/math-text';
import 'katex/dist/katex.min.css';
import './task-text.css';

type MathNode = { type: string; value?: string; children?: MathNode[]; data?: unknown };
// KaTeX can paint an unknown command red without failing the whole render. Keep
// those formulas explicit and verbatim instead of presenting them as typeset math.
function remarkMathFallback() {
  return (tree: MathNode) => {
    const walk = (node: MathNode) => {
      if ((node.type === 'math' || node.type === 'inlineMath') && node.value) {
        try {
          katex.renderToString(node.value, {
            trust: false,
            throwOnError: true,
            strict: 'ignore',
            maxExpand: 1000,
            maxSize: 20,
          });
        } catch {
          node.type = node.type === 'math' ? 'code' : 'inlineCode';
          node.value += '\n公式暂不能排版，原式保留';
          delete node.data;
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

export function TaskMarkdown({ text }: { text: string }) {
  return (
    <div className="task-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkMathFallback]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }],
        ]}
        skipHtml
        urlTransform={() => ''}
        components={{
          a: ({ children }) => (
            <span>
              {children} <small>（链接见原文）</small>
            </span>
          ),
          img: ({ alt }) => (
            <span className="task-media-placeholder">[图片：{alt || '请在电脑核对原材料'}]</span>
          ),
          table: ({ children }) => (
            <div className="task-table">
              <table>{children}</table>
            </div>
          ),
          input: ({ checked }) => (
            <span aria-label={checked ? '已选' : '未选'}>{checked ? '☑' : '☐'}</span>
          ),
          span: ({ children, className, node: _node, ...props }) =>
            className?.split(' ').includes('katex-error') ? (
              <span className="task-math-error" role="note">
                <code>{children}</code>
                <small>公式暂不能排版，原式保留</small>
              </span>
            ) : (
              <span {...props} className={className}>
                {children}
              </span>
            ),
        }}
      >
        {normalizeMathDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}
class TaskErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="status">这段任务暂不能排版，请展开下方原始文字继续阅读。</p>
    ) : (
      this.props.children
    );
  }
}
/** Frozen task text stays available even when Markdown/TeX cannot be rendered. */
export function TaskText({ text }: { text: string }) {
  return (
    <>
      <TaskErrorBoundary key={text}>
        <TaskMarkdown text={text} />
      </TaskErrorBoundary>
      <details className="task-raw">
        <summary>查看原始文字与公式代码</summary>
        <pre>{text}</pre>
      </details>
    </>
  );
}
const roots = new WeakMap<HTMLElement, Root>();
export function renderTaskText(element: HTMLElement, text: string) {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(<TaskText text={text} />);
}
