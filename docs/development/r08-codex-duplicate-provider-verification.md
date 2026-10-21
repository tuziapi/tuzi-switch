# R08 Codex 同名 provider 卡片

2026-10-21，用户批准“卡片独立保存、允许重复 provider ID、启用时替换对应配置段”。客户端 `codex/tuzi-assistant-system-token` 基于 `5309d39370fe2e0708921a5e61018905e8a1620d`。API 同分支 `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425`，工作树干净、未修改；B4 / system-token-v1 无变化。仅本地修复、测试、构建和提交，无 push/PR/上线；搜索清空问题仍按用户要求不修改。

## 实现

见 [ADR-013](decisions/0013-codex-card-local-provider-ids.md)。取消跨卡片 provider ID 唯一性检查，移除 inactive 卡片预注册；save_codex_route 不提前写入 live/profile。将 TOML 编辑合并放到实际生效路径，并结构化整体替换目标 provider 表，避免旧 nested headers/retries 残留。凭证唯一性、R07 读取逻辑、账户备份恢复保留。

## 验证

全部使用隔离合成凭证和文件，不读取实际 Key、不调用付费模型。

- `cargo test --manifest-path src-tauri/Cargo.toml --test provider_commands -- --test-threads=1`：20 项通过。覆盖准备草稿/新增/未启用编辑均不改变 live，B→A→B→A 往返后地址、Key、名称和扩展字段准确，当前编辑删除旧字段、删除非当前卡片不改变 live，MCP 保留，以及原缺少凭证切换失败保护。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib services::tuzi_provider`：14 项通过。原第二条 Codex 账户保存测试改为相同 custom，两个真实保存后的独立引用均可通过生产异步解析器读出各自合成 Key，备份恢复及外部修改检查通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib services::provider`：29 项通过。
- `pnpm typecheck`：通过。
- `pnpm exec vitest run tests/components/ProviderForm.test.tsx tests/components/ProviderForm.hiddenEnv.test.tsx tests/hooks/useCodexConfigState.test.tsx`：3 文件12项通过。

- `cargo test --manifest-path src-tauri/Cargo.toml --lib codex_config`：68 项通过，包括带引号表头和嵌套字段整体替换。合计143项定向测试通过。
- `pnpm tauri build --debug --bundles app --config /tmp/tuzi-r08-build.json`：通过，包含 renderer 构建。保留既有 Rust dead_code、浏览器数据及打包体积警告。
- `git diff --check`：通过。

此前全库历史恢复测试失败仍按 R02 记录，不宣称本轮全库、三平台或真实账户联调通过。

## 测试客户端

产物：`src-tauri/target/debug/bundle/macos/兔子助手 R08 测试.app`。沿用 `com.tuziswitch.desktop.r06test` 和 `/Users/syd08/Library/Application Support/com.tuziswitch.desktop.r06test/home`；通过 Info.plist LSEnvironment 设置 CC_SWITCH_TEST_HOME，ad-hoc 重签名并验证。正常退出 R07 后打开 R08；不会同时运行共享数据的两个测试包，不接管日常 `~/.codex`。

用户验收：新建两张 provider ID 都是 custom、但地址和 Key 不同的卡片；编辑未启用卡片应不改变当前卡片，往返启用应恢复各自模型/地址/Key，分别手动“测试模型”。本轮未主动测试真实 Key 或进行付费模型调用。
