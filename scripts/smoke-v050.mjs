// Major release: accumulated desktop checks plus the new workflows.
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v050');mkdirSync(artifacts,{recursive:true});
const accumulated=[
 ['curriculum','smoke-v044.mjs','desktop-verification-v044.json'],
 ['confusion','smoke-v045.mjs','desktop-verification-v045.json'],
 ['followup-cache','smoke-v046.mjs','desktop-verification-v046.json'],
 ['appearance','smoke-v047.mjs','desktop-verification-v047.json'],
 ['layout','smoke-v048.mjs','desktop-verification-v048.json'],
 ['handwriting','smoke-v049.mjs','desktop-verification-v049.json'],
 ['recognition','smoke-v0410.mjs','desktop-verification-v0410.json'],
];
const groups=[...(process.argv.includes('--current-only')?[]:accumulated),
 ['pencil','smoke-pen-v050.mjs','desktop-pen-v050.json'],
 ['handwriting-followup','smoke-handwriting-v050.mjs','desktop-handwriting-v050.json'],
 ['webdav','smoke-sync-v050.mjs','desktop-sync-v050.json'],
 ['multi-tab','smoke-storage-v050.mjs','desktop-storage-v050.json'],
];
const reports=[];
for(const [name,script,reportName] of groups){
 const directory=join(artifacts,name);mkdirSync(directory,{recursive:true});
 const child=spawnSync(process.execPath,['scripts/'+script],{stdio:'inherit',env:{...process.env,RECLIMB_TEST_ARTIFACT_DIR:directory}});
 if(child.error)throw child.error;if(child.status!==0)throw new Error(name+' checks failed: '+child.status);
 const report=JSON.parse(readFileSync(join(directory,reportName),'utf8'));
 if(!report.passed||report.externalRequests?.length||report.rendererErrors?.length)throw new Error(name+' report did not pass');
 reports.push({name,checks:report.passed,localMockRequests:report.localMockRequests??0,report:join(directory,reportName)});
}
writeFileSync(join(artifacts,'desktop-verification-v050.json'),JSON.stringify({at:new Date().toISOString(),executable:process.env.RECLIMB_TEST_EXECUTABLE||'development-electron',scope:process.argv.includes('--current-only')?'new-workflows':'full',passed:reports.length,results:reports,localMockRequests:reports.reduce((sum,r)=>sum+r.localMockRequests,0),externalRequests:[],rendererErrors:[],limitations:['Self-authored fixtures and local services. Actual Apple Pencil/Scribble and configured WebDAV still require device/service retesting.']},null,2));
console.log('PASS 0.5.0 desktop groups: '+reports.length);
