# 原创模型评测

20 份原创短材料，每份覆盖讲解、独立尝试、反馈和短回访，共 80 格。固定反馈题轮换正确解、等价解、隐蔽错误和缺条件回答；部分材料另有诱导泄题探针。参考答案只用于结果核对，不作为生成或核验提示。

## 运行

项目入口为 `npm run evaluate:product -- <参数>`。必须提供新隔离账本、配置、案例和新 JSON 报告的绝对路径，以及单批费用上限 `--cap`（大于 0、最多 3 元）。使用此目录的 `cases.json` 和 `config.example.json` 可直接做离线计划检查。

在当前工程根目录运行以下 PowerShell 示例，只检查完整的 80 格计划，不发请求：

```powershell
$projectPath = (Get-Location).Path
$evaluationId = [guid]::NewGuid().ToString('N')
npm run evaluate:product -- --workspace "$projectPath\.local-test-data\product-$evaluationId" --config "$projectPath\docs\fixtures\product-evaluation\config.example.json" --fixture "$projectPath\docs\fixtures\product-evaluation\cases.json" --report "$projectPath\output\product-dry-$evaluationId.json" --cap 1
```

不使用 npm 入口时，可等价执行 `node scripts/validation/run-product-evaluation.mjs <同样参数>`。示例配置的无效地址仅供离线检查；真实执行必须另用明确的服务配置。一个格的参数是在以上公共参数后加 `--case linear-water --stage feedback`；正式请求还需显式加 `--execute`。每次真实执行使用新的账本和报告路径，不覆盖先前结果。单批 3 元只是运行器保护上限，不能替代用户对收费执行的授权。

默认不读取密钥、不打开档案、不请求模型。真实执行需替换明确服务配置，将密钥放在配置指定的环境变量中，再显式加 `--execute`。可加 `--case <编号>`、`--stage explain|attempt|feedback|review` 缩小范围。手动 CI 同样默认离线；收费执行需主动选择并配置仓库密钥。无需自建服务器。

运行器复用生产代码的生成、独立核验、记录输入、回应和评分条件。每格保留请求数、时间、费用估算、公开内容、实际评分或转为讨论的结果。失败不当作通过，预算或协议失败后停止该批后续收费调用。报告含未审查的质量字段，初始值为 `null`；不得直接把结构校验通过写成数学正确或教学有效。

## 结果核对

- 核对公开题干、讲解和标准是否提前泄题，私有核验解答不属于公开输出。
- 对照原材料和预置解，逐条检查条件、计算、推导和评分。等价解应获得相同结论；缺条件题应保留不确定性。
- 分别统计已核对分母与未返回/未评分数量。模型或自动审阅结果应明确标为模型审阅，不能冒充人工一致率。
- 费用使用显式配置的估算单价，最终以服务商账单为准。没有流式首段数据时只报告端到端延迟。

结果仅支持该模型和这组短材料。两周自用、其他学习者试用、真实 iPad 和首次安装仍需独立记录。

## 汇总独立执行的报告

运行 `node scripts/validation/run-product-evaluation-summary.mjs --manifest <绝对路径.json> --report <新的绝对路径.json>`。清单包含 `fixture`（本案例文件）、`reports`（明确选择的报告路径数组，最多 80 份）和可选的 `reviews`（评阅记录数组文件），所有输入均为绝对路径。汇总只读取文件，不请求模型，不读取密钥。

汇总区分成功返回、错误、未运行与缺失格，统计实际请求数、配置价费用估算和端到端延迟。它拒绝重复格、重复请求以及不同材料版本或请求模型混合；重试需明确选择纳入哪个报告，旧报告仍保留。已完成全部请求不代表质量全部通过。

首次汇总的 `reviewTemplate` 可另存为评阅数组。逐格填写评阅者、`reviewerKind`（`agent` 或 `human`）、适用指标、判断和依据；未检查项目保留 `null`。代理复核与人工复核各有独立分母，代理结果不能写成人工一致率。评分标准本身存在歧义时，保留判断为 `null` 并说明争议；不能因为预置参考标为正确就自动认定模型误判。缺条件题也可能是有效的“能否确定”判断题，需逐题判断是否应阻断，不按案例标签直接加入拦截率分母。

材料、提示或执行环境变化后的定向复验应使用独立文件和报告，保留原始结果作为基线。首段延迟、账单实付和真人学习效果需要另外的证据，不能从本汇总推断。
