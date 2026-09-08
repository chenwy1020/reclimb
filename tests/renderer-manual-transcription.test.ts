import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import ManualTranscription from '../src/renderer/ManualTranscription';
it('a PDF page offers manual transcription without an AI service or existing machine version',()=>{
 const html=renderToStaticMarkup(createElement(ManualTranscription,{fragment:{id:'f',materialId:'m',projectId:'p',pageNumber:13,printedPageLabel:'4',locator:'PDF 13',text:'',ordinal:13},run:async()=>null}));
 expect(html).toContain('手工录入文字与公式');expect(html).not.toContain('API');
});
