import {reviewedTeaching,withCriterionIds} from './helpers/review-response';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LearningStore } from '../src/main/store';
import { LearningService } from '../src/main/learning-service';
import {ChatProvider,type ModelProvider, type ModelRequest } from '../src/main/provider';
import type { Activity, Capability, Project } from '../src/shared/types';
import { routeSchemaFor } from '../src/main/schemas';

type RouteCapability = Pick<Capability, 'title' | 'description' | 'prerequisites' | 'sourceIds'>;
type Input = Record<string, any>;
const resources: { directory: string; store: LearningStore }[] = [];
afterEach(() => {
  for (const { directory, store } of resources.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

class ControlledProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  constructor(public respond: (input: Input) => unknown | Promise<unknown>) {}
  async complete(request: ModelRequest) {
    this.requests.push(request);
    const input=JSON.parse(request.user);const result=input.operation==='review_teaching'?reviewedTeaching(input):withCriterionIds(await this.respond(input),input);
    return { text: JSON.stringify(result), inputTokens: 100, outputTokens: 100, usageKnown: true };
  }
  get inputs(): Input[] { return this.requests.map(request => JSON.parse(request.user)); }
}

async function environment(responder: (input: Input) => unknown | Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'reclimb-route-'));
  const store = await LearningStore.open(directory);
  resources.push({ directory, store });
  const project: Project = { id: 'project', title: '理解概率', goal: '独立判断条件改变后概率如何变化', status: 'active', createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z' };
  store.transaction(() => {
    store.put('projects', project);
    store.updateSettings({ monthlyBudgetCny: 100 });
  });
  const provider = new ControlledProvider(responder);
  const service = new LearningService(store, () => 'test-key-never-transmitted', () => provider);
  return { store, service, provider, project };
}

function material(store: LearningStore, texts: string[], materialId = 'material', projectId = 'project') {
  store.transaction(() => {
    store.put('materials', { id: materialId, projectId, title: '概率教材', kind: 'md', originalName: materialId + '.md', storedPath: join(store.dataDirectory, materialId + '.md'), importedAt: '2026-09-07T00:00:00Z', warnings: [], fragmentCount: texts.length, summary: '从概率基础开始，后续介绍条件与证据。' });
    texts.forEach((text, index) => store.put('fragments', { id: `${materialId}-${index}`, projectId, materialId, text, locator: `第 ${index + 1} 章`, ordinal: index }));
  });
}
function route(capabilities: RouteCapability[]) { capabilities=[...capabilities,...Array.from({length:Math.max(0,3-capabilities.length)},(_,i)=>definition('补充能力'+(i+1),[],capabilities[0]?.sourceIds??[]))];return { summary: '依据材料安排逐步练习。', capabilities,nearSteps:[0,1].map(index=>({capabilityTitle:capabilities[0].title,title:'小步'+index,objective:'辨认一个条件并说明作用',completion:'说出一个具体条件即可继续',prerequisites:[],reason:'先建立材料中概念的直观',sourceIds:capabilities[0].sourceIds})) }; }
function definition(title = '理解条件概率', prerequisites: string[] = [], sourceIds = ['material-0']): RouteCapability {
  return { title, description: '说明观察证据如何改变概率判断', prerequisites, sourceIds };
}

function referencedRoute() {
  return {
    summary: '从条件与结论的区别进入论证分析。',
    capabilities: [definition('辨认论证条件'), definition('检查推理连接', ['辨认论证条件']), definition('说明适用边界', ['检查推理连接'])],
    mapNodes: [{ key: 'premises', title: '条件', question: '论证从哪里开始？', role: '问题入口', sourceIds: ['material-0'], connectsTo: ['reasoning'] }, { key: 'reasoning', title: '推理', question: '条件如何支持结论？', role: '连接条件和结论', sourceIds: ['material-0'], connectsTo: [] }],
    units: [
      { title: '先拆开一段论证', capabilityTitle: '辨认论证条件', coreQuestion: '哪些是给定条件？', purpose: '先分清论证对象。', expectedOutcome: '能指出论证中的条件。', phase: 'survey' as const, sourceIds: ['material-0'], prerequisiteTitles: [], unresolvedGaps: [] as string[] },
      { title: '比较两种推理连接', capabilityTitle: '检查推理连接', coreQuestion: '哪一步需要额外理由？', purpose: '检查推理是否成立。', expectedOutcome: '能说明一个推理缺口。', phase: 'expand' as const, sourceIds: ['material-0'], prerequisiteTitles: ['先拆开一段论证'], unresolvedGaps: [] as string[] },
    ],
  };
}

describe('route reference contract', () => {
  it('tells the actual generation request which namespace each reference uses', async () => {
    const { store, service, provider } = await environment(() => referencedRoute());
    material(store, ['给定前提与待判断结论应当明确区分。']);
    await service.generateRoute('project');
    const properties = (provider.requests[0].schema as any).properties;
    expect(properties.capabilities.items.properties.prerequisites.description).toContain('capabilities[].title');
    expect(properties.units.items.properties.prerequisiteTitles.description).toContain('units[].title');
    expect(properties.units.items.properties.capabilityTitle.description).toContain('capabilities[].title');
    expect(properties.mapNodes.items.properties.connectsTo.description).toContain('mapNodes[].key');
    expect(properties.units.items.properties.unresolvedGaps.description).toContain('未知');
    expect(provider.inputs[0].referenceProtocol).toBeDefined();
    expect(JSON.stringify(provider.inputs[0].referenceProtocol)).toContain('不要复制');
  });

  it('reports the bad reference and exact allowed titles instead of an opaque graph error', () => {
    const candidate = referencedRoute();
    candidate.capabilities[0].prerequisites = ['命题逻辑'];
    candidate.units[1].prerequisiteTitles = ['辨认论证条件'];
    candidate.mapNodes[0].connectsTo = ['推理'];
    const result = routeSchemaFor(false, ['material-0']).safeParse(candidate);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = result.error.issues;
    const capability = issues.find(issue => issue.path.join('.') === 'capabilities.0.prerequisites.0');
    expect(capability?.message).toContain('命题逻辑');
    expect(capability?.message).toContain('辨认论证条件');
    expect(capability?.message).toContain('unresolvedGaps');
    const unit = issues.find(issue => issue.path.join('.') === 'units.1.prerequisiteTitles.0');
    expect(unit?.message).toContain('辨认论证条件');
    expect(unit?.message).toContain('先拆开一段论证');
    const map = issues.find(issue => issue.path.join('.') === 'mapNodes.0.connectsTo.0');
    expect(map?.message).toContain('推理');
    expect(map?.message).toContain('reasoning');
  });

  it('keeps outside foundations as unknown gaps after repairing the original candidate', async () => {
    const original = referencedRoute();
    original.capabilities[0].prerequisites = ['命题逻辑'];
    const { store, service, provider } = await environment(input => {
      if (!input.repair) return original;
      const candidate = JSON.parse(input.repair.previousResponse);
      expect(candidate).toEqual(original);
      expect(input.repair.validationIssues.some((issue: any) => issue.message.includes('命题逻辑') && issue.message.includes('unresolvedGaps'))).toBe(true);
      candidate.capabilities[0].prerequisites = [];
      candidate.units[0].unresolvedGaps = ['命题逻辑的相关基础尚未确认，先结合一次小尝试核对。'];
      return candidate;
    });
    material(store, ['给定前提与待判断结论应当明确区分。']);
    const generated = await service.generateRoute('project');
    expect(provider.requests).toHaveLength(2);
    expect(generated.unitSnapshots[0].unresolvedGaps).toEqual(['命题逻辑的相关基础尚未确认，先结合一次小尝试核对。']);
    expect(store.get('learningUnits', generated.unitIds[0])?.unresolvedGaps).toEqual(generated.unitSnapshots[0].unresolvedGaps);
    expect(store.list('evidence')).toHaveLength(0);
    expect(store.list('capabilities').find(item => item.title === '辨认论证条件')?.prerequisites).toEqual([]);
    expect(store.list('usage').map(item => item.publicationStatus)).toEqual(['discarded', 'published']);
  });

  it('distinguishes stored historical IDs from output titles when adjusting a route', async () => {
    const { store, service, provider } = await environment(() => referencedRoute());
    material(store, ['给定前提与待判断结论应当明确区分。']);
    await service.generateRoute('project');
    const prerequisite = store.list('capabilities').find(item => item.title === '辨认论证条件')!;
    await service.generateRoute('project');
    const existing = provider.inputs[1].existingCapabilities.find((item: any) => item.title === '检查推理连接');
    expect(existing.prerequisites).toEqual([prerequisite.id]);
    expect(existing.prerequisiteTitles).toEqual(['辨认论证条件']);
    expect(provider.inputs[1].referenceProtocol.existingReferences).toMatch(/ID/);
    expect(provider.inputs[1].referenceProtocol.existingReferences).toContain('capabilities[].title');
  });
});
function activity(input: Input) {
  const activity:Activity={ title: input.capability.title, instruction: '结合给定材料，判断一条新增证据会怎样改变原来的判断，并说明依据。', kind: 'application', rubric: ['给出明确结论', '引用材料中的理由'], sourceIds: input.sources.map((source: { id: string }) => source.id).slice(0, 2), referenceAnswer: '结论需要结合条件和先验信息。', assessmentBasis: 'source' };
  return {steps:[{action:'explain',title:'理解对象',content:'先从材料的基本概念开始。',sourceIds:activity.sourceIds},{action:'attempt',title:activity.title,content:'现在尝试一个小判断。',sourceIds:activity.sourceIds,activity}]};
}
function routeOrLearning(getCapabilities: () => RouteCapability[]) {
  return (input: Input): unknown => {
    if ('answer' in input) return { outcome: 'met', feedback: '本次清楚表达了判断与理由。', criteria: input.activity.rubric.map((criterion: string) => ({ criterion, result: 'met', reason: '作答中提供了相应依据。' })), limitations: ['这是一次有限任务的评审。'], sourceIds: input.activity.sourceIds };
    if ('capability' in input) return activity(input);
    return route(getCapabilities());
  };
}

async function acquireEvidence(service: LearningService, store: LearningStore) {
  const session = await service.start('project');
  await service.nextStep(session.id,'continue');
  await service.submit(session.id, '观察条件后需要重新限定样本空间，再根据已知信息判断概率。', randomUUID());
  const evidence = store.list('evidence');
  expect(evidence).toHaveLength(1);
  expect(evidence[0].status).toBe('independent');
  return { session, evidence, attempts: store.list('attempts'), reviews: store.list('reviews') };
}

describe('learning routes preserve material coverage and historical evidence', () => {
  it('sends a DeepSeek route through the real provider adapter with thinking disabled and publishes the valid result',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'reclimb-route-deepseek-'));const store=await LearningStore.open(directory);resources.push({directory,store});
    store.transaction(()=>{store.put('projects',{id:'project',title:'全书路线',goal:'建立可持续更新的全书地图',status:'active',createdAt:'2026-09-07T00:00:00Z',updatedAt:'2026-09-07T00:00:00Z'});store.updateSettings({providerName:'DeepSeek',baseUrl:'https://api.deepseek.com/chat/completions',model:'deepseek-v4-flash',monthlyBudgetCny:100});});material(store,['第一节解释核心对象。']);
    let sent:any;const service=new LearningService(store,()=> 'test-key', (settings,key)=>new ChatProvider({baseUrl:settings.baseUrl,model:settings.model,apiKey:key,fetcher:async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({id:'deepseek-route',model:'deepseek-v4-flash-0731',choices:[{finish_reason:'stop',message:{content:JSON.stringify(route([definition()]))}}],usage:{prompt_tokens:100,completion_tokens:200}}),{status:200,headers:{'content-type':'application/json'}});}}));
    const published=await service.generateRoute('project');
    expect(sent).toMatchObject({model:'deepseek-v4-flash',max_tokens:9000,thinking:{type:'disabled'},response_format:{type:'json_object'}});
    expect(published.status).toBe('adopted');expect(store.get('projects','project')?.activeRouteVersionId).toBe(published.id);
    expect(store.list('usage').find(item=>item.kind==='学习路线')).toMatchObject({requestedModel:'deepseek-v4-flash',reportedModel:'deepseek-v4-flash-0731',publicationStatus:'published'});
  });

  it('includes the final chapter of a long material in the model context with a real source ID', async () => {
    const { store, service, provider } = await environment(input => route([definition('理解最后一章', [], [input.sources.at(-1).id])]));
    const paragraphs = Array.from({ length: 240 }, (_, index) => index === 239 ? '终章唯一标记：序贯证据更新要求重新判断模型的适用条件。' : `第 ${index + 1} 节讨论基础概念与例子。`);
    material(store, paragraphs);
    await service.generateRoute('project');
    const context = provider.inputs[0];
    expect(context.sources.some((source: { id: string; text: string; locator: string }) => source.id === 'material-239' && source.text.includes('终章唯一标记') && source.locator === '第 240 章')).toBe(true);
    expect(context.materials[0]).not.toHaveProperty('sectionLocators');
    expect(context.sectionIndex).toHaveLength(240);
    expect(context.coverage.totalFragments).toBe(240);
    expect(context.coverage.sampledFragments).toBeLessThan(240);
    expect(store.list('capabilities')[0].sourceIds).toEqual(['material-239']);
  });

  it('balances a bounded section index across materials instead of dropping every later material', async () => {
    const {store,service,provider}=await environment(input=>route([definition('跨材料建立全书粗图',[],[input.sources[0].id])]));
    material(store,Array.from({length:2100},(_,index)=>`第一份材料第 ${index+1} 段。`),'book-a');
    material(store,Array.from({length:4},(_,index)=>`第二份材料第 ${index+1} 段。`),'book-b');
    await service.generateRoute('project');
    const context=provider.inputs[0],index=context.sectionIndex as Array<{id:string;materialId:string}>;
    expect(index).toHaveLength(2000);
    expect(index.filter(item=>item.materialId==='book-b').map(item=>item.id)).toEqual(['book-b-0','book-b-1','book-b-2','book-b-3']);
    expect(index.some(item=>item.id==='book-a-2099')).toBe(true);
    expect(context.coverage).toMatchObject({totalFragments:2104,indexedFragments:2000});
    expect(context.coverage.method).toMatch(/按材料平衡/);
  });

  it('keeps capability IDs when definitions, goal, references and prerequisites remain the same', async () => {
    let definitions = [definition('理解条件'), definition('应用条件', ['理解条件'])];
    const { store, service } = await environment(() => route(definitions));
    material(store, ['条件概率帮助判断证据与结论的关系。']);
    await service.generateRoute('project');
    const original = new Map(store.list('capabilities').map(capability => [capability.title, capability.id]));
    definitions = [...definitions].reverse();
    const proposal = await service.generateRoute('project');
    service.adoptRoute('project', proposal.id);
    const active = store.list('capabilities').filter(capability => !capability.archived);
    expect(active).toHaveLength(3);
    expect(store.list('capabilities')).toHaveLength(3);
    for (const capability of active) expect(capability.id).toBe(original.get(capability.title));
    expect(active.find(capability => capability.title === '应用条件')?.prerequisites).toEqual([original.get('理解条件')]);
  });

  it('creates a new identity after a definition changes while retaining the old evidence and attempts', async () => {
    let definitions = [definition()];
    const { store, service } = await environment(routeOrLearning(() => definitions));
    material(store, ['条件概率需要重新限定样本空间，证据改变概率判断。']);
    await service.generateRoute('project');
    const before = await acquireEvidence(service, store);
    const old = store.list('capabilities')[0];
    definitions = [{ ...definitions[0], description: '在陌生情境中判断条件独立性，指出不能直接相乘的情形' }];
    const proposal = await service.generateRoute('project');
    service.adoptRoute('project', proposal.id);
    const current = store.list('capabilities').find(capability => !capability.archived&&capability.title===old.title)!;
    expect(current.id).not.toBe(old.id);
    expect(store.get('capabilities', old.id)).toMatchObject({ description: old.description, archived: true });
    expect(store.list('evidence')).toEqual(before.evidence);
    expect(store.list('attempts')).toEqual(before.attempts);
    expect(store.list('reviews')).toEqual(before.reviews);
    expect(store.get('sessions', before.session.id)?.capabilityId).toBe(old.id);
  });

  it('creates a new identity after a goal changes without transferring old evidence', async () => {
    const definitions = [definition()];
    const { store, service } = await environment(routeOrLearning(() => definitions));
    material(store, ['证据改变条件概率，需要限定样本空间。']);
    await service.generateRoute('project');
    const before = await acquireEvidence(service, store);
    const old = store.list('capabilities')[0];
    store.put('projects', { ...store.get('projects', 'project')!, goal: '设计能检验因果关系的研究，而不仅是计算概率', updatedAt: new Date().toISOString() });
    const proposal = await service.generateRoute('project');
    service.adoptRoute('project', proposal.id);
    const current = store.list('capabilities').find(capability => !capability.archived&&capability.title===old.title)!;
    expect(current.id).not.toBe(old.id);
    expect(current.goalContext).toBe(store.get('projects', 'project')?.goal);
    expect(store.get('capabilities', old.id)).toMatchObject({ archived: true, goalContext: old.goalContext });
    expect(store.list('evidence')).toEqual(before.evidence);
    expect(store.list('evidence').some(evidence => evidence.capabilityId === current.id)).toBe(false);
  });

  it.each([
    ['循环', [definition('条件', ['证据']), definition('证据', ['条件'])]],
    ['不存在', [definition('条件', ['只存在于历史路线的能力'])]],
  ] as const)('rejects %s prerequisites before changing the current route', async (message, invalid) => {
    let response = route([definition()]);
    const { store, service, provider } = await environment(() => response);
    material(store, ['条件概率与证据。']);
    await service.generateRoute('project');
    const before = store.list('capabilities');
    const project = store.get('projects', 'project');
    store.put('capabilities', { id: 'historical', projectId: 'project', title: '只存在于历史路线的能力', description: '旧目标', prerequisites: [], sourceIds: [], order: 99, archived: true });
    const withHistory = store.list('capabilities');
    response = route([...invalid]);
    await expect(service.generateRoute('project')).rejects.toThrow(message);
    expect(provider.requests).toHaveLength(3);
    expect(store.list('usage').slice(-2).map(item=>item.publicationStatus)).toEqual(['discarded','discarded']);
    expect(store.list('capabilities')).toEqual(withHistory);
    expect(store.get('projects', 'project')).toEqual(project);
    expect(store.get('capabilities', before[0].id)?.archived).toBe(false);
  });

  it('repairs a structurally valid route whose capability graph is inconsistent', async () => {
    const {store,service,provider}=await environment(input=>input.repair
      ? route([definition('识别条件'),definition('使用条件',['识别条件']),definition('检查边界',['使用条件'])])
      : route([definition('识别条件',['不存在的能力']),definition('使用条件'),definition('检查边界')]));
    material(store,['条件概率与证据。']);
    const generated=await service.generateRoute('project');
    expect(generated.status).toBe('adopted');
    expect(provider.requests).toHaveLength(2);
    expect(store.list('usage').map(item=>item.publicationStatus)).toEqual(['discarded','published']);
    expect(store.list('capabilities').find(item=>item.title==='检查边界')?.prerequisites).toHaveLength(1);
  });

  it('repairs an adjustment that tries to reuse an old capability after changing its meaning', async () => {
    let previous:Capability[]|undefined;
    const {store,service,provider}=await environment(input=>{
      if(!previous)return route([definition('识别条件'),definition('使用条件'),definition('检查边界')]);
      const capabilities=previous.map((item,index)=>({title:item.title,description:!input.repair&&index===0?item.description+'并完成另一项新任务':item.description,prerequisites:[],sourceIds:item.sourceIds,existingCapabilityId:item.id}));
      return route(capabilities as RouteCapability[]);
    });
    material(store,['条件概率与证据。']);
    await service.generateRoute('project');
    previous=store.list('capabilities').filter(item=>!item.archived);
    const proposal=await service.generateRoute('project');
    expect(proposal.status).toBe('proposed');
    expect(provider.requests).toHaveLength(3);
    expect(store.list('usage').map(item=>item.publicationStatus)).toEqual(['published','discarded','published']);
    expect(proposal.capabilitySnapshots.map(item=>item.id)).toEqual(previous.map(item=>item.id));
  });

  it('rejects a reference to a source outside the current project without replacing its route', async () => {
    const { store, service } = await environment(() => route([definition('条件概率', [], ['other-material-0'])]));
    material(store, ['当前项目的内容。']);
    const original = store.get('projects', 'project')!;
    store.put('projects', { ...original, id: 'other-project', title: '另一个领域' });
    material(store, ['另一个学习项目的材料，不属于当前项目。'], 'other-material', 'other-project');
    await expect(service.generateRoute('project')).rejects.toThrow(/引用/);
    expect(store.list('capabilities', 'project')).toEqual([]);
    expect(store.get('projects', 'project')).toEqual(original);
  });

  it('starts from the active capability and retrieves relevant text beyond the opening chapters', async () => {
    const { store, service, provider } = await environment(input => activity(input));
    material(store, [...Array.from({ length: 30 }, (_, index) => `基础练习 ${index}：阅读与观察。`), '贝叶斯证据更新：先验与似然共同决定后验概率。']);
    store.transaction(() => {
      store.put('capabilities', { id: 'historical', projectId: 'project', title: '旧路线入口', description: '历史目标', prerequisites: [], sourceIds: ['material-0'], order: -1, archived: true });
      store.put('capabilities', { id: 'current', projectId: 'project', title: '贝叶斯证据更新', description: '判断先验与似然如何影响后验概率', prerequisites: [], sourceIds: [], order: 0, goalContext: store.get('projects', 'project')!.goal, archived: false });
    });
    const session = await service.start('project');
    expect(session.capabilityId).toBe('current');
    expect(provider.inputs.filter(input=>input.operation!=='review_teaching')).toHaveLength(1);
    expect(provider.inputs[0].sources.some((source: { id: string; text: string }) => source.id === 'material-30' && source.text.includes('先验与似然'))).toBe(true);
    expect(session.activity.sourceIds).toContain('material-30');
    expect(provider.inputs[0].capability.id).toBe('current');
  });

  it('rejects an in-flight route after the user changes the goal and preserves the new goal', async () => {
    let alterGoal: () => void = () => {};
    const { store, service } = await environment(() => { alterGoal(); return route([definition()]); });
    material(store, ['条件概率与证据。']);
    alterGoal = () => store.put('projects', { ...store.get('projects', 'project')!, goal: '独立检查论证中的隐藏前提', updatedAt: new Date().toISOString() });
    await expect(service.generateRoute('project')).rejects.toThrow(/生成期间/);
    expect(store.get('projects', 'project')?.goal).toBe('独立检查论证中的隐藏前提');
    expect(store.list('capabilities')).toEqual([]);
    expect(store.list('usage').map(item=>item.publicationStatus)).toEqual(['discarded']);
  });
});

describe('near-step usability before route publication',()=>{
 it.each(['用不同颜色标记至少两个例子里的构件，再口头说明。','口头说明这段话中的判断。','用下划线标出两个对象。'])('repairs unavailable route input: %s',async(objective)=>{
  const {store,service,provider}=await environment(input=>{const response=route([definition()]);response.nearSteps[0]={...response.nearSteps[0],objective:input.repair?'先看一段短示范，再用编号选出描述观察的一句。':objective,completion:'输入所选句子的编号即可继续。'};return response;});material(store,['这里有一个可阅读的具体例子。']);await service.generateRoute('project');
  expect(provider.requests).toHaveLength(2);expect(store.get('projects','project')?.nearSteps?.[0].objective).toContain('用编号选出');expect(store.get('projects','project')?.nearSteps?.[0].objective).not.toMatch(/颜色|口头|下划线/);expect(store.list('usage').map(u=>u.publicationStatus)).toEqual(['discarded','published']);
 });
 it('repairs a novice first step that bundles multiple examples into one entrance',async()=>{
  const {store,service,provider}=await environment(input=>{const response=route([definition()]);response.nearSteps[0]={...response.nearSteps[0],objective:input.repair?'看过一个简短示范后，输入一个观察句子的编号。':'先区分全部构件，用至少两个例子分别解释每个构件，并说明它们之间的关系。',completion:'选出一个观察句即可继续。'};return response;});material(store,['从一个观察句开始。']);service.saveStartingPoint('project',{familiarity:'new',background:'完全陌生'});await service.generateRoute('project');
  expect(provider.requests).toHaveLength(2);expect(store.get('projects','project')?.nearSteps?.[0].objective).toBe('看过一个简短示范后，输入一个观察句子的编号。');expect(store.list('evidence')).toHaveLength(0);
 });
});
it('repairs redundant source lists before publishing a compact route and reserves the finite output allowance',async()=>{
 const ids=Array.from({length:6},(_,index)=>'material-'+index);const {store,service,provider}=await environment(input=>{const definitions=[definition('辨认条件',[],input.repair?ids.slice(0,2):ids),definition('比较条件',[],[ids[1]]),definition('说明边界',[],[ids[2]])];const response=route(definitions);response.nearSteps=response.nearSteps.map(step=>({...step,sourceIds:input.repair?ids.slice(0,2):ids}));return response;});material(store,ids.map((_,index)=>'可核对的真实材料片段'+index));await service.generateRoute('project');
 expect(provider.requests).toHaveLength(2);expect(provider.requests.map(request=>request.maxOutputTokens)).toEqual([9000,12000]);expect(store.list('capabilities').every(cap=>cap.sourceIds.length<=3&&cap.sourceIds.every(id=>ids.includes(id)))).toBe(true);expect(store.get('projects','project')?.nearSteps?.every(step=>step.sourceIds.length<=3)).toBe(true);expect(store.list('usage').map(usage=>usage.publicationStatus)).toEqual(['discarded','published']);
});
it('sends exact current source enums and repairs an invented source before publication',async()=>{
 const ids=['material-0','material-1','material-2'];const {store,service,provider}=await environment(raw=>route([definition('条件',[],raw.repair?[ids[0]]:['fabricated-id']),definition('比较',[],[ids[1]]),definition('边界',[],[ids[2]])]));material(store,['当前来源一','当前来源二','当前来源三']);await service.generateRoute('project');
 expect(provider.requests).toHaveLength(2);const schema=provider.requests[0].schema as any;expect(schema.properties.capabilities.items.properties.sourceIds.items.enum).toEqual(ids);expect(schema.properties.nearSteps.items.properties.sourceIds.items.enum).toEqual(ids);expect(store.list('capabilities').every(cap=>cap.sourceIds.every(id=>ids.includes(id)))).toBe(true);
});

it('limits source references to an empty array when no materials were provided',async()=>{
 const {store,service,provider}=await environment(raw=>route([definition('起点',[],raw.repair?[]:['invented']),definition('比较',[],[]),definition('回看',[],[])]));await service.generateRoute('project');expect(provider.requests).toHaveLength(2);expect((provider.requests[0].schema as any).properties.capabilities.items.properties.sourceIds.maxItems).toBe(0);expect(store.list('capabilities').every(cap=>cap.sourceIds.length===0)).toBe(true);
});

it.each(['答出4即可继续。','正确回答“乙”即可继续。','能正确说出甲路径最高能量为5','能正确选择乙路径','能回答更小或不变'])('repairs a completion that leaks the answer: %s',async(completion)=>{
 const {store,service,provider}=await environment(raw=>{const response=route([definition()]);response.nearSteps[0]={...response.nearSteps[0],objective:'看过不同例子的示范后，从一列能量数中选出最高值。',completion:raw.repair?'能指出这一列中的最高值即可，不要求解释多条路径。':completion};return response;});material(store,['完整离散路径上的能量可以逐个比较。']);await service.generateRoute('project');expect(provider.requests).toHaveLength(2);expect(store.get('projects','project')?.nearSteps?.[0].completion).not.toMatch(/答出4|回答“乙”/);
});
it('separates topic unfamiliarity from reported foundations and asks for action previews without worked tasks',async()=>{
 const {store,service,provider}=await environment(()=>route([definition()]));material(store,['有限候选与完整集合的关系。']);service.saveStartingPoint('project',{familiarity:'new',background:'熟悉集合、连续性和下确界；第一次接触本主题。'});await service.generateRoute('project');
 const request=provider.inputs[0];expect(request.entryContext).toEqual({topicFamiliarity:'new',priorKnowledge:'self_reported'});expect(request.instruction).toContain('对主题陌生不等于先修陌生');expect(request.instruction).toContain('路线只预览动作目标，不放具体练习题');expect(request.instruction).toContain('真正题目只在开始学习活动时生成');expect(request.firstStepLimits.learnerActions).toBe(1);expect(store.list('evidence')).toEqual([]);
});
