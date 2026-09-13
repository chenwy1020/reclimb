import {describe,it,expect} from 'vitest';
import {followupsForAnchor,hasInlineHome} from '../src/renderer/followup-placement';
import type {Session,SessionMessage,WorkspaceSnapshot} from '../src/shared/types';
const anchor={kind:'step' as const,id:'old',teachingVersionId:'v1',historyIndex:0};
const root={id:'q1',inputId:'q1',role:'user',text:'why',followup:{...anchor,rootInputId:'q1'}} as SessionMessage;
const child={id:'q2',inputId:'q2',role:'user',text:'example',followup:{kind:'message',id:'a1',rootInputId:'q1',parentMessageId:'a1'}} as SessionMessage;
const session={id:'s',projectId:'p',messages:[root,{id:'a1',inputId:'q1',role:'assistant',text:'because'},child],teaching:{history:[{id:'old',teachingVersionId:'v1'}],current:{id:'now'}}} as Session;
const snapshot={fragments:[],attempts:[]} as unknown as WorkspaceSnapshot;
describe('inline followup placement',()=>{
 it('keeps a whole branch in chronological order at its versioned origin',()=>{expect(followupsForAnchor(session,anchor).map(m=>m.id)).toEqual(['q1','q2']);expect(hasInlineHome(root,session,snapshot)).toBe(true);expect(hasInlineHome(child,session,snapshot)).toBe(true);});
 it('does not rebind old steps to another version and keeps missing origins accessible',()=>{const changed={...session,teaching:{...session.teaching!,history:[{id:'old',teachingVersionId:'v2'}]}} as Session;expect(hasInlineHome(root,changed,snapshot)).toBe(false);expect(followupsForAnchor(session,{...anchor,teachingVersionId:'v2'})).toEqual([]);});
 it('does not recursively duplicate descendants below every response',()=>{expect(followupsForAnchor(session,{kind:'message',id:'a1'})).toEqual([]);});
 it('keeps sources within their project and does not lose orphan branches',()=>{const orphan={...root,followup:{...root.followup!,rootInputId:'missing'}};expect(hasInlineHome(orphan,session,snapshot)).toBe(false);});
});
