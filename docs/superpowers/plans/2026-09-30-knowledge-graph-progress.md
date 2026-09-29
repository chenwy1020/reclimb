# SDD ledger — plan: docs/superpowers/plans/2026-09-30-knowledge-graph.md

## 基线与决定

- 已获用户明确开发和新分支提交授权；之前的方案比较和用户认可构成设计依据。
- 2026-09-30 新建独立工作区 `.worktrees/reclimb-knowledge-graph`，分支 `codex/reclimb-knowledge-graph`，基线 `12ab825`。主目录文档修改和0.6工作区保留。
- 离线 npm 缓存缺包，使用同锁文件0.6 node_modules的只读来源副本完成环境准备；不更改依赖版本。

## 接口检查

| 任务 | 检查 | 结论 |
|---|---|---|
| 1 | 追加关系历史、查询与备份校验 | 同一共享类型和领域验证，避免保存后无法恢复 |
| 2 | 消费图谱背景，不冒充新表现 | 独立短验证沿既有教学核验链；只保存已发布版本的实际使用 |
| 3 | 读取纯函数视图，修改通过IPC | 界面不计算新的掌握结论、不暴露私有解答 |
| 4 | 验收与发布一致 | 0.7.0 / schema12，真实模型效果另列未知 |
| 1↔2 | shared/types、KnowledgeMemory | Task 1负责类型，Task 2后续只添加动作，避免并发覆盖 |
| 1↔3 | KnowledgeView与服务payload | 实现者先发布类型合同，界面再接入 |
| 2↔3 | knowledge.check及导航 | 复用lesson.start返回session ID与公共快照；真实桌面验收 |

## 进度

- 设计与计划已写入；基线依赖准备中。
- Task 1: pending
- Task 2: pending
- Task 3: pending
- Task 4: pending
