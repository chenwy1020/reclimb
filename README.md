# 重登 · 个人 AI 学习空间

当前版本：**0.7.1 维护预发行版**。包含此前本机 0.6 的局部学习、自主规划与固定验证，以及 0.7 的跨项目学习关联、具体表现与先修缺口、基于旧经验的短验证、关系撤回和纠错影响追踪；本次交付加入已核验的修复。全部关联保存在本机；数据库与备份格式仍为 12，多电脑接续请同步升级。

Windows 上的个人学习应用，用于阅读不同书籍、课程和文章，保留尝试、帮助和能力证据。Electron 主进程管理本地资料与模型调用，React 呈现学习桌，SQLite 保存长期档案。

本仓库当前为私有仓库，保留 `UNLICENSED`。尚未选择开源许可证，不提供公共包发布。

[0.7.1 使用说明](docs/guides/使用说明-0.7.1.md) · [0.7.1 验证记录](docs/verification/验证记录-0.7.1.md) · [全部文档与历史版本](docs/README.md)

## 安装与使用

Windows x64 安装包为 `Reclimb-Setup-0.7.1.exe`。升级前保留完整备份并退出旧版，再运行安装包；详细兼容范围见当前使用说明。安装包包含运行环境，普通使用者无需安装开发工具。

iPad 无需安装 App；配对页面在可信的同一局域网内使用，固定端口 47149，HTTP 连接不加密，程序不会自动修改防火墙。已打开的页面可断网续写；浏览器清理、IP 地址改变、锁屏回收和离线冷启动仍有边界，重要原稿请下载备份。真实 Apple Pencil 与 Safari 体验需实机验收，当前验收状态见验证记录。

## 项目目录

| 位置 | 内容与入口 |
| --- | --- |
| [src/main/](src/main/) | 桌面主进程、本地资料、模型调用与服务 |
| [src/renderer/](src/renderer/) | 学习桌界面 |
| [src/companion/](src/companion/) | iPad 配对与作答页面 |
| [src/importers/](src/importers/) | 学习材料导入 |
| [src/shared/](src/shared/) | 共享类型、规则与校验 |
| [tests/](tests/) | 自动测试与交付契约 |
| [scripts/](scripts/README.md) | 构建、桌面检查、发布与验证脚本的分类说明 |
| [docs/](docs/README.md) | 当前使用说明、验证记录、设计和历史文档索引 |
| [assets/](assets/) | 应用图标等静态资源 |
| `dist/`、`release/` | 本机构建结果与安装包，不进入 Git |
| `output/`、`.test-data/`、`.local-test-data/` | 本机输出与隔离验收资料，不进入 Git |

## 开发

使用 Windows x64 与 Node.js 24，并按锁文件安装依赖：

```powershell
npm ci
node node_modules/electron/install.js
$env:RECLIMB_DATA_DIR = Join-Path $PWD '.local-test-data'
npm run dev
```

开发和验收使用独立资料目录，不指向正在学习的档案。

日常使用下列稳定的 npm 入口；脚本分类与完整检查入口见[脚本说明](scripts/README.md)。

```powershell
npm run typecheck
npm run test:patch
npm run build
npm run test:desktop
npm run package
npm run verify:package
```

需要累计完整验证时使用 `npm run test:full`；导出源码包使用 `npm run package:source`。历史记录中的命令和结果保留当时状态，不代表本次重新执行。

完整备份包含模型配置名称、接口和价格信息，不包含任何服务密钥；每位使用者自行配置服务与预算，资料保存在各自电脑。

常规桌面检查默认使用自制 PDF 和本机模拟服务，不需要私人教材或真实 AI 密钥。0.7.1 沿用知识图谱版本的全量自动检查、类型检查、构建与累计桌面流程，并检查安装包中的依赖与 IPC 边界；局部学习、自主选路、页段核对、固定验证和 PDF 续读均纳入回归。本次发行验收见 0.7.1 验证记录，知识图谱闭环、真实 AI、实际 iPad 与跨日学习的既有状态见 0.7 验证记录。

## 设计原则

必要的摩擦应来自亲自思考、重构和迁移。系统错误、保存失败、低水平重复或反复维护 AI 的逻辑不属于学习者应该承担的困难。路线是一份可追溯的暂定判断，不是目录或闯关表；选择更快或更强的模型也不构成能力证据。题目核验、推进规则与能力证据管理仍不能代替真实教学效果的观察。

本仓库包含源码、通用测试和原创夹具。私人教材、学习档案、日志、凭据及个人验收账目不进入 Git。升级所需的定点修正逻辑暂保留在私有代码中；未来公开前还需进行去标识化审查。
