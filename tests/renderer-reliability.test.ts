import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {VerificationSummary} from '../src/renderer/Reliability';
it('a pending verification never presents a task as ready for assessment',()=>{const html=renderToStaticMarkup(createElement(VerificationSummary,{view:{teachingVersionId:'v',contentHash:'hash',status:'pending',summary:'尚待核验',canAssess:false}}));expect(html).toContain('尚待核验');expect(html).toContain('暂不进行能力评价');expect(html).not.toContain('可以提交评价')});
it('ready verification explicitly retains its limits rather than certifying correctness',()=>{const html=renderToStaticMarkup(createElement(VerificationSummary,{view:{teachingVersionId:'v',contentHash:'hash',status:'ready',summary:'条件已检查',canAssess:true}}));expect(html).toContain('可以提交评价');expect(html).toContain('不保证内容无误')});
