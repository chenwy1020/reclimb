import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import SettingsPage,{personalSettingsPayload,settingsAfterSnapshot} from '../src/renderer/SettingsPage';
import type {WorkspaceSnapshot} from '../src/shared/types';

const now='2026-09-12T00:00:00.000Z';
const snapshot={
 projects:[],capabilities:[],materials:[],fragments:[],sessions:[],attempts:[],evidence:[],reviews:[],
 sourceTranscriptions:[],teachingVersions:[],taskReviews:[],disputes:[],corrections:[],answerExposures:[],
 routeVersions:[],learningUnits:[],learningPositions:[],teachingObservations:[],understandingDrafts:[],readingLayouts:[],
 usage:[{id:'usage',requestId:'usage',createdAt:now,kind:'学习路线',model:'legacy-model',requestedModel:'deepseek-flash',reportedModel:'deepseek-flash-202609',profileName:'快速路线',inputTokens:12,outputTokens:8,estimatedCny:.01,status:'completed',entryType:'call',validationStatus:'valid',publicationStatus:'published'}],
 settings:{providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',monthlyBudgetCny:20,inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:2,priceUpdatedAt:now,hasApiKey:true,personalGoal:'',studyMinutes:30,confirmedPreferences:'',activeModelProfileId:'profile-fast',modelProfiles:[
  {id:'profile-fast',name:'快速路线',providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:2,priceUpdatedAt:now,enabled:true,hasApiKey:true},
  {id:'profile-careful',name:'严谨核验',providerName:'Fireworks',baseUrl:'https://api.fireworks.ai/inference/v1',model:'accounts/fireworks/models/deepseek-v4p1',inputPriceCnyPerMillion:3,outputPriceCnyPerMillion:8,priceUpdatedAt:now,enabled:true,hasApiKey:false}
 ]},dataDirectory:'x'
} as unknown as WorkspaceSnapshot;

describe('多模型设置界面',()=>{
 it('区分当前配置、可切换配置和一次调用的请求与服务商报告模型',()=>{
  const html=renderToStaticMarkup(createElement(SettingsPage,{snapshot,used:.01,busy:false,run:vi.fn(),onRestore:vi.fn()}));
  expect(html).toContain('模型配置');
  expect(html).toContain('快速路线');
  expect(html).toContain('严谨核验');
  expect(html).toContain('当前使用');
  expect(html).toContain('设为当前');
  expect(html).toContain('新增模型配置');
  expect(html).toContain('请求：deepseek-flash');
 expect(html).toContain('服务商报告：deepseek-flash-202609');
 });

 it('保存常规设置时不覆盖模型配置，并继续单独传递视觉密钥',()=>{
  const payload=personalSettingsPayload(snapshot.settings,'vision-secret') as Record<string,unknown>;
  expect(JSON.stringify(payload)).not.toContain('modelProfiles');
  expect(JSON.stringify(payload)).not.toContain('activeModelProfileId');
  expect(payload).toMatchObject({visionApiKey:'vision-secret'});
 });

 it('顶栏明确说明下一次请求使用哪个配置，并通过独立动作切换',()=>{
  const source=readFileSync(resolve(__dirname,'../src/renderer/App.tsx'),'utf8');
  expect(source).toContain('下一次请求使用');
  expect(source).toContain('已有内容保持原版本');
  expect(source).toContain("settings.modelProfile.activate");
  expect(source).toContain('下一次请求使用的模型配置');
  expect(source).toMatch(/key=\{\s*'settings-'\s*\+\s*restoreVersion\s*\}/);
  expect(source).toMatch(/result\.restored\s*===\s*true/);
 });

 it('模型列表刷新时保留尚未保存的常规设置',()=>{
  const edited={...snapshot.settings,monthlyBudgetCny:37,personalGoal:'尚未保存的目标'};
  const refreshed={...snapshot.settings,activeModelProfileId:'profile-careful',monthlyBudgetCny:20};
  expect(settingsAfterSnapshot(edited,refreshed,true)).toBe(edited);
  expect(settingsAfterSnapshot(edited,refreshed,false)).toBe(refreshed);
 });

 it('说明修改已配置接口时必须同时重新填写密钥',()=>{
  const source=readFileSync(resolve(__dirname,'../src/renderer/SettingsPage.tsx'),'utf8');
  expect(source).toContain('若修改接口地址，请同时重新填写密钥');
  expect(source).toMatch(/busy\s*\|\|\s*!!editing\s*\|\|\s*!profile\.enabled\s*\|\|\s*!profile\.hasApiKey/);
 });
});
