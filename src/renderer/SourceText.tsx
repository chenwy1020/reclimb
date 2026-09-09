import type {Fragment} from '../shared/types';
import type {SourceTranscription} from '../shared/materials';
import {physicalPage} from '../shared/materials';

const likelyFormula=(line:string)=>{
 const value=line.trim();
 if(!value)return false;
 const operators=(value.match(/[=<>≤≥∈∉∑∫∞{}_[\]\\]/g)??[]).length;
 return operators>=2||(/^[A-Za-zΓγΦφI][^。！？]{0,100}[=<>≤≥∈∉]/.test(value)&&!/[。！？]$/.test(value));
};

export function reflowExtractedText(text:string):string{
 return text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(paragraph=>{
  const lines=paragraph.split('\n').map(line=>line.trim()).filter(Boolean);const output:string[]=[];let prose='';
  const flush=()=>{if(prose){output.push(prose);prose='';}};
  for(const line of lines){
   if(likelyFormula(line)){flush();output.push(line);continue;}
   if(!prose){prose=line;continue;}
   const joinWithoutSpace=/[\p{Script=Han}]$/u.test(prose)&&/^[\p{Script=Han}]/u.test(line);
   if(/[-‐‑]$/.test(prose)&&/^[a-z]/.test(line))prose=prose.slice(0,-1)+line;
   else prose+=(joinWithoutSpace?'':' ')+line;
  }
  flush();return output.join('\n');
 }).filter(Boolean).join('\n\n');
}

export function selectReadableSource(fragment:Fragment,transcriptions:SourceTranscription[]){
 const page=physicalPage(fragment),confirmed=transcriptions.filter(item=>item.status==='confirmed'&&!item.region&&item.fragmentId===fragment.id&&item.projectId===fragment.projectId&&item.materialId===fragment.materialId&&item.pageNumber===page).sort((a,b)=>b.version-a.version||b.createdAt.localeCompare(a.createdAt))[0];
 if(confirmed)return {kind:'confirmed' as const,text:confirmed.text,needsOriginal:false,transcriptionId:confirmed.id};
 return {kind:'raw' as const,text:fragment.text,needsOriginal:fragment.quality?.needsVerification===true};
}

export function PlainSourceText({text,reflow=true,className=''}:{text:string;reflow?:boolean;className?:string}){
 return <div className={'plain-source-text '+className}>{reflow?reflowExtractedText(text):text}</div>;
}
