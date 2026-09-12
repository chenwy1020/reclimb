import type {RestoreRecovery} from './restore-journal';

export interface FailedRestoreRecovery {
 recover:()=>RestoreRecovery;
 workspaceExists:()=>boolean;
 reopen:()=>Promise<void>;
 block:(reason:string)=>void;
}

function unavailable(cause:unknown,block:(reason:string)=>void):never{
 const detail=cause instanceof Error&&cause.message?` 原因：${cause.message}`:'';
 const message='备份恢复未能回到可确认的一致状态，系统已停止访问当前档案。请完全关闭并重新启动重登；启动时会再次尝试恢复。'+detail;
 block(message);throw new Error(message);
}

export async function recoverFailedRestoreSafely(options:FailedRestoreRecovery):Promise<void>{
 let result:RestoreRecovery;try{result=options.recover();}catch(error){unavailable(error,options.block);}
 if(!result.recovered||result.phase!=='rollback')unavailable(new Error('恢复日志没有确认原档案已经回滚'),options.block);
  if(!options.workspaceExists())unavailable(new Error('学习档案目录不存在'),options.block);
  try{await options.reopen();}catch(error){unavailable(error,options.block);}
}

export class WorkspaceTransitionGate {
 private transitioning=false;
 private blockedReason='';
 assertAvailable():void{if(this.blockedReason)throw new Error(this.blockedReason);if(this.transitioning)throw new Error('学习档案正在备份恢复或切换，请等待当前操作结束。');}
 begin():()=>void{this.assertAvailable();this.transitioning=true;let finished=false;return()=>{if(finished)return;finished=true;if(!this.blockedReason)this.transitioning=false;};}
 block(reason:string):void{this.blockedReason=reason;this.transitioning=true;}
}
