import {useEffect,useState} from 'react';
import {ArrowRight,FileText,FolderOpen,LoaderCircle,Sprout,Upload,X} from 'lucide-react';
import type {Project,WorkspaceSnapshot} from '../shared/types';
import type {Familiarity} from '../shared/teaching';
import {Button,type Run} from './ui';
export type Modal='project'|'url'|'text'|'restore'|'editProject'|null;
export default function AppModal({modal,project,busy,close,run,onCreated,error}:{error?:string;modal:Modal;project?:Project;busy:boolean;close:()=>void;run:Run;onCreated:(id:string)=>void}){
const[familiarity,setFamiliarity]=useState<Familiarity>(project?.startingPoint?.familiarity||'new');const[background,setBackground]=useState(project?.startingPoint?.background||'');
const[title,setTitle]=useState(modal==='editProject'?project?.title||'':'');const[goal,setGoal]=useState(modal==='editProject'?project?.goal||'':'');const[text,setText]=useState('');const[url,setUrl]=useState('');const[confirmed,setConfirmed]=useState(false);const[validation,setValidation]=useState('');
const titles={project:'开启一段新的学习',editProject:'让目标更贴近现在的你',text:'把一段材料放进学习空间',url:'导入公开文章',restore:'从备份恢复学习空间'};
async function submit(){setValidation('');let result:WorkspaceSnapshot|null=null;
if(modal==='project'){if(!goal.trim()){setValidation('先写下你想拥有的能力，暂时模糊也没有关系。');return}result=await run('project.create',{title:title.trim()||goal.trim().slice(0,24),goal:goal.trim(),startingPoint:{familiarity,background:background.trim()}});if(result){const p=[...result.projects].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];if(p)onCreated(p.id)}}
else if(modal==='editProject'&&project){if(!title.trim()||!goal.trim()){setValidation('请保留项目名称和能力目标。');return}result=await run('project.update',{id:project.id,title:title.trim(),goal:goal.trim(),startingPoint:{familiarity,background:background.trim()}},'目标已更新，可以按新的目标重新梳理路线。')}
else if(modal==='text'&&project){if(!title.trim()||!text.trim()){setValidation('请填写材料标题和正文。');return}result=await run('material.importText',{projectId:project.id,title:title.trim(),text:text.trim()},'文字材料已导入。')}
else if(modal==='url'&&project){try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error()}catch{setValidation('请输入完整的 http 或 https 文章链接。');return}result=await run('material.importUrl',{projectId:project.id,url:url.trim()},'文章已导入，请查看解析提示。')}
else if(modal==='restore'&&confirmed)result=await run('backup.restore',{});
if(result)close();
}
useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)close()};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[busy,close]);
return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)close()}}><section className="modal" role="dialog" aria-modal="true" aria-label={modal?titles[modal]:''}><div className="modal-heading"><div><span className="eyebrow">{modal==='restore'?'YOUR LEARNING ARCHIVE':'EVERY JOURNEY STARTS SOMEWHERE'}</span><h2>{modal?titles[modal]:''}</h2></div><button className="icon-button" aria-label="关闭对话框" disabled={busy} onClick={close}><X size={20}/></button></div>
{(modal==='project'||modal==='editProject')&&<><p className="modal-description">不必先选定一本书。一个想弄懂的问题，一件想独立完成的事，都可以成为起点。</p><label className="form-label">给这段学习起个名字 <small>{modal==='project'?'可稍后调整，留空会按目标命名':''}</small><input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：把观点说得有理有据" maxLength={100}/></label><label className="form-label">我希望自己能独立做到…<textarea rows={5} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="例如：读完一篇文章后，能分清主张、证据和隐含前提，独立写出一段站得住脚的评论。&#10;&#10;也可以说说你的基础、困惑或感兴趣的领域。"/></label><fieldset className="starting-point"><legend>对这部分内容，我现在的起点</legend><div>{([{value:'new',title:'从未接触',description:'先解释、看例子，再尝试一小步'},{value:'some',title:'有些印象',description:'帮我理清关键意思和断点'},{value:'experienced',title:'已有基础',description:'通过应用和追问寻找不足'}] as const).map(option=><label className={familiarity===option.value?'selected':''} key={option.value}><input type="radio" name="familiarity" value={option.value} checked={familiarity===option.value} onChange={()=>setFamiliarity(option.value)}/><strong>{option.title}</strong><small>{option.description}</small></label>)}</div></fieldset><label className="form-label">补充已有基础或当前困惑 <small>可留空，暂时的疲劳不会记成能力不足</small><textarea rows={2} value={background} onChange={e=>setBackground(e.target.value)} placeholder="例如：能看懂基本符号，但不知道每个假设为什么需要。"/></label><div className="modal-tip"><Sprout size={18}/><span>这是一个可持续调整的学习项目。之后可以加入书籍、课程字幕或文章，围绕能力目标继续前进。</span></div></>}
{modal==='text'&&<><p className="modal-description">适合书中摘录、课程笔记、原创题目与其他可以使用的文字材料。</p><label className="form-label">材料标题<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="给材料起一个容易找到的名字"/></label><label className="form-label">正文<textarea rows={10} value={text} onChange={e=>setText(e.target.value)} placeholder="在这里粘贴文字，保留段落有助于回到原文。"/></label></>}
{modal==='url'&&<><p className="modal-description">读取可以公开访问的正文，并将提取内容保存到本机。登录页面或动态页面可能需要改用粘贴文字。</p><label className="form-label">文章链接<input autoFocus type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label><div className="modal-tip"><FileText size={18}/><span>导入后可以核对原文片段和解析提示，图表与复杂排版可能不完整。</span></div></>}
{modal==='restore'&&<><div className="restore-warning"><FolderOpen size={27}/><h3>恢复会替换当前本机的学习记录</h3><p>请先为当前空间创建备份。所选备份中的项目、材料、作答和能力证据将成为新的本机记录，API 密钥不会从备份导入。</p></div><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已了解，并确认用所选备份替换当前记录。</label></>}
{(validation||error)&&<p className="form-error" role="alert">{validation||error}</p>}<div className="modal-footer"><Button disabled={busy} onClick={close}>取消</Button><Button variant={modal==='restore'?'danger':'primary'} disabled={busy||(modal==='restore'&&!confirmed)} onClick={()=>void submit()}>{busy?<LoaderCircle size={16} className="spin"/>:modal==='restore'?<Upload size={16}/>:<ArrowRight size={16}/>} {modal==='restore'?'选择备份并恢复':modal==='project'?'建立学习项目':modal==='editProject'?'保存目标':'导入材料'}</Button></div>
</section></div>;
}







