import SettingsCard from './SettingsCard';
import {useEffect,useId,useRef,useState} from 'react';
import {Cloud,RefreshCw,Upload,Download,AlertTriangle} from 'lucide-react';
import type {DesktopAction} from '../shared/types';
import type {WebDavSyncStatus,WebDavSyncPreview} from '../shared/webdav-sync';
import {Button,timeLabel,type Run} from './ui';
import {flushAdditionalLocalDrafts} from './local-save-queue';
import './webdav-sync.css';

export default function WebDavSyncPanel({busy,run}:{busy:boolean;run:Run}){
 const [status,setStatus]=useState<WebDavSyncStatus>(),[preview,setPreview]=useState<WebDavSyncPreview>(),[working,setWorking]=useState(''),[error,setError]=useState(''),[replace,setReplace]=useState(false);
 const [form,setForm]=useState({endpoint:'',username:'',password:'',vaultId:'reclimb',deviceName:'我的电脑',allowInsecureHTTP:false});
 const lock=useRef(false),uploadId=useRef<string|undefined>(undefined);
 const [editing,setEditing]=useState(false),[statusLoading,setStatusLoading]=useState(true),[statusRevision,setStatusRevision]=useState(0),editorId=useId();
 useEffect(()=>{let alive=true;setStatusLoading(true);void window.learning.request<WebDavSyncStatus>('sync.status').then(s=>{if(!alive)return;setStatus(s);setForm(f=>({...f,endpoint:s.endpoint??'',username:s.username??'',vaultId:s.vaultId??'reclimb',deviceName:s.deviceName,allowInsecureHTTP:s.allowInsecureHTTP}));setEditing(!s.configured);setError('');uploadId.current=s.pendingUploadRequestId;}).catch(e=>{if(alive)setError(String(e.message||e))}).finally(()=>{if(alive)setStatusLoading(false)});return()=>{alive=false}},[statusRevision]);
 async function request<T>(action:DesktopAction,payload:unknown):Promise<T|undefined>{
  if(lock.current)return;lock.current=true;setWorking(action);setError('');
  try{await flushAdditionalLocalDrafts();return await window.learning.request<T>(action,payload)}catch(e){setError(String((e as Error).message||e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,''));return undefined}finally{lock.current=false;setWorking('')}
 }
 async function configure(){const next=await request<WebDavSyncStatus>('sync.configure',{...form,...(!form.password?{password:undefined}:{})});if(next){setStatus(next);setForm(f=>({...f,endpoint:next.endpoint??f.endpoint,password:''}));setEditing(false);setPreview(undefined);uploadId.current=next.pendingUploadRequestId;}}
 async function check(){const next=await request<WebDavSyncStatus>('sync.check',{});if(next){setStatus(next);setPreview(undefined);uploadId.current=next.pendingUploadRequestId;}}
 async function upload(){uploadId.current??=crypto.randomUUID();const next=await request<WebDavSyncStatus>('sync.upload',{requestId:uploadId.current,expectedRemoteSnapshotId:status?.remote?.snapshotId??null});if(next){setStatus(next);setPreview(undefined);uploadId.current=next.pendingUploadRequestId;}}
 async function inspect(){const next=await request<WebDavSyncPreview>('sync.preview',{snapshotId:status?.remote?.snapshotId});if(next){setPreview(next);setReplace(false);}}
 async function adopt(){if(!preview||lock.current)return;lock.current=true;setWorking('sync.adopt');setError('');try{const next=await run('sync.adopt',{previewId:preview.id,expectedLocalContentHash:preview.localContentHash,expectedRemoteSnapshotId:preview.snapshot.snapshotId,allowReplaceLocal:replace});if(next)setPreview(undefined);}finally{lock.current=false;setWorking('')}}
 const disabled=busy||!!working,ready=status?.configured,uploadable=status&&['remote_empty','local_ahead','up_to_date'].includes(status.state);
 return <SettingsCard className="webdav-sync-card" title="WebDAV 备份与多电脑接续" description="离开这台电脑前上传，在另一台电脑检查并接续。iPad 继续作为手写板。" icon={<Cloud size={21}/>}>
  <p className="quiet-note">传输完整学习档案和原始材料。不会自动覆盖两端修改；不上传 API 密钥、WebDAV 密码或本机外观。</p>
  {statusLoading&&<p role="status">正在读取本机同步连接…</p>}
  {!statusLoading&&!status&&<Button onClick={()=>setStatusRevision(value=>value+1)}>重新读取本机连接</Button>}
  {status&&<Button aria-expanded={editing} aria-controls={editorId} disabled={!!working} onClick={()=>setEditing(value=>!value)}>{editing?'收起连接编辑':ready?'修改连接':'配置 WebDAV 连接'}</Button>}
  <fieldset id={editorId} className="sync-connection-editor" hidden={!editing} disabled={disabled||statusLoading}><div className="form-grid">
   <label className="span-2">WebDAV 目录地址<input type="url" value={form.endpoint} placeholder="https://网盘地址/dav/" onChange={e=>setForm({...form,endpoint:e.target.value})}/></label>
   <label>WebDAV 用户名<input autoComplete="off" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label>
   <label>WebDAV 密码<input type="password" autoComplete="new-password" value={form.password} placeholder={status?.hasPassword?'留空保留本机已保存密码':'网盘应用密码'} onChange={e=>setForm({...form,password:e.target.value})}/></label>
   <label>同步空间编号<input value={form.vaultId} onChange={e=>setForm({...form,vaultId:e.target.value})}/><small>同一档案的各台电脑填写相同编号；不同档案使用不同编号。</small></label>
   <label>这台电脑的名称<input value={form.deviceName} onChange={e=>setForm({...form,deviceName:e.target.value})}/></label>
  </div><label className="sync-check"><input type="checkbox" checked={form.allowInsecureHTTP} onChange={e=>setForm({...form,allowInsecureHTTP:e.target.checked})}/>允许明文 HTTP（账号及学习档案不加密，仅用于可信网络）</label><Button disabled={disabled} onClick={()=>void configure()}>保存本机同步连接</Button><p className="quiet-note">修改地址或用户名时请重新填写密码；同一连接的密码留空则保持原样。收起编辑保留尚未保存的输入。</p></fieldset>
  <p className="quiet-note">首次检查会建立空的重登同步目录；点击上传后才会传输学习档案。</p>
  {ready&&<div className="sync-status" role="status"><strong>{status.deviceName} · {status.vaultId}</strong><p>{status.message}</p>{status.checkedAt&&<small>上次检查：{timeLabel(status.checkedAt)}；新写入的内容需再次检查。</small>}{status.remote&&<p>远端：{status.remote.deviceName} · {timeLabel(status.remote.createdAt)}</p>}</div>}
  <div className="sync-actions"><Button disabled={!ready||disabled} onClick={()=>void check()}><RefreshCw size={15}/>检查远端更新</Button><Button disabled={!ready||disabled||!uploadable} onClick={()=>void upload()}><Upload size={15}/>{uploadId.current?'重试上传同一快照':'上传当前完整档案'}</Button><Button disabled={!status?.remote||disabled} onClick={()=>void inspect()}><Download size={15}/>预览远端档案</Button></div>
  {working&&<p role="status">{working==='sync.adopt'?'正在接续档案，原档案会保留在本机。':'正在处理同步请求…'}</p>}
  {!!working&&working!=='sync.adopt'&&<Button onClick={()=>void window.learning.request('sync.cancel').catch(e=>setError(String(e.message||e)))}>取消本次传输</Button>}
  {error&&<p className="sync-error" role="alert"><AlertTriangle size={16}/>{error}</p>}
  {preview&&<div className="sync-preview" aria-label="远端档案预览"><h3>接续前核对</h3><Button disabled={disabled} onClick={()=>void run('sync.saveCopy',{previewId:preview.id})}>另存远端档案副本</Button><p>{preview.summary.projects} 个项目 · {preview.summary.materials} 份材料 · {preview.summary.sessions} 段学习 · {preview.summary.handwritings} 份手写</p><p>采用后使用远端的学习进度、作答及手写；本机模型配置、密钥、预算和已计费记录保留。当前档案另外保存在本机，iPad 需要重新配对。</p>{preview.requiresReplaceConfirmation&&<label className="sync-check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>我已核对两份档案，采用远端继续；本机原档案另存，不合并两端学习修改。</label>}<Button variant="primary" disabled={disabled||(preview.requiresReplaceConfirmation&&!replace)} onClick={()=>void adopt()}>采用这份档案继续学习</Button></div>}
  <p className="quiet-note">删除项目不会自动删除网盘历史快照。服务器须支持版本条件更新；不支持时停止安全同步，不降低检查。密码由本机系统加密保存。</p>
 </SettingsCard>;
}
