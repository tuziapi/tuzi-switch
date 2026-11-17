# UC-CL-INTEGRATE-1117：OpenTu 与 Claude 本地实现合并

## 结果与边界

用户在确认 ClaudeMom 会话尚未进入当前 OpenTu 验收包后批准“可以，合并吧”。本轮完成本地合并、回归、Mac ARM 统一验收包构建与独立安装。分支为 `codex/integrate-opentu-claude-1117`；没有 push、PR、远程合并或正式发布。

已安装 `/Applications/OpenTu 验收版.app`，同时包含 OpenTu 与 Claude Desktop 入口。原 `/Applications/兔子助手.app` 二进制摘要未变化。统一包使用独立配置目录，未复制正式账户或供应商凭证，未启动另一个会话正在使用的 Claude，未更改系统证书信任。

本轮证明两套实现可共同编译、回归、安装及恢复画布；不代表 Claude Chat、Cowork、语音、电脑控制全流程已通过真实客户验收，也不代表已完成 ChatGPT 客户端和付费模型联调。源分支的历史验收记录保留，其未通过项目不因合并而转为通过。

## 集成来源与冲突

- OpenTu 父提交：`4ff56e5400b374d294d2a56eaec7ccb5b734a02b`。
- Claude 父提交：`fb2562a0cf293052166c67fdb3b08650b83f8d6f`，对应会话 `01a1e224-cd1b-7860-b4dc-7e52746d679c`。
- 共同基线：`fa39f0f7a36d8c586dc4f3b04bafe06a82021de8`。
- 源目录 `/Users/sdy09/Documents/ChatGPT/tuzi-claude-local-p0` 仅只读核对；源会话后续提交不自动纳入本次固定快照。
- 另外定向同步源工作区已有的候选构建 Node 内存上限（4096 MiB）；文件快照 SHA-256 见 [integration.json](attachments/unified-opentu-claude-1117/integration.json)。没有覆盖源目录未提交改动。

三个冲突分别位于 README、progress 与 `src-tauri/src/config.rs`。文档同时保留两边历史入口；配置目录按 OpenTu 验收、Claude P0、本地预览、其他验收的顺序选择，联合特性保持既有 OpenTu 独立目录。

补齐 `build-claude-local-candidate.py --opentu-preview`，组合两项特性，复用 OpenTu 验收身份、深链及关闭自动更新的配置，同时打入 Node、来源信息和许可文件；普通候选构建参数不变。

Claude 模型目录新增后，旧账户表单合成测试缺少模型获取 Mock。已补齐共享 fixture 的 `claudeDesktopModelCatalog`，并验证实际表单获取模型、七工具原生保存恢复以及模型目录落库，避免新增字段仅在一端测试。

## 验证

| 验证项 | 结果 |
| --- | --- |
| 宿主全量测试 `pnpm test:unit` | 105 文件、886 项通过 |
| 创作全量测试 `pnpm test:creative` | 187 文件、2950 项通过 |
| `pnpm typecheck` | 通过 |
| Claude Node 运行时 | 91 项通过；仅合成、loopback |
| Node 归档/构建脚本 | 16 项通过 |
| 联合特性原生 `local_` 筛选 | 28 项通过，含隔离身份与本地会话 |
| 原生七工具表单保存恢复 | 1 项通过，含 Claude 模型目录 |
| 原生 `opentu_mcp` | 7 项通过，含鉴权和真实本地 HTTP |
| OpenTu 来源重建 | 1700 文件逐字节一致 |
| Claude 浏览器合成流程 | 启动前置、信任模拟、绑定、停止、崩溃恢复、英文窄屏通过 |
| Chromium 画布合成流程 | 原位进度→结果→刷新恢复，不重复提交 |
| WebKit 画布合成流程 | 失败→可编辑草稿→刷新恢复，不重复提交 |
| 联合包构建与本机启动 | 通过；debug / Mac ARM / 本地 ad-hoc 签名 |
| 本机冷重启与项目恢复 | 通过；两个既有项目保留，合成草稿、1 张参考图、提示词及模型恢复 |

过程中的失败不隐去：首次宿主全量因模型目录 Mock 缺失失败，修复后专项 17 项和全量通过；首次高负载并行创作测试在两个未改动图片测试文件中有 3 项超时，专项 28 项及最终全量复跑通过，未提高超时；原生首次依赖重复下载停滞，停止该构建脚本后复用相同版本的本机 sherpa 缓存，最终原生测试全部通过。编译有已有 `ensure_idle` 未使用警告。

本机重启后的 UI 控制曾返回捕获错误，重新绑定后确认点击已生效，再打开项目验证恢复；这不涉及重提生成请求。

结构化证据：[verification.json](attachments/unified-opentu-claude-1117/verification.json)、[成功流程](attachments/unified-opentu-claude-1117/canvas-success.json)、[失败恢复](attachments/unified-opentu-claude-1117/canvas-failure.json)。原始临时日志前缀为 `/tmp/tuzi-unified-`；不将运行环境凭证或完整用户日志纳入 Git。

## 构建与安装

本机 Rust 1.95，构建命令：

```sh
PATH=/Users/sdy09/.rustup/toolchains/1.95-aarch64-apple-darwin/bin:$PATH \
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_BUILD_JOBS=2 \
python3 scripts/build-claude-local-candidate.py --opentu-preview
```

原生测试使用相同工具链，增加 `CARGO_PROFILE_TEST_DEBUG=0`，执行 `cargo test --locked --manifest-path src-tauri/Cargo.toml --features claude-desktop-local,opentu-preview --lib FILTER -- --test-threads=1`；FILTER 分别为 `local_`、`actual_frontend_form_payloads_save_and_restore_all_seven_tools`、`opentu_mcp`。

输出位于 `src-tauri/target/debug/bundle/macos/OpenTu 验收版.app`。构建脚本不自动安装或发布；本轮在构建成功后对 bundle 做本地 ad-hoc 签名并校验，然后替换独立验收应用。旧验收包备份位于 `/Users/sdy09/Library/Application Support/Tuzi Local Backups/unified-opentu-claude-20261117-142719/`。

安装包主程序 SHA-256：`8f3570814f5696ba47bd7b814fa00cba6f9fd2e7632e736b826bc2d1468ad156`。内置 Node v24.22.3 在仅 `/usr/bin:/bin` PATH 下执行正常，fetch/WebSocket 可用。Node 来源、许可随包提供；正式更新签名和 Apple 公证未执行，验收包关闭自动更新。

实际 UI 显示 Claude Desktop 启动面板、Node.js 就绪、证书未信任；账户和线路未配置。OpenTu 的 ChatGPT 接入入口保留。证据与原应用摘要见 [install.json](attachments/unified-opentu-claude-1117/install.json)，完整构建配置见 [build-plan.json](attachments/unified-opentu-claude-1117/build-plan.json)。

回退此本地试用可退出验收应用后恢复上述备份；不会要求替换正式兔子助手。源码合并提交若需回退，应审查 merge 父提交后使用 revert，不能重置其他会话工作区。
