import ManualTranscription from './ManualTranscription';
import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy} from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {ArrowLeft,ArrowRight,Crop,FileSearch,LoaderCircle,Minus,Plus,RotateCcw,Sparkles,X} from 'lucide-react';
import type {Fragment,Material,WorkspaceSnapshot} from '../shared/types';
import type {SourceRegion} from '../shared/materials';
import {Badge,Button,type Run} from './ui';
GlobalWorkerOptions.workerSrc=pdfWorker;

export default function PdfPageViewer({material,fragment,snapshot,run,onPageChange}:{material:Material;fragment?:Fragment;snapshot:WorkspaceSnapshot;run:Run;onPageChange?:(page:number)=>void}) {
  const[document,setDocument]=useState<PDFDocumentProxy|null>(null);
  const[page,setPage]=useState(fragment?.pageNumber||1);const[zoom,setZoom]=useState(1);
  const[loading,setLoading]=useState(false);const[rendering,setRendering]=useState(false);const[error,setError]=useState('');
  const[width,setWidth]=useState(600);const[selecting,setSelecting]=useState(false);const[region,setRegion]=useState<SourceRegion|null>(null);
  const[preview,setPreview]=useState<{image:string;region?:SourceRegion}|null>(null);const[transcribing,setTranscribing]=useState(false);
  const box=useRef<HTMLDivElement>(null);const canvas=useRef<HTMLCanvasElement>(null);const dragStart=useRef<{x:number;y:number}|null>(null);
  useEffect(()=>{setPage(fragment?.pageNumber||1);setRegion(null);setZoom(1)},[material.id,fragment?.pageNumber]);
  useEffect(()=>{const el=box.current;if(!el)return;const observer=new ResizeObserver(entries=>setWidth(Math.max(240,entries[0].contentRect.width-24)));observer.observe(el);return()=>observer.disconnect()},[]);
  useEffect(()=>{let active=true;let task:ReturnType<typeof getDocument>|undefined;setLoading(true);setDocument(null);setError('');
    void window.learning.request<{data:Uint8Array|number[]}>('material.pdfBytes',{materialId:material.id}).then(async result=>{if(!active)return;const resources=new URL('./pdf-assets/',window.location.href).href;task=getDocument({data:new Uint8Array(result.data),useSystemFonts:true,cMapUrl:resources+'cmaps/',cMapPacked:true,standardFontDataUrl:resources+'standard_fonts/',wasmUrl:resources+'wasm/'});const doc=await task.promise;if(active)setDocument(doc)}).catch(e=>{if(active)setError('原页尚未打开：'+String(e.message||e))}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false;void task?.destroy()};
  },[material.id]);
  useEffect(()=>{if(!document||!canvas.current)return;let active=true;let renderTask:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
    setRendering(true);setError('');delete canvas.current.dataset.renderedPage;
    void document.getPage(Math.min(page,document.numPages)).then(pdfPage=>{if(!active||!canvas.current)return;const natural=pdfPage.getViewport({scale:1});const scale=(width/natural.width)*zoom;const viewport=pdfPage.getViewport({scale});const dpr=Math.min(window.devicePixelRatio||1,2);const target=canvas.current;target.width=Math.round(viewport.width*dpr);target.height=Math.round(viewport.height*dpr);target.style.width=viewport.width+'px';target.style.height=viewport.height+'px';renderTask=pdfPage.render({canvas:target,viewport,transform:dpr===1?undefined:[dpr,0,0,dpr,0,0]});return renderTask.promise.then(()=>{if(active)target.dataset.renderedPage=String(page)})}).catch(e=>{if(active&&e?.name!=='RenderingCancelledException')setError('这一页暂时无法呈现：'+String(e.message||e))}).finally(()=>{if(active)setRendering(false)});
    return()=>{active=false;renderTask?.cancel()};
  },[document,page,width,zoom]);
  const details=material.pdfMetadata?.pages.find(p=>p.pageNumber===page);
  const total=document?.numPages||material.pdfMetadata?.pageCount||1;
  function changePage(next:number){setPage(next);setRegion(null);onPageChange?.(next)}
  function point(event:React.PointerEvent<HTMLDivElement>){const bounds=canvas.current?.getBoundingClientRect();return bounds?{x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))}:null}
  function capture(){if(!canvas.current||rendering)return;const original=canvas.current;const selected=region&&region.width>.005&&region.height>.005?region:undefined;const crop=window.document.createElement('canvas');const sx=selected?Math.floor(selected.x*original.width):0,sy=selected?Math.floor(selected.y*original.height):0,sw=selected?Math.max(1,Math.floor(selected.width*original.width)):original.width,sh=selected?Math.max(1,Math.floor(selected.height*original.height)):original.height;const factor=Math.min(1,1800/Math.max(sw,sh));crop.width=Math.max(1,Math.round(sw*factor));crop.height=Math.max(1,Math.round(sh*factor));const context=crop.getContext('2d');if(!context)return;context.fillStyle='#fff';context.fillRect(0,0,crop.width,crop.height);context.drawImage(original,sx,sy,sw,sh,0,0,crop.width,crop.height);setPreview({image:crop.toDataURL('image/png'),region:selected})}
  const vision=snapshot.settings.vision;
  const pageFragment=snapshot.fragments.find(f=>f.materialId===material.id&&f.pageNumber===page)||(fragment?.pageNumber===page?fragment:undefined);
  return <section className="pdf-viewer"><div className="pdf-controls"><div className="pdf-pages"><Button variant="ghost" disabled={page<=1||loading} onClick={()=>changePage(page-1)} aria-label="上一原始页"><ArrowLeft size={14}/></Button><label>PDF 第 <input aria-label="PDF 实际页码" type="number" min={1} max={total} value={page} onChange={e=>{const value=Number(e.target.value);if(value>=1&&value<=total)changePage(value)}}/> / {total} 页</label><Button variant="ghost" disabled={page>=total||loading} onClick={()=>changePage(page+1)} aria-label="下一原始页"><ArrowRight size={14}/></Button></div><div className="pdf-zoom"><button className="icon-button" aria-label="缩小原页" disabled={zoom<=.6} onClick={()=>setZoom(z=>Math.max(.5,z-.25))}><Minus size={14}/></button><span>{Math.round(zoom*100)}%</span><button className="icon-button" aria-label="放大原页" disabled={zoom>=3} onClick={()=>setZoom(z=>Math.min(3,z+.25))}><Plus size={14}/></button><button className="icon-button" title="适合宽度" onClick={()=>setZoom(1)}><RotateCcw size={13}/></button></div></div>
    <div className="pdf-page-label"><Badge>实际页 {page}</Badge>{(details?.printedPageLabel||(fragment?.pageNumber===page?fragment.printedPageLabel:undefined))&&<Badge tone="green">印刷页 {details?.printedPageLabel||(fragment?.pageNumber===page?fragment.printedPageLabel:undefined)}</Badge>}<span>原始 PDF 的真实页面</span></div>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div ref={box} className="pdf-canvas-scroll">{loading?<div className="pdf-loading"><LoaderCircle className="spin" size={24}/><p>正在本机打开原始 PDF…</p></div>:<div className={'pdf-canvas-wrap '+(selecting?'selecting':'')} onPointerDown={e=>{if(!selecting||rendering)return;const start=point(e);if(start){dragStart.current=start;setRegion({x:start.x,y:start.y,width:0,height:0});e.currentTarget.setPointerCapture(e.pointerId)}}} onPointerMove={e=>{if(!dragStart.current)return;const end=point(e);if(end){const start=dragStart.current;setRegion({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)})}}} onPointerUp={e=>{dragStart.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}><canvas ref={canvas} aria-label={'PDF 第 '+page+' 页原始图像'}/>{region&&<div className="pdf-region" style={{left:region.x*100+'%',top:region.y*100+'%',width:region.width*100+'%',height:region.height*100+'%'}}/>}{rendering&&<span className="pdf-rendering"><LoaderCircle className="spin" size={15}/>呈现中</span>}</div>}</div>
    <div className="pdf-source-actions"><Button disabled={loading||rendering} variant={selecting?'primary':'secondary'} onClick={()=>{setSelecting(!selecting);if(selecting)setRegion(null)}}><Crop size={14}/>{selecting?'结束框选':'框选一处'}</Button><Button disabled={loading||rendering||!pageFragment} onClick={capture}><FileSearch size={14}/>{region?'识别选中区域':'重建这一页的可读原文'}</Button></div>
    {pageFragment&&<ManualTranscription fragment={pageFragment} region={region&&region.width>.005&&region.height>.005?region:undefined} run={run}/>}
    <p className="pdf-source-note">框选公式或段落可减少发送内容。识别先生成待核对版本，原件与原始提取文字始终保留。</p>
    {preview&&<div className="transcribe-preview" role="dialog" aria-label="确认原文识别"><div className="section-heading"><h3><Sparkles size={16}/>识别前，核对发送范围</h3><button className="icon-button" aria-label="取消识别" disabled={transcribing} onClick={()=>setPreview(null)}><X size={17}/></button></div><img src={preview.image} alt={'即将识别的 PDF 第 '+page+' 页'+(preview.region?'所选区域':'')}/><p>将发送上面这张{preview.region?'选区':'页面'}图像给 {vision?.providerName||'尚未配置的识别服务'}。{vision?.model?'模型：'+vision.model+'。':''}这是单独的付费调用，计入本机预算；返回内容需要你对照原页核验。</p>{!vision?.enabled||!vision.hasApiKey?<p className="inline-error">请先在设置中启用独立的图像识别服务并配置密钥。原页阅读不需要这项服务。</p>:null}<div className="modal-footer"><Button disabled={transcribing} onClick={()=>setPreview(null)}>取消</Button><Button variant="primary" disabled={transcribing||!vision?.enabled||!vision.hasApiKey||!pageFragment} onClick={async()=>{if(!pageFragment)return;setTranscribing(true);const next=await run('material.transcribe',{fragmentId:pageFragment.id,pageNumber:page,region:preview.region});setTranscribing(false);if(next)setPreview(null);else setError('识别未完成。原页和已有转录仍然保留，请查看错误提示后重试。')}}>{transcribing?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>}发送图像并识别</Button></div></div>}
  </section>
}






