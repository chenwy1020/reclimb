import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import AdmZip from 'adm-zip';
import {readBackup,writeBackup} from '../src/main/backup';
import {LearningStore} from '../src/main/store';

const require=createRequire(import.meta.url);
const zlib=require('node:zlib') as typeof import('node:zlib');
const cleanups:(()=>void)[]=[];
afterEach(()=>{vi.restoreAllMocks();while(cleanups.length)cleanups.pop()!();});

// Change only the central-directory claim, keeping the small real payload and CRC intact.
function changeDeclaredSize(bytes:Buffer,name:string,declaredSize:(actual:number)=>number,method=8):Buffer {
 const altered=Buffer.from(bytes),end=altered.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 let offset=altered.readUInt32LE(end+16);
 for(let count=altered.readUInt16LE(end+10);count>0;count--){
  expect(altered.readUInt32LE(offset)).toBe(0x02014b50);
  const nameLength=altered.readUInt16LE(offset+28),extraLength=altered.readUInt16LE(offset+30),commentLength=altered.readUInt16LE(offset+32);
  if(altered.subarray(offset+46,offset+46+nameLength).toString('utf8')===name){
   expect(altered.readUInt16LE(offset+10)).toBe(method);
   expect(altered.readUInt32LE(offset+20)).toBeGreaterThan(0);
   altered.writeUInt32LE(declaredSize(altered.readUInt32LE(offset+24)),offset+24);return altered;
  }
  offset+=46+nameLength+extraLength+commentLength;
 }
 throw new Error('Test ZIP entry is missing');
}

it.each(['manifest.json','materials/m/notes.txt','handwriting/original.json'])('rejects a zero-size claim for %s before inflating any entry',async name=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-zip-limits-'));
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=await LearningStore.open(join(root,'workspace'));
 cleanups.push(()=>store.close());
 const archive=join(root,'valid.reclimb');writeBackup(store,archive);
 const zip=new AdmZip(archive);
 if(name!=='manifest.json')zip.addFile(name,Buffer.from('A small payload that must never be inflated.'));
 const malicious=join(root,'zero-size.reclimb');writeFileSync(malicious,changeDeclaredSize(zip.toBuffer(),name,()=>0));
 const original=readFileSync(malicious);
 // A call-through spy observes real decompression without replacing its behavior.
 const inflate=vi.spyOn(zlib,'inflateRawSync');
 let failure:unknown;
 try{readBackup(malicious);}catch(error){failure=error;}
 expect(inflate.mock.calls.length).toBe(0);
 expect(failure).toBeInstanceOf(Error);
 expect(readFileSync(malicious)).toEqual(original);
});

it.each([0,8])('rejects an entry whose declared size disagrees with its actual bytes (method %i)',async method=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-zip-size-mismatch-'));
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=await LearningStore.open(join(root,'workspace'));
 cleanups.push(()=>store.close());
 const archive=join(root,'valid.reclimb');writeBackup(store,archive);
 const zip=new AdmZip(archive),entry=zip.getEntry('manifest.json')!;
 // Reinsert the real bytes so the chosen compression method is used on writing.
 zip.updateFile('manifest.json',entry.getData());entry.header.method=method;
 const malicious=join(root,'size-mismatch.reclimb');
 writeFileSync(malicious,changeDeclaredSize(zip.toBuffer(),'manifest.json',actual=>method===0?1:actual+1,method));
 expect(()=>readBackup(malicious)).toThrow();
});

it('still restores a valid backup containing an empty stored material',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-empty-material-'));
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=await LearningStore.open(join(root,'workspace'));
 cleanups.push(()=>store.close());
 const stamp='2026-10-15T00:00:00.000Z',material=join(store.dataDirectory,'empty.txt');
 writeFileSync(material,'');
 store.transaction(()=>{
  store.put('projects',{id:'p',title:'Empty source',goal:'Preserve original files',status:'active',createdAt:stamp,updatedAt:stamp});
  store.put('materials',{id:'m',projectId:'p',title:'Empty source',kind:'txt',originalName:'empty.txt',storedPath:material,importedAt:stamp,warnings:[],fragmentCount:0,summary:''});
 });
 const archive=join(root,'empty.reclimb');writeBackup(store,archive);
 expect(readBackup(archive).files.get('m')?.bytes).toEqual(Buffer.alloc(0));
});
