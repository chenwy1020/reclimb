// Patch-only checks; each group writes its detailed, isolated report.
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const artifacts=resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim()||'output/playwright/v0410');
mkdirSync(artifacts,{recursive:true});
const groups=[
 ['handwriting','smoke-v049.mjs','desktop-verification-v049.json'],
 ['layout','smoke-layout-v0410.mjs','desktop-layout-v0410.json'],
 ['pen','smoke-pen-v0410.mjs','desktop-pen-v0410.json'],
 ['feedback','smoke-feedback-v0410.mjs','desktop-feedback-v0410.json'],
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
writeFileSync(join(artifacts,'desktop-verification-v0410.json'),JSON.stringify({at:new Date().toISOString(),executable:process.env.RECLIMB_TEST_EXECUTABLE||'development-electron',passed:reports.length,results:reports,localMockRequests:reports.reduce((sum,r)=>sum+r.localMockRequests,0),externalRequests:[],rendererErrors:[],limitations:['No paid model calls. Real iPad Safari and Apple Pencil require device retesting; simulated pen events are not device certification.']},null,2));
console.log('PASS 0.4.10 desktop groups: '+reports.length);
