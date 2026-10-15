# 脚本入口

在项目根目录运行下列命令；日常操作优先使用 npm 入口，避免依赖某个版本脚本的实际位置。

| 目的 | 命令 |
| --- | --- |
| 启动开发环境 | `npm run dev` |
| 类型检查、构建应用 | `npm run build` |
| 运行全部单元测试 | `npm test` |
| 当前版本桌面检查 | `npm run test:desktop` |
| 累计桌面回归检查 | `npm run test:desktop:full` |
| 按发布契约选择测试范围 | `npm run test:patch` |
| 创建 Windows 安装包 | `npm run package` |
| 验证安装包内的实际应用 | `npm run verify:package` |
| 创建源码归档 | `npm run package:source` |
| 检查源码白名单 | `node scripts/validation/audit-source.mjs` |
| 核对源码包、安装包与验证报告 | `node scripts/release/verify-delivery.mjs` |

`package` 和 `package:source` 按 `package.json` 中的版本号生成 `release/` 下的文件。同一版本再次打包会覆盖同名产物；已发布版本的原始附件应保留，正式交付使用独立版本号。

## 目录用途

| 位置 | 内容 |
| --- | --- |
| `build/` | 主程序、平板端、图标构建 |
| `desktop/` | 累计桌面流程、模拟服务、原创测试材料及导航辅助 |
| `release/` | 版本契约、安装包核对、源码归档、交付核对 |
| `validation/` | 源码审计、测试范围选择、需要显式参数的人工验证工具 |
| `dev.mjs` | 开发环境入口 |
| `source-files.mjs` | 源码归档的显式白名单 |

## 旧路径对照

历史验证记录和实施计划保留当时执行的命令。重新执行时，npm 命令名不变；直接脚本路径按以下规则查找：

- `scripts/smoke-*.mjs`、`desktop-navigation.mjs`、`fixture-pdf.mjs` 移至 `scripts/desktop/`。
- `scripts/build-main.mjs`、`build-companion.mjs`、`render-icon.mjs` 移至 `scripts/build/`。
- `scripts/release-contract-*.json`、`verify-package*.ps1`、`verify-packaged-dependencies.mjs`、`verify-delivery.mjs`、`package-source.mjs`、`check-package-input.mjs` 移至 `scripts/release/`。
- `scripts/audit-source.mjs`、`test-profile.mjs`、`live-validation.ts`、`run-live-validation.mjs` 移至 `scripts/validation/`。

各版本契约保留原有版本号、检查数量和桌面报告名称。旧脚本仍参与累计回归，并非过期文件。

人工模型验证工具仍要求明确提供配置、自编案例、隔离账本、报告位置及预算；仅在带 `--execute` 时发送请求。具体限制见脚本参数说明与[开发文档索引](../docs/README.md)。
