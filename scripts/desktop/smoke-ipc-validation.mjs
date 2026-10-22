import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright';

const require = createRequire(import.meta.url);
const data = mkdtempSync(join(tmpdir(), 'reclimb-ipc-validation-'));
const executable = process.env.RECLIMB_TEST_EXECUTABLE?.trim();
const artifacts = resolve(process.env.RECLIMB_TEST_ARTIFACT_DIR?.trim() || 'output/playwright/ipc-validation');
const externalRequests = [];
let passed = 0, completed = false;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: executable ? [] : ['.'],
  cwd: process.cwd(),
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
    RECLIMB_DATA_DIR: data,
    RECLIMB_DEV_URL: '',
  },
  timeout: 45000,
});

try {
  const page = await app.firstWindow();
  page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  await page.getByRole('heading', {name: '你好，今天想往前走哪一步？'}).waitFor();
  const api = (action, payload = {}) => page.evaluate(
    ({action, payload}) => window.learning.request(action, payload),
    {action, payload},
  );
  const created = await api('project.create', {title: 'IPC 输入校验', goal: '独立比较两个分数'});
  const project = created.projects.find(item => item.title === 'IPC 输入校验');
  await api('validation.createSet', {projectId: project.id, title: '固定任务', description: '本地回归'});
  const initial = await api('workspace.snapshot');
  const set = initial.validationSets.find(item => item.projectId === project.id);
  await api('validation.import', {
    setId: set.id,
    knownExposure: false,
    tasks: [{
      title: '分数比较', prompt: '比较 2/3 与 3/5，并说明理由。', referenceAnswer: '统一分母：10/15 大于 9/15。',
      rubric: ['给出比较依据'], source: {kind: 'authored', citation: '自编回归材料'},
      review: {status: 'reviewed', reviewer: '回归测试', basis: '分数通分计算'},
      comparableGroup: '', conditions: '独立作答', transferRationale: '',
    }],
  });
  const imported = await api('workspace.snapshot');
  const task = imported.validationTasks.find(item => item.setId === set.id);
  const {run} = await api('validation.start', {taskId: task.id, requestId: 'ipc-validation', phase: 'before', selfReportedExposure: ''});
  const sessionId = run.sessionId;
  const before = await api('workspace.snapshot');
  const protectedRecords = snapshot => ({
    sessions: snapshot.sessions,
    validationRuns: snapshot.validationRuns,
    validationExposures: snapshot.validationExposures,
    answerExposures: snapshot.answerExposures,
    usage: snapshot.usage,
  });
  const invalid = [
    ['session.help', {sessionId, kind: 'invalid'}],
    ['session.nextStep', {sessionId, intent: 'invalid'}],
    ['session.help', {sessionId, kind: 'hint', text: {text: 'wrong type'}}],
    ['session.help', {sessionId, kind: 'hint', text: 'x'.repeat(10001)}],
    ['session.help', {sessionId, kind: 'confused', confusionKind: 'invalid'}],
    ['session.help', {sessionId, kind: 'explore', text: '   '}],
    ['session.help', {sessionId, kind: 'answer', unexpected: true}],
    ['session.nextStep', {sessionId, intent: 'continue', unexpected: true}],
    ['session.reviewSolution', {sessionId, unexpected: true}],
    ['session.help', {sessionId: '', kind: 'hint'}],
    ['session.nextStep', {sessionId: 42, intent: 'continue'}],
    ['session.reviewSolution', {sessionId: []}],
  ];
  for (const [action, payload] of invalid) {
    await assert.rejects(api(action, payload));
    assert.deepEqual(protectedRecords(await api('workspace.snapshot')), protectedRecords(before), action + ' must reject invalid input before saving help or exposure');
    passed++;
    console.log('PASS malformed ' + action + ' leaves independent-task records unchanged');
  }
  await api('session.help', {sessionId, kind: 'answer'});
  const after = await api('workspace.snapshot');
  assert.equal(after.sessions.find(item => item.id === sessionId).helpLevel, 4);
  assert.ok(after.validationRuns.find(item => item.id === run.id).exposures.some(item => item.kind === 'answer'));
  assert.equal(after.usage.length, 0);
  assert.deepEqual(externalRequests, []);
  passed++;
  completed = true;
  console.log('PASS valid answer request preserves help/exposure tracking without model calls');
} finally {
  await app.close();
  mkdirSync(artifacts, {recursive: true});
  writeFileSync(join(artifacts, 'ipc-validation.json'), JSON.stringify({at:new Date().toISOString(),validationStatus:completed?'passed':'failed',passed,executable:executable||'development-electron',externalRequests}, null, 2));
}
