# R02 模型列表与 Codex 编辑修复验证

2026-10-21，macOS，本地客户端 `codex/tuzi-assistant-system-token`。先将 v1.4.1 发布工作树通过 merge `48b5b4d` 保留到指定分支（合并结果与发布工作树一致），再实施修复。API 目录只读，HEAD `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425`、工作树干净；不以该本地 SHA 代表线上版本。本轮无 push、PR 或发布。

实现及取舍见 [ADR-012](decisions/0012-key-model-list-and-toml-drafts.md)。模型下拉使用 modal Popover、有限高度与内部滚动，全文本地搜索和刷新，无价格分页截断。TOML 草稿保留输入，不生成逐字 provider 残片，保存前报错而非偷偷修复。

## 验证

- `pnpm typecheck` 通过。
- `pnpm exec vitest run tests/components/CodexEditorRegression.test.tsx tests/account tests/hooks/useCodexConfigState.test.tsx tests/components/ProviderForm.test.tsx tests/components/CodexConfigSections.test.tsx tests/utils/providerConfigUtils.codex.test.ts tests/utils/codexConfigValidation.test.ts`：11文件145项通过。
- 真实 CodeMirror 组件：连续改 provider 标识光标保持、无残片；显式完成重命名后提交，MCP 自定义段保留。验证合法父表、缺 name、错误指向和 Markdown URL。
- `cargo test --lib tuzi_account`：41通过、1项既有真实 Go 配对测试忽略。合成 loopback HTTP 覆盖130模型完整返回、3/4/50模型保存资格、缺失/协议变化/错误拒绝、退出期间回包失效；断言账户与模型请求的认证 Header 分离，列表响应不含 Key。
- `cargo test --lib`：1405通过、1失败、1忽略。失败为未修改模块 `codex_history_migration::tests::restores_only_ledgered_official_sessions_from_backups` 第2423行，第二次恢复预期0文件，实际1；单独重跑仍失败。不能声称全库通过，本轮不扩大到历史迁移修复。
- 浏览器实际交互使用 `tests/visual/r02.html` 合成夹具：Codex 显示第101/102条 gpt-6.1-sol/gpt-6-astra；滚轮后列表 scrollTop=802，clientHeight=254，scrollHeight=1056，成功选择底部 synthetic-model-129。
- `pnpm tauri build --debug --bundles app --config /tmp/tuzi-r02-build.json` 成功（含 renderer 构建）。已有体积/浏览器数据和 Rust dead_code 警告保留。
- `git diff --check` 通过。仅合成验证；实际 Key 联调和用户验收待用户操作。

## 用户测试应用

应用：`src-tauri/target/debug/bundle/macos/兔子助手 R02 测试.app`，identifier `com.tuziswitch.desktop.r02test`，版本仍1.4.1，无版本脚本。配置覆盖 productName/identifier/窗口标题及 createUpdaterArtifacts=false，普通构建连接真实 API，未启用指向 localhost 的 local-preview feature。

构建产物 Info.plist 的 LSEnvironment 设置 CC_SWITCH_TEST_HOME 为 `/Users/syd08/Library/Application Support/com.tuziswitch.desktop.r02test/home`，重新本地 ad-hoc codesign。已启动并确认该独立目录及数据库创建，停留在未连接的账户页。账户文件、助手数据库和工具配置均使用隔离目录；未导入用户旧配置或自动修复已损坏文件。该包不是发布/公证安装包，重新构建需重新设置隔离环境。

验收建议：连接账户 → Key配置Codex并核对6.1-sol/6-astra → Claude/Gemini长列表滚动到底 → 创建合成供应商后编辑TOML，保存并重新打开确认 → 故意残缺provider，确认阻止保存。隔离目录中的工具配置不会直接替换用户日常 Codex 配置。
