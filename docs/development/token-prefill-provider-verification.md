# B11：标题、回跳填入与供应商保存验证

日期：2026-10-19；基线 `TA-AC-1.5-B4` / `system-token-v1`；用户已确认本地实施三项改动，并明确单 Key 配置应打开对应工具的兔子线路、填入所选 Key。安全边界以 [ADR-010](decisions/0010-token-prefill-and-provider-drafts.md) 为准。

## 代码配对与工作区

- 客户端 `/Users/syd08/Documents/tuzi-switch-system-token`，起点 `a48e8e16861929ec978f9fc05a8e26aa27e9c845`，B11代码 `b61f39a2b7c318ffa1b9ba12f1286664ca66c45d`。
- API `/Users/syd08/Documents/tuzi/tuzi-api-system-token`，起点 `00c56c39d6f27b63738976d50e740c01686ab4fd`，网站代码 `68b5b3bf6b8768b932c2b0bc247223644272c258`。
- 两仓目标分支都是 `codex/tuzi-assistant-system-token`。后续文档提交不改变被测代码。仅本地 commit，无 push/PR/远程合并/发布/生产操作。
- 初始8个已修改文件已快照到 `/tmp/tuzi-b11-existing/`。原 `business.rs` 合成模型夹具、Codex Key 回填修复及其测试、OpenCode预设测试、B09验证文档和 progress 文末原有修改均保留。B11在 ProviderForm/progress 中只暂存本轮增量，不混入此前改动。测试/构建基于完整当前工作树，依赖此前未提交的 Codex Key 回填修复；不声称 B11 干净提交单独覆盖此前缺陷。未跟踪 outputs 保留。

## 问题与修复证据

1. 供应商卡片 h3 原 `leading-none` 改为24px行高，为中文顶部留足空间。真实组件浏览器截图确认“兔子线路”完整显示。
2. 固定回跳仍不传令牌。原生5分钟单次许可、generation、无账户身份、验证中拦截及精确候选格式过滤；前端空输入、输入修订、卸载和状态变化保护。遮罩填入后仍手动连接，失败可手动粘贴。网站反馈与三语言客户端说明、七语言网站翻译同步。预览构建仅额外支持两个明确本机合成令牌，不放宽生产候选格式。
3. **直接复现的保存阻断**：真实 Codex 表单提交的 `provider.category` 为 undefined；分类 hook 只给编辑/预设初始化，没有处理显式创建草稿，提交又只传 activePreset 分类；Rust `validate_provider` 要求分类，因而拒绝请求。回归先失败（expected undefined to be aggregator），修复后真实表单带分类。Claude Desktop 同类遗漏一起修复。
4. 新建草稿统一“兔子线路”/tuzi图标、所选 Key/模型和对应主站端点；Codex复用现有线路生成器并保留独立环境键。OpenCode/OpenClaw/Hermes 之前标识为空，现预填唯一标识，保存采用用户最终提交的标识。既有配置继续按来源定位，不按名称覆盖。
5. 确认框采用高于全屏表单的层级、可滚动正文与固定底部按钮，长变更内容不再把按钮挤出视口。返回修改保留输入；预览/保存错误显示，保存中去重/禁止关闭，失败返回后重新预览。原生来源、模型资格、备份/并发校验/补偿逻辑保留。

## 验证命令与结果

客户端（macOS，本地依赖）：

```sh
pnpm typecheck
pnpm exec vitest run tests/components/AccountTokenPrefill.test.tsx tests/components/TuziProviderDialog.test.tsx tests/components/ProviderForm.test.tsx tests/components/AccountPage.test.tsx tests/account/tuzi-tool-compatibility.test.ts tests/account/account-improvements.test.tsx tests/hooks/useCodexConfigState.test.tsx tests/integration/App.test.tsx
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_ -- --nocapture
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --features local-preview --lib tuzi_account::prefill -- --nocapture
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh
```

- 前端8文件56项通过；最终提示/布局调整后相关2文件17项复跑通过；类型检查通过。
- 原生54通过、2既有忽略（真实Keychain/外部配对门禁）；预览候选测试3项通过。新增七工具真实表单 JSON 夹具经 React断言和 Rust反序列化→预览→真实隔离文件/内存DB保存→恢复双侧验证，不只是 Mock成功回调。全部写入临时 `CC_SWITCH_TEST_HOME`，无实际用户工具文件、账户凭证或模型请求。
- 网站5文件48项通过，`bun run build`通过；只改反馈/翻译，无业务Go/HTTP/权限/schema变更，所以不重复无关Go全包。
- 最终 renderer/macOS debug 预览构建通过。保留原有chunk大小和原生未使用项提示；前端存在既有嵌套按钮开发告警，不作为本轮新增功能通过的替代证据。
- `git diff --check`通过。未生成或编辑图片资源，截图只记录真实合成UI。

网站命令（API `web/`）：

```sh
bun test ./src/components/settings/personal/cards/SystemTokenCard.test.jsx ./src/helpers/auth.return-target.test.jsx ./src/helpers/loginReturnTarget.test.js ./src/helpers/auth.test.jsx ./src/components/settings/PersonalSetting.alert-migration.test.jsx
bun run build
```

## UI层级及限制

使用 `pnpm exec vite --config tests/visual/vite.config.ts` 的 `b11.html?mode=card|form|account` 隔离合成夹具，通过浏览器实际点击添加、确认保存，并验证遮罩填入与“仍未连接”。界面证据：

- [标题](b11-evidence/provider-title.jpg)
- [长内容确认框和固定按钮](b11-evidence/scrollable-confirm.jpg)
- [令牌遮罩预填、手动连接](b11-evidence/token-prefill.jpg)

UI夹具使用Mock IPC，不冒充网站→OS自定义协议→系统剪贴板的端到端实测。真实窗口经只读核查仍有用户未保存的新建表单，因此没有关闭、提交或重启它。新预览产物位于 `/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`；构建不意味着当前运行进程已更新。

仍未完成：真实系统剪贴板/浏览器回跳端到端、Windows/Linux安全存储/剪贴板及安装包、完整真实账户的七工具UI保存、用户验收。未绕过浏览器自定义协议限制；不对生产状态作推断。

### 2026-10-19 20:03 本地预览生效核查

用户反馈看不到改动后，确认旧进程启动于18:36:04，最新应用可执行文件构建时间为19:20:02。重新检查窗口时未保存表单已关闭，因此通过正常退出并按完整 `.app` 路径重启；新进程启动于20:03:04，已运行最新本地构建。实机截图确认供应商标题顶部完整显示，账户页恢复合成管理员连接，单Key配置入口可打开工具选择。保留用户继续操作的窗口，不执行供应商保存、账户断开或模型调用。自动填入及完整保存端到端限制仍如上；此次仅激活已有构建，无新增业务代码或生产发布。

## 回退

两端代码与后续文档分别 revert；网站仅提示兼容，可独立撤回。客户端回退恢复手动粘贴及原创建行为，不删安全记录、来源、备份或工具配置，不轮换令牌、不恢复A。原有未提交修复继续保留，不能用 reset/clean 清理。无部署或迁移顺序要求；未来发布仍另行授权。
