import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {VerificationSummary} from '../src/renderer/Reliability';
import type {VerificationView} from '../src/shared/reliability';
const base={teachingVersionId:'v',contentHash:'hash',blockingReasons:[]} satisfies Partial<VerificationView>;
it('pending verification preserves a local-record path while excluding evidence',()=>{const html=renderToStaticMarkup(createElement(VerificationSummary,{view:{...base,status:'pending',effectiveStatus:'pending',summary:'尚待核验',canAssess:false}}));expect(html).toContain('尚待核验');expect(html).toContain('暂不进行能力评价');expect(html).toContain('仍可提交并保存');expect(html).not.toContain('可以提交评价')});
it('ready verification explicitly retains its limits rather than certifying correctness',()=>{const html=renderToStaticMarkup(createElement(VerificationSummary,{view:{...base,status:'ready',effectiveStatus:'ready',reportedStatus:'ready',summary:'条件已检查',canAssess:true}}));expect(html).toContain('可以提交评价');expect(html).toContain('不保证内容无误')});
it('a raw model pass does not hide a program source blocker',()=>{const html=renderToStaticMarkup(createElement(VerificationSummary,{view:{...base,status:'uncertain',effectiveStatus:'uncertain',reportedStatus:'ready',summary:'关键来源仍未核对',canAssess:false,blockingReasons:[{code:'source_unverified',message:'关键公式需要核对',sourceId:'f',locator:'PDF 第13页'}]}}));expect(html).toContain('模型原始判断');expect(html).toContain('核验通过');expect(html).toContain('关键公式需要核对');expect(html).toContain('查看对应原文');expect(html).not.toContain('可以提交评价')});
