# Task 3：学习关联与依据界面

## 完成内容

- 路线页和学习桌增加可展开的“学习关联”面板，沿用现有主题、字体和通用操作入口。
- 当前能力选择、本地跨项目候选与不同名称搜索；对照两端能力定义、原目标与可打开的材料来源。
- 对应、相关、前置三类关系均要求填写理由；确认和撤回分别使用 `knowledge.confirm` / `knowledge.retract`，展示追加式决定历史。
- 显示表现日期（含年份）、当时直接帮助、达标情况、评价限制及不可用原因。旧项目表现与当前项目的具体表现分开展示。
- 只有共享查询提供有效旧独立表现时才启用短验证；`knowledge.check` 返回后从当前项目学习位置进入新会话。跳转前保留草稿、本机附加草稿及待完成输入保存。
- 来源会话与来源项目通过既有 `navigate` 跨项目跳转，回收站来源不提供错误跳转。
- 当前能力及先修缺口、有限局部图和可访问文字关系列表；没有确认时不输出掌握结论。
- 历史知识使用显示冻结公开摘要和影响原因。学习桌在面板外显示失效提醒，沿 `replacesVersionId` 防环追溯；能力已退出当前路线或来源已清除也不会掩盖旧使用提醒。
- 应用页脚更新为 0.7.0。

## 测试记录

先新增界面行为测试和空实现，运行 `npx vitest run tests/renderer-knowledge.test.ts`，观察到 8 个功能缺失的失败。之后分别增加并观察短验证资格、版本接续提醒、能力退休提醒的失败，再实现修复。

最终运行：

```text
npx vitest run tests/renderer-knowledge.test.ts tests/renderer-route-v04.test.ts tests/renderer-input-record.test.ts tests/renderer-reliability.test.ts
Test Files  4 passed (4)
Tests       24 passed (24)

npm run typecheck
exit 0
```

新界面测试共 15 项，覆盖空能力、候选对照、历史帮助与时间、确认理由及身份参数、撤回、短验证资格、来源导航、回收站不可跳转、图的文字说明、有效上下文提示及版本/退休后的失效影响。

测试使用合成档案，未调用外部模型。真实 Electron 交互、截图与发布包验证由 Task 4 整合执行；本报告不将 SSR/操作回调测试等同于桌面完整验收或真实教学效果。

## Task 4 交互定位

- 面板入口：`details.knowledge-panel > summary`。
- 能力选择：`select[aria-label="学习关联的当前能力"]`。
- 不同名称搜索：`input[aria-label="搜索其他名称"]`。
- 候选：`.knowledge-candidate`，当前项 `aria-pressed="true"`。
- 关系种类：`select[aria-label="关联种类"]`，值 `equivalent / related / prerequisite`。
- 确认理由：`textarea[aria-label="确认关联的理由"]`；按钮“确认这项关联”。
- 短验证：按钮“先做短验证”，无有效对应背景时禁用。
- 撤回：已确认卡片内 summary“撤回关联”，填写 `textarea[aria-label="撤回关联的理由"]`，点击“撤回这项关联”。
- 来源跳转：“查看旧作答”或“返回来源项目”。
- 失效提醒：`.knowledge-impact-notice`，`role="status"`。

## 未引入的依赖

没有新增 npm 包、图库、Python 服务或远程接口。界面通过共享纯函数查询当前公共快照，持久操作均走现有 IPC。
