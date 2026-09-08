import {useEffect,useState} from 'react';
import {ChevronDown,PenLine,ShieldCheck} from 'lucide-react';
import type {Fragment} from '../shared/types';
import type {SourceRegion} from '../shared/materials';
import {Button,type Run} from './ui';
import {RichText} from './RichText';
export default function ManualTranscription({fragment,region,run}:{fragment:Fragment;region?:SourceRegion;run:Run}){
 const[open,setOpen]=useState(false),[text,setText]=useState(''),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const regionKey=JSON.stringify(region);
 useEffect(()=>{setOpen(false);setText('');setConfirmed(false);setError('')},[fragment.id,regionKey]);
 if(!fragment.pageNumber)return null;
 return <div className="manual-transcription">{!open?<Button onClick={()=>setOpen(true)}><PenLine size={14}/>手工录入文字与公式</Button>:<section className="manual-transcription-editor" aria-label="手工转录"><div className="section-heading"><h3><PenLine size={15}/>对照原页，亲自录入</h3><span className="badge">实际页 {fragment.pageNumber}{fragment.printedPageLabel?' · 印刷页 '+fragment.printedPageLabel:''}</span></div><p className="muted">本次保存{region?'所选区域':'这一页'}的人工转录，原始材料和旧版本都保留。可使用 Markdown 与数学公式；整个过程在本机完成。</p><label className="form-label">文字与公式<textarea aria-label="手工转录文字与公式" rows={8} value={text} onChange={e=>{setText(e.target.value);setConfirmed(false)}} placeholder="对照原页输入；行内公式用 $…$，独立公式用 $$…$$。"/></label><details className="transcription-render-preview"><summary>预览文字与公式<ChevronDown size={14}/></summary><RichText text={text}/></details><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已对照原页，确认这些文字及公式。</label>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="transcription-actions"><Button disabled={saving} onClick={()=>setOpen(false)}>暂不保存</Button><Button variant="primary" disabled={saving||!confirmed||!text.trim()} onClick={async()=>{setSaving(true);setError('');try{const next=await run('material.manualTranscription',{fragmentId:fragment.id,pageNumber:fragment.pageNumber,text,region,confirmed:true},'人工转录已保存为新的确认版本。');if(next){setOpen(false);setText('');setConfirmed(false)}else setError('本次转录尚未保存，输入仍然保留，请重试。')}finally{setSaving(false)}}}><ShieldCheck size={14}/>保存手工转录版本</Button></div></section>}</div>
}
