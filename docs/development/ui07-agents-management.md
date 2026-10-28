# UI-07 Agents 管理

日期：2026-10-27。用户授权开始下一阶段，在 `gaizhao` / `5bc4ff7f` 基础上本地接入 Agents 文件管理。仅客户端、原生本地文件适配、合成预览和文档变化；不修改 API、账户令牌、模型调用、工具 OAuth 或发布配置。无 push、PR、发布、部署和真实凭证操作。设计与替代方案见 [ADR-016](decisions/0016-native-agent-markdown-management.md)。

## 支持边界

Agents 页面当前支持两类工具的用户级 Markdown 文件：

- Claude Code：`~/.claude/agents/`，支持递归子目录；要求 frontmatter 含 `name` 和 `description`，name 使用小写字母、数字和连字符。
- OpenCode：`~/.config/opencode/agents/`，支持递归子目录；要求 `description`，`mode`（如存在）只能是 `subagent`、`primary` 或 `all`。

页面提供文件名搜索、原文编辑、创建、删除确认、刷新和上一次修改恢复。未知 frontmatter 字段原样保留；Claude 与 OpenCode 的文件不互相转换，不执行 Agent，也不把项目级、插件级或内置 Agent 混入用户级列表。Codex 的子代理并发设置和 OpenClaw 的 `agents.defaults` 仍使用各自现有设置/工具页面，避免伪装成同一格式。

其他工具从全局入口进入时显示明确支持范围，目标选择仅允许 Claude Code 或 OpenCode。没有目标时不读取、不写入文件，不静默回落 Claude；新工具和不支持工具不会产生 Agents IPC 请求。

## 原生安全和恢复

读写使用固定工具目录，拒绝绝对路径、`.`/`..`、重复分隔符、隐藏文件名、符号链接、非 UTF-8、非普通文件和超过 256 KiB 的单文件；集合上限 200 个文件、4 MiB。写入前对递归文件集计算 SHA-256 revision，外部变更会拒绝覆盖。创建目录和文件在 Unix 上分别使用 0700/0600，原子写入复用现有私有写入工具；进程内 Mutex 加工具目录锁避免并发写。

每个工具保留一个本地恢复记录，记录修改前的完整字节和目标根目录。新增、编辑、删除成功后可恢复一次；恢复要求当前 revision 与记录匹配，成功后消费恢复记录。保存失败会恢复旧记录，避免覆盖可回退状态。IPC 的 `content` 字段必须显式存在，只有 `null` 才代表删除；缺字段请求直接拒绝。

## 验证

- 前端：全量 Vitest `72 files / 499 tests` 通过；新增 AgentsPanel、路由和不支持工具回归。
- 原生：全量 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` 为 1437 通过、1 项既有真实配对忽略；Agents 专项 10 项通过。测试使用隔离临时目录，覆盖精确字节恢复、外部修改、重复 Claude name、无效 YAML、路径穿越、符号链接、权限、锁和备份失败。
- 类型、renderer 构建和独立 macOS debug 预览构建通过；保留既有 chunk 体积与 Rust 未使用代码警告。
- 合成预览仍为 `http://127.0.0.1:5193/ui04.html`，标题为 UI-07，展示 Claude/OpenCode 目标选择、文件列表、原生 Markdown 编辑器、保存和恢复按钮，IPC 全部使用内存合成数据。已在浏览器检查 OpenCode 页面和编辑器；未保存真实工具文件。
- 独立应用为 `src-tauri/target/debug/bundle/macos/兔子助手.app`，标识 `com.tuziswitch.desktop.preview`。构建成功；真实工具文件验收、三平台和用户验收仍待完成。

原生完整回归补跑时有一项既有 Codex 切换锁测试触发2秒超时；单独复跑通过，随后不并行构建的完整复跑为1437通过、1忽略，未调整测试超时或断言。日志 `/tmp/tuzi-ui07-native-all.log`、`/tmp/tuzi-ui07-lock-retry.log`；前端、类型、renderer和原生构建日志分别为 `/tmp/tuzi-ui07-{tests,typecheck,build,native-build}.log`。

桌面新版已启动并通过 AX 读取，但进一步自动点击被 macOS ScreenCaptureKit 捕捉错误中断；不能据此声称完成桌面内实际保存验收。浏览器合成预览已检查编辑和保存，以及窄窗口的目标选择与完整操作栏；截图 `/tmp/tuzi-ui07-agents.png`。实际字节级增改删恢复已由隔离文件测试验证，真实工具运行仍未验证。

后续可单独扩展项目级 Agent、Codex 原生 Agent 配置或 OpenClaw Agent 管理，但必须先冻结各工具格式和作用域，不能把它们混入本阶段的用户级 Markdown 写入。

## UI-08 简洁圆角优化（2026-10-27）

用户要求页面更简洁圆润。本轮仅调整 Agents 页面：轻量目标选择区、圆角操作卡片及文件行、胶囊按钮、文件图标底色和更克制的删除图标；长说明与目录放入可展开的“管理说明与目录”。选定支持工具后不再重复显示来源不支持提示，未选择时仍明确提示。编辑器统一圆角、内边距及小高度滚动，未改变文件读取/保存/删除确认/恢复和目标选择能力。新增文案三语言齐全，无新持久字段。

定向4文件33项测试、typecheck、renderer、格式/diff和独立macOS debug构建通过；日志 `/tmp/tuzi-ui08-{tests,typecheck,build,native-build}.log`。合成浏览器已检查浅色与深色主页面、编辑弹窗，截图 `/tmp/tuzi-ui08-agents.png`、`/tmp/tuzi-ui08-agents-dark.png`。无Rust/API改动，不重复全量原生测试，不宣称完成真实工具或三平台验收。仅本地提交，无push/PR/发布。
