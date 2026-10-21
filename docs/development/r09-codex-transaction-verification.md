# R09 Codex 普通配置操作失败回滚

2026-10-21，客户端分支 `codex/tuzi-assistant-system-token`，基于 `b60a221` 实施。用户本轮明确授权修复后提交、推送并创建 PR；目标 main。不包含 PR 合并、Release 或部署。API `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425` 工作树干净、无修改，B4 / system-token-v1 不变。

## 结果

普通表单准备不再提前改 Key，Key 由最终原生保存处理并在入库前去除临时明文。Codex 新增、编辑、普通启用和供应商页代理热切换加入受保护的写入及失败补偿；账户入口复用既有事务。当前状态、Key、卡片和文件在可补偿错误后恢复；外部修改或恢复故障则明确报错并保留私有备份。

[ADR-014](decisions/0014-codex-save-activation-compensation.md) 说明写集、作用域、Windows 环境处理、备份权限和恢复边界。普通切换只备份 Codex 数据，不复制使用日志库；保留现有供应商健康记录。R08 同名 provider 功能和用户暂缓的搜索清空问题不变。

## 验证

环境：本机 macOS，隔离 HOME/CC_SWITCH_TEST_HOME、合成 Key，无实际账户/付费模型调用。

- `cargo test --manifest-path src-tauri/Cargo.toml --lib services::tuzi_provider`：19 项通过。新增5项包含对新增/编辑/启用逐文件写入点注入故障，直到成功；比较文件内容/权限、Key、数据库、内存中的当前状态和健康记录；另覆盖数据库更新拒绝、代理备份写入失败、外部修改不覆盖、恢复失败保留0700/0600备份。原七工具账户保存/恢复及独立凭证测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`：1415 通过、1 失败、1 忽略。唯一失败为 R02 已记录的 `codex_history_migration::tests::restores_only_ledgered_official_sessions_from_backups`，断言 left 1/right 0；本轮未改该模块。不能宣称全量绿灯。忽略项为既有真实配对测试。
- `pnpm typecheck`：通过。
- `pnpm exec vitest run tests/account tests/components/ProviderForm.test.tsx tests/components/ProviderForm.hiddenEnv.test.tsx tests/hooks/useCodexConfigState.test.tsx tests/components/CodexEditorRegression.test.tsx tests/utils/codexConfigValidation.test.ts`：11文件127项通过。包含普通编辑将Key传给最终保存、既有模型列表和TOML编辑回归。

- `cargo test --manifest-path src-tauri/Cargo.toml --test provider_commands -- --test-threads=1`：21项通过，包含原 R08 文件写入失败复现现在保持原当前状态，以及草稿准备不修改凭证文件。
- `pnpm tauri build --debug --bundles app --config /tmp/tuzi-r09-build.json`：macOS debug app 构建通过，包含 renderer；保留既有体积/浏览器数据及Rust dead_code警告。
- `git diff --check`：通过。

测试包 `src-tauri/target/debug/bundle/macos/兔子助手 R09 测试.app` 沿用 R06/R07/R08 identifier 和隔离目录，Info.plist 配置 CC_SWITCH_TEST_HOME 并 ad-hoc 重签名，不写日常 ~/.codex。PR 将包含该分支此前未合入 main 的 R02～R08 修复，以及本次 R09。未执行 Windows/Linux 实机验证或正式配置目录下 Codex 实际请求验收；不以编译、隔离测试代替上线验收。
