# SITE-EMBED-1125：内嵌网站与环境变量删除反馈

2026-11-25 用户确认方案 B。独立分支 `codex/embedded-sites-session`，基线 `48cef23770e2525d9e952d3a842a16fd1a636843`；工作区 `/Users/sdy09/.codex/worktrees/embedded-sites-session/tuzi-switch`。原仓库电商任务修改保留，不做集成、push、PR、发布或生产操作。

## 实现

- 四个主入口统一顶部下拉和全宽内容；直连站改为 `/login`，兔小店内嵌；网站切出隐藏，切回保持 URL 与页面。
- 后退、刷新、外部浏览器打开、错误重试；Mac 控件留位；菜单/弹窗隐藏网页，避免原生层遮挡。
- 持久 profile、远程命令隔离及原生多 WebView 兼容见 [ADR-029](decisions/0029-embedded-website-workspaces.md)。无账户契约/服务端变更。
- Unix 环境变量删除不再对 process 来源空操作返回成功。找到匹配的独立字面赋值时备份并清理源文件；无法定位父进程来源时报错；进程仍继承旧值时明确需重新启动。不在运行中的多线程进程调用 setenv/unsetenv，也不把忽略项伪装成已删除。
- 检测和删除共用保守赋值解析，保留其他 shell 命令和换行，处理路径冒号；文件临时写入原子替换并复检；旧值变化不删除新值。复杂 shell 表达式仍需手工处理，不执行 shell。
- 密钥值遮蔽，备份目录 0700/新文件 0600、唯一文件名；刷新失败不报成功；部分失败后仍重查。未读写真实用户环境配置。

## 新字段及兼容

| 字段 | 默认/兼容 | 位置 |
|---|---|---|
| BackupInfo.restartRequired | Rust serde default false；TS optional，旧原生缺失视 false | 删除结果；旧备份可读 |
| BackupInfo.unresolvedVars | Rust serde default 空数组；TS optional | 只返回变量名，无凭证 |
| SiteBounds x/y/width/height | 非持久；有界有限数，正尺寸 | 固定枚举网站的 IPC |
| EmbeddedSite direct/shop | 非持久；其他值拒绝 | 路由与 IPC |
| embedded-site-load site/loading | 非持久，仅发 main | 页面加载提示 |

不更改 SQLite、账户文件、导出或 WebDAV。备份恢复保留值并作 shell 单引号转义。

## 验证与限制

- `pnpm typecheck` 通过。
- 6 个前端文件 34 项通过：四入口导航、账户原 Tab、创作挂载、网站切换/覆盖层/串行/错误重试、环境变量失败反馈和遮蔽。
- 原生环境模块 6 项通过，另有网站固定地址/尺寸校验 1 项和远程来源权限 1 项通过（共 8 项）：临时文件删除、不同值保护、复杂 shell 保留、冒号路径、旧备份默认值、process 不假报成功。
- `cargo check --lib --offline`、创作构建和 renderer 构建通过；新增多 WebView 相关原生代码经本地 Mac ARM app 构建。
- 原生专用 probe 直接引用正式网站模块和命令 guard，独立 `com.tuziswitch.website-probe` 身份。首次写入合成 HttpOnly/Secure/Max-Age Cookie；独立第二进程对两个域均读回；hide/show/reload 通过；实际远程 JS 调用特设 privileged 命令被拒绝。仅合成凭证，不登录真实账户。
- 最终预览包重新构建并启动复验：Overlay 标题栏与 44px 主导航、后退/刷新工具栏、保持会话提示、真实商店页面展示正确。
- Mac 原生 CUA：账户连接页、导航四入口、直连站真实登录页、兔小店真实首页/登录页、opentu 我的项目可打开；商店登录页→创作→返回商店仍为登录页。菜单开启后网站隐藏可操作。
- 独立 Mac ARM 本地预览包 `outputs/embedded-sites/Tuzi Websites Preview.app`，固定独立 identifier，`CC_SWITCH_TEST_HOME` 指向同目录 test-home；不覆盖正式安装版。
- 真实账户登录→退出重开、登录有效期、第三方 OAuth、支付、下载、离线、Windows/Linux、旧 macOS 尚未完整验收。Cookie 实测不等于真实账户全流程通过。无发布。

## 本地复现

在本分支独立 workspace 内使用现有依赖；`.website-preview.vite.config.ts` 和 `.website-test.vitest.config.ts` 将共享 node_modules 中指向原仓库的 creative 包解析回当前分支产物，避免混入其他任务。

```sh
pnpm build:creative
pnpm exec vite build --config .website-preview.vite.config.ts
pnpm exec vitest run --config .website-test.vitest.config.ts tests/components/CreativeWorkspace.test.tsx tests/components/TuziNavigation.test.tsx tests/components/EmbeddedSite.test.tsx tests/components/EnvWarningBanner.test.tsx tests/components/WorkspaceScope.test.tsx tests/account/account-navigation.test.tsx
cargo run --manifest-path src-tauri/Cargo.toml --example embedded_sites_probe -- seed
cargo run --manifest-path src-tauri/Cargo.toml --example embedded_sites_probe -- verify
pnpm tauri build --debug --bundles app --features isolated-profile --config src-tauri/tauri.acceptance.conf.json --config src-tauri/tauri.website-preview.conf.json
```

Probe 只向固定网站写入一个小时有效的合成 Cookie，测试身份不与正式/预览应用共用。样例仅手工运行，不作为联网自动测试。完整登录由用户自行输入账户，测试不复制浏览器 Cookie。
