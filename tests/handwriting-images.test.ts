import {afterEach,expect,it} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inkPageSchema,inkPagesSchema} from '../src/shared/handwriting';
import {inkPageDataUrl} from '../src/shared/ink-svg';
import {LearningStore} from '../src/main/store';
import {HandwritingService} from '../src/main/handwriting-service';
import {renderHandwritingImages} from '../src/main/handwriting-recognition';
import {writeBackup,readBackup,prepareRestore} from '../src/main/backup';
import {seedSamples} from '../src/main/samples';
import {createDraft,freezeSubmission,exportDraft,snapshotDraft} from '../src/companion/draft';
import {importDraft} from '../src/companion/import-draft';
import {readableExport} from '../src/main/readable-export';
const stores:LearningStore[]=[];afterEach(()=>stores.splice(0).forEach(store=>store.close()));
function imagePage(kind:'png'|'jpeg'='png') {const c=createCanvas(320,180),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,320,180);ctx.fillStyle='black';ctx.fillText('f(x) = x^2; f(2) = 4',10,60);const bytes=kind==='png'?c.encodeSync('png'):c.encodeSync('jpeg');return {id:'image-'+kind,width:768 as const,height:1024 as const,strokes:[],image:{dataUrl:'data:image/'+kind+';base64,'+bytes.toString('base64'),width:320,height:180}};}
async function fixture(){const path=mkdtempSync(join(tmpdir(),'reclimb-images-')),store=await LearningStore.open(path);stores.push(store);seedSamples(store);const service=new HandwritingService(store),target=service.target('sample-reasoning-session');return {path,store,service,target};}
it('accepts screenshot pages while retaining old vector page shape',()=>{expect(inkPageSchema.parse(imagePage())).toEqual(imagePage());expect(inkPageSchema.parse({id:'p',width:768,height:1024,strokes:[]})).toEqual({id:'p',width:768,height:1024,strokes:[]});});
it('rejects URLs, SVG, forged dimensions, oversized pixels and mixed ink/image pages',()=>{const p=imagePage();for(const image of [{...p.image,dataUrl:'https://example.com/private.png'},{...p.image,dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'},{...p.image,width:321},{...p.image,dataUrl:'data:image/png;base64,AAAA'},{...p.image,width:100000}])expect(inkPageSchema.safeParse({...p,image}).success).toBe(false);expect(inkPageSchema.safeParse({...p,strokes:[{id:'s',color:'#253e31',width:2,points:[{x:.1,y:.2,pressure:.5}]}]}).success).toBe(false);});
it('rejects excessive encoded image sizes before parsing or storing',()=>{const p=imagePage();expect(inkPageSchema.safeParse({...p,image:{...p.image,dataUrl:'data:image/png;base64,'+'A'.repeat(9*1024*1024)}}).success).toBe(false);expect(inkPagesSchema.safeParse(Array.from({length:13},(_,i)=>({...p,id:String(i)}))).success).toBe(false);});
it('freezes selected screenshots, preserves pending payload through export/import and excludes later changes',async()=>{const {target}=await fixture(),draft=createDraft('space',target);draft.pages=[imagePage() as any];draft.pageId=draft.pages[0].id;const frozen=freezeSubmission(draft,'image-submit');const snap=snapshotDraft(draft);draft.pages.push(imagePage('jpeg') as any);expect(freezeSubmission(draft)).toEqual(frozen);expect(snap.pages).toHaveLength(1);const restored=importDraft(exportDraft(draft),'space');expect(restored.pending).toEqual(frozen);expect(restored.pages).toHaveLength(2);});
it('saves pictures without a key or evidence, retries once and binds to original target after task switch',async()=>{const {store,service,target}=await fixture(),old=store.get('sessions',target.sessionId)!;store.put('sessions',{...old,draft:'keep me',activity:{...old.activity,id:'new-task'}});const body={requestId:'images',targetId:target.id,pages:[imagePage()],note:''},receipt=service.save(body);expect(service.save(body)).toEqual(receipt);expect(store.list('handwritings')).toHaveLength(1);expect(store.list('handwritings')[0].pages).toEqual(body.pages);expect(store.list('evidence')).toHaveLength(0);expect(store.list('usage')).toHaveLength(0);expect(store.get('sessions',target.sessionId)?.draft).toBe('keep me');expect(JSON.stringify(service.list(target.sessionId))).not.toContain('data:image');expect(()=>service.save({...body,pages:[imagePage('jpeg')]})).toThrow(/编号/);});
it('displays exact originals and rasterizes both PNG and JPEG without flattening their aspect ratio',async()=>{const {store,service,target}=await fixture(),pages=[imagePage(),imagePage('jpeg')];const receipt=service.save({requestId:'render',targetId:target.id,pages,note:''});for(const p of pages)expect(inkPageDataUrl(p as any)).toBe(p.image.dataUrl);const rendered=await renderHandwritingImages(store.get('handwritings',receipt.id)!);expect(rendered).toHaveLength(2);const {loadImage}=await import('@napi-rs/canvas');for(const img of rendered){const decoded=await loadImage(img.dataUrl);expect(decoded.width).toBe(320);expect(decoded.height).toBe(180);}});
it('backs up, restores and exports screenshots with their bytes and task links intact',async()=>{const {path,store,service,target}=await fixture();const receipt=service.save({requestId:'backup-images',targetId:target.id,pages:[imagePage()],note:''});const file=join(path,'images.reclimb');writeBackup(store,file);readBackup(file);const destination=join(path,'restored');await prepareRestore(file,destination);const restored=await LearningStore.open(destination);stores.push(restored);expect(restored.get('handwritings',receipt.id)).toEqual(store.get('handwritings',receipt.id));expect(readableExport(restored.snapshot())).toContain(imagePage().image.dataUrl);});
it('can restore a large mixed screenshot and ink draft with its frozen retry copy',async()=>{
 const {target}=await fixture(),draft=createDraft('space',target),p=imagePage();
 const raw=Buffer.from(p.image.dataUrl.split(',')[1],'base64'),large=Buffer.concat([raw,Buffer.alloc(Math.floor(14*1024*1024/3)-raw.length)]);
 const images=Array.from({length:3},(_,i)=>({...p,id:'large-image-'+i,image:{...p.image,dataUrl:'data:image/png;base64,'+large.toString('base64')}}));
 const points=Array.from({length:12000},()=>({x:.1,y:.2,pressure:.5}));
 draft.pages=[...images,{id:'ink',width:768,height:1024,strokes:Array.from({length:10},(_,i)=>({id:'s'+i,color:'#253e31' as const,width:2,points}))}];draft.pageId=draft.pages[0].id;
 freezeSubmission(draft,'large-retry');const text=exportDraft(draft);expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64*1024*1024);
 const restored=importDraft(text,'space');expect(restored.pages).toHaveLength(4);expect(restored.pending?.requestId).toBe('large-retry');expect(restored.pending?.pages[0].image?.dataUrl).toBe(p.image.dataUrl.replace(p.image.dataUrl.split(',')[1],large.toString('base64')));
});
