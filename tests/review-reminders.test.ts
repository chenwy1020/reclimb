import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {LocalReviewReminder} from '../src/main/review-reminders';
const directories:string[]=[];
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'reclimb-reminder-'));directories.push(root);return join(root,'reminder.json');};
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
const today=(hour:number,minute=0)=>new Date(2026,9,15,hour,minute);
it('is disabled by default and never contacts a service',()=>{
 const reminder=new LocalReviewReminder(fixture());let sent=0;
 expect(reminder.configuration()).toEqual({enabled:false,time:'19:00'});
 expect(reminder.tick(3,today(20),()=>{sent++;return true;})).toBe(false);
 expect(sent).toBe(0);
});
it('notifies only after the chosen local time and remembers the day across restart',()=>{
 const path=fixture(),reminder=new LocalReviewReminder(path);let sent=0;
 const notify=()=>{sent++;return true;};reminder.configure({enabled:true,time:'19:30'});
 expect(reminder.tick(2,today(19,29),notify)).toBe(false);
 expect(reminder.tick(0,today(19,30),notify)).toBe(false);
 expect(reminder.tick(2,today(19,30),notify)).toBe(true);
 expect(new LocalReviewReminder(path).tick(2,today(21),notify)).toBe(false);
 expect(new LocalReviewReminder(path).tick(2,new Date(2026,9,16,19,30),notify)).toBe(true);
 expect(sent).toBe(2);
});
it('does not consume the reminder when notifications are unavailable and respects disabling',()=>{
 const reminder=new LocalReviewReminder(fixture());reminder.configure({enabled:true,time:'08:00'});
 expect(reminder.tick(1,today(12),()=>false)).toBe(false);
 expect(reminder.tick(1,today(12),()=>true)).toBe(true);
 reminder.configure({enabled:false,time:'08:00'});
 expect(reminder.tick(1,new Date(2026,9,16,12),()=>true)).toBe(false);
});
it('rejects invalid times and unknown settings without changing existing preferences',()=>{
 const reminder=new LocalReviewReminder(fixture());
 for(const input of [{enabled:true,time:'25:00'},{enabled:'true',time:'08:00'},{enabled:true,time:'08:00',server:'https://example.test'}])expect(()=>reminder.configure(input)).toThrow();
 expect(reminder.configuration().enabled).toBe(false);
});
