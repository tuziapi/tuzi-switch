# verified-desktop-updates 完整本地同步

任务：`SYNC-DESKTOP-LOCAL-01`；日期：2026-11-15（Asia/Shanghai）。

用户审阅完整同步与选择性移植的差异后选择 A：完整本地同步并验证。范围仅为本地合并、依赖安装、合成测试、构建和 commit；未 push、创建 PR、发布、安装应用、调用真实模型或访问生产数据。

## 来源与保留

- 同步前分支：`codex/sync-pr73-preserve-local`，HEAD `51681502a2ef640adb5b63793a5e2c375c23ea18`；工作区干净。
- 同步源：`AiW520/tuzi-switch` 的 `codex/verified-desktop-updates`，锁定本轮已审阅提交 `9d2a60ee92be7d3537dd8a4c0bf9b1995f63c32a`。
- 新的本地集成分支：`codex/sync-verified-desktop-updates`，位于 `/Users/sdy09/Documents/tuzi-switch`。
- 原分支保持原提交；新增备份指针 `codex/backup-before-desktop-sync-20261115`。
- 原 HEAD 是源提交的祖先，使用 `git merge --ff-only` 完整接入17个提交、63个文件变更，无冲突。PR #73、本地代码与历史文档留档全部保留。
- 产品代码、锁文件和工作流与上述源提交完全一致。本次额外提交只增加本地同步证据及开发入口，不改写来源分支的历史验收记录。

## 接入范围与兼容

1. Seedream 5.5 生图、透明 PNG、分层/OCR，及画布保存、重载、manifest 导出中的元数据保留。
2. 最终原生模型请求出口的桌面来源标记；正式、测试/开发渠道分离，不改第三方地址或认证权限。
3. 签名候选构建、逐安装类型验收、同一批候选字节晋级，以及独立升级实验和 Windows 超时诊断。
4. Tauri 宿主 JS/CLI 版本配对、签名子进程兼容及退出时窗口状态保存修复。
5. 1.6.2 候选版本、新正式更新公钥和一次手动安装过渡策略。仅同步公开配置；没有读取、生成、替换任何私钥或操作远程 Secrets。

新增字段已随原分支完整接入：Seedream 请求的可选 size/textRecognition/outputFormat，图层的可选 background/textRecognition/providerMetadata，以及候选/验收的渠道、交付方式、公钥摘要和文件白名单字段。旧图层缺省兼容，显式 false 与未知扩展保留由现有测试覆盖；没有新增数据库列或账户权限。正式验收 JSON 尚不存在，不为通过发布门禁伪填 passed。

账户契约仍为 `system-token-v1`。Seedream 的来源记录配对 API `28443ae853a24165b23638a8b98d3ad96ddba4f0`；本次未修改或重新验收 API 仓库，不据此声明线上服务兼容已验证。

## 本轮重新执行的验证

环境：macOS ARM64、Node 22.23.2、pnpm 10.33.0、Rust/Cargo 1.95。冻结锁文件安装通过，锁文件没有额外变化。测试凭证、图片、签名密钥和 HTTP 服务均使用合成数据。

| 检查 | 命令与结果 |
| --- | --- |
| 宿主测试 | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1` 首轮97文件835项通过，2文件因创作构建产物缺失无法加载；完成创作构建后定向重跑 `tests/components/CreativeWorkspace.test.tsx tests/hooks/useModelUpgradeSync.test.tsx`，2文件4项通过；合计99文件839项，未将首轮描述为全绿 |
| 创作模块全量 | `pnpm test:creative`：159文件2681项通过 |
| 类型 | `pnpm typecheck`：通过 |
| 前端构建 | `NODE_OPTIONS=--max-old-space-size=4096 pnpm build:renderer` 的创作阶段通过；用户中断时宿主阶段尚未完成，继续后以同一源码执行 `NODE_OPTIONS=--max-old-space-size=4096 pnpm exec vite build`，宿主通过；两个阶段均有日志 |
| Tauri 配对与签名/发布校验 | `node scripts/tauri-compatibility.mjs` 通过；`node --test scripts/verify-updater-assets.mjs scripts/verify-update-acceptance.mjs scripts/verify-tauri-compatibility.mjs`：17项通过，签名使用临时合成密钥 |
| 安装文件校验器 | `python3 scripts/test_release_assets.py`：5项通过 |
| 原生定向 | `cargo test --locked -j 2 --manifest-path src-tauri/Cargo.toml --lib --features updater-acceptance -- creative_attribution creative_http tuzi_account::creative acceptance_profile_ --test-threads=1`：25项通过，编译覆盖 Mac 的实验 feature，HTTP 仅访问本机合成服务 |
| 双浏览器流程 | 运行现有 `tests/visual/seedream55-acceptance.cjs`，Chrome 与 WebKit 均通过透明 PNG 请求、分层/OCR、三层相同 URL 不合并、OCR 展示、画布保存和刷新恢复；所有外网请求拦截，HTTP 边界合成；Chrome OCR 截图已查看 |
| 实验脚本 | `scripts/native-upgrade-lab.py` 的 Python AST 语法检查通过；未运行实际安装升级实验 |
| Git | 合并祖先、源代码一致性、版本配对、历史留档保留及 `git diff --check` 通过 |

原生日志中的第一次调用把多个筛选词放在 Cargo 参数区而被拒绝，未运行测试；已改为传入 `--` 后的 libtest 参数。其后编译被用户中断，继续后25项全部完成。前端保留既有 Sass、动态导入、chunk 大小及浏览器数据库告警，未扩大依赖升级或格式化范围。

原始日志和两组浏览器结果位于 `/tmp/tuzi-desktop-sync-20261115.6lwYGF/`；浏览器汇总持久保存在 [本轮证据](evidence/2026-11-15-verified-desktop-local-sync.json)。测试运行时复用仓库外已有 Playwright，不修改项目依赖。

## 尚未验收与回退

- 本轮是源码同步和本地验证，不是正式安装包验收或发布。未安装或升级用户正在使用的应用。
- 源分支已归档的 Windows NSIS 安装超时尚无本轮通过证明；MSI/DEB/RPM、正式旧版手动过渡及后续新公钥升级仍须各自验收。此次 macOS 编译不证明 Windows 诊断代码或跨平台安装通过。
- Seedream 真实供应商权限、生成效果、透明像素、OCR 准确率和计费，以及生产经营统计入库未重新验证。
- 如需回到同步前，可在保存后续修改后切回保留的原分支或备份分支。若在已提交集成历史上回退，按仓库规则使用审阅后的 revert；不 reset --hard、不重写远程、不清理用户数据。

上游实现和历史限制见 [逐项清单](2026-11-15-desktop-task-checklist.md)、[升级验收](2026-11-15-desktop-upgrade-acceptance.md)、[Seedream 适配](2026-11-15-seedream55-desktop.md)。
