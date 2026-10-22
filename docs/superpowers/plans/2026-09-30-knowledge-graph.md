# 重登 0.7 Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 交付可跨项目参考旧学习表现、完成短验证并追踪撤回影响的知识图谱版。

**Architecture:** 项目已有实体组成可重建属性图，用户关系决定与实际教学使用上下文分别持久保存。共享纯查询层服务界面和主进程；所有能力判定继续经过既有核验链。

**Tech Stack:** Electron 44.2.0、TypeScript、React 19.2、sql.js 1.14.1、Zod、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-30-knowledge-graph-design.md`

## Global Constraints

- 基线 0.6.0 / 12ab825，独立分支 codex/reclimb-knowledge-graph；交付版本 0.7.0。
- Windows x64；不添加图库服务、Python 或自动网络请求。
- 确认关系不创建学习证据、不自动跳过单元；缺少证据保持未知。
- 私有核验解答不得写入公开图谱或上下文摘要。
- 旧数据迁移前备份；schema/备份格式12；旧同步hash兼容。
- 图谱持久记录进入备份、恢复、同步、可读导出和清除流程。

## Task 1: 可追溯关系与本地查询

**Files:** 新增 `src/shared/knowledge-graph.ts`、`src/main/knowledge-service.ts`、`tests/knowledge-graph.test.ts`、`tests/knowledge-storage.test.ts`；修改 `src/shared/types.ts`、`src/main/store.ts`、`src/main/backup.ts`、`src/main/sync-workspace.ts`、`src/main/readable-export.ts` 及相关版本回归测试。

**Interfaces:** 产出 `KnowledgeRelation`、`KnowledgeUse`、`KnowledgeView`、`KnowledgeMemory`；`buildKnowledgeView(snapshot,projectId,capabilityId?)` 与 `knowledgeMemory(snapshot,projectId,capabilityId)` 为纯函数；`KnowledgeService` 提供 `confirm(input)`、`retract(input)`、`view(projectId,capabilityId?)`、`rememberUse(teachingVersionId,memory)`。

- [x] 写行为测试：同名候选不产生有效关联；确认后仅有效旧表现被引用；撤回、范围变化、原证据失效、回收站项目及跨项目清除均停止复用；一条无帮助但未达标记录不能变为独立支持。
- [x] 运行 `npx vitest run tests/knowledge-graph.test.ts tests/knowledge-storage.test.ts`，记录新能力缺失的失败。
- [x] 实现追加式关系、范围签名、受限图构建、先修查询、证据过滤、影响分析及服务输入校验。
- [x] 实现 v12 表/快照/schema迁移、引用验证、备份回灌、同步hash兼容、可读导出及清除。
- [x] 运行图谱与存储/备份/同步回归测试，提交该任务。

关键测试形态：
```ts
const memory = knowledgeMemory(store.snapshot(), 'new-project', 'new-capability');
expect(memory.entries).toEqual([]); // 尚未确认的同名目标保持未知
const relation = graph.confirm(input);
expect(knowledgeMemory(store.snapshot(), 'new-project', 'new-capability').entries).not.toEqual([]);
expect(store.list('evidence', 'new-project')).toEqual([]);
graph.retract({relationId: relation.id, reason: '定义条件不同'});
expect(knowledgeMemory(store.snapshot(), 'new-project', 'new-capability').entries).toEqual([]);
```

## Task 2: 实际教学复用与短验证

**Files:** 修改 `src/main/learning-service.ts`、`src/main/index.ts`、`src/shared/types.ts`；新增 `tests/knowledge-learning.test.ts`。

**Interfaces:** 消费 Task 1 的 KnowledgeMemory；IPC `knowledge.confirm`、`knowledge.retract` 返回更新快照，`knowledge.view` 返回 KnowledgeView，`knowledge.check` 创建当前能力的短验证会话。

- [x] 用真实 LearningStore 和本机模型替身写失败测试，检查传给模型的 `priorLearning`、短验证约束、并发撤回时过时结果不发布。
- [x] 在 generatePlan 取得且发布前核对 memory；将公开旧表现提供给生成请求，冻结实际使用记录。
- [x] 显式短验证只生成一个 check，复用既有教学核验与新作答证据流程。
- [x] 在主进程注册动作，严格解析输入，明确处理项目暂停、回收站和不存在的目标。
- [x] 运行 `npx vitest run tests/knowledge-learning.test.ts tests/local-planning.test.ts tests/learning-progression.test.ts tests/reliability-integration.test.ts`，提交。

## Task 3: 学习关联与依据界面

**Files:** 新增 `src/renderer/LearningRelationsPanel.tsx` 及相关样式、界面行为测试；修改路线/学习页面和 App 导航的必要入口。

**Interfaces:** 消费共享 KnowledgeView 和通用 DesktopAction。面板用当前 snapshot 构建图，写动作通过 IPC 持久化。旧作答通过现有会话导航显示。

- [x] 先验证空项目、候选对照、确认/撤回、待短验证、失效影响各状态的显示与操作。
- [x] 实现当前能力选择、候选搜索和关系确认/撤回表单；显示完整定义、目标及旧证据的帮助/时间。
- [x] 实现先修缺口、局部关系视图和可访问文字说明，提供旧作答和短验证入口。
- [x] 当前会话若使用依据失效则提示复核，不掩盖原记录、不改变其证据状态。
- [x] 运行 UI 检查和类型检查，提交。

## Task 4: 桌面验收、版本与交付

**Files:** 新增 `scripts/smoke-v070.mjs`、发布合同、验证脚本和0.7使用/验证说明；更新 package.json/package-lock.json 与 README。

- [x] 运行完整基线与最终测试、build，并修复图谱影响的回归。
- [x] 使用 Electron 与本地模拟服务完成两个项目的候选→确认→短验证→新作答→撤回/纠错→重新打开流程，检查来源跳转与截图。
- [x] 验证备份还原与原0.6档案升级；所有开发验证使用合成材料。
- [x] 打包 Windows x64 安装包，运行依赖/交付检查；记录精确检查结果和未验证的真实模型教学效果。
- [x] 审查完整分支差异并修复重要问题，提交最终版本；保留分支和工作区供用户审阅。
