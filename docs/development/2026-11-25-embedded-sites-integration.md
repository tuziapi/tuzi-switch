# SITE-INTEGRATE-1125：网站内嵌会话集成到 OpenTu 桌面候选

日期：2026-11-25，Asia/Shanghai。用户要求将「内嵌四个站点并修复冲突删除」会话的实现集成到当前版本；本轮仅本地集成、验证及测试包构建，无推送、PR 或发布，无新增付费模型调用。电脑保持静音。

## 来源与保留

- 来源会话：`01a21174-965a-7921-ac52-eaf253b4181a`。
- 来源分支：`codex/embedded-sites-session`，固定提交 `91a5f5e9e7f502bf0dbda037c07c841c066e9164`。
- 来源 6 个提交依次为：`6df5a5f8`、`2422151c`、`71196c4d`、`7c9441c5`、`12fbaa41`、`91a5f5e9`。
- 共同基线：`48cef23770e2525d9e952d3a842a16fd1a636843`。目标仍为 `codex/sync-opentu-web-1125`，保留此前电商 B 方案、拖拽侧栏、Vidu/Mix/MJ 与画布同步的全部未提交实现。
- 导入 44 个文件，首次导入后逐文件 Git blob 哈希与来源提交一致。共享 README/progress 采用追加本轮记录，未以来源版本覆盖当前进度。来源 worktree 及其预览数据未修改。

## 集成范围

1. 账户首页保留完整侧栏；创作、直连站、兔小店全宽展示，通过顶部下拉导航切换，品牌按钮返回首页并展开侧栏。
2. 两个远程网站使用原生 child WebView，切换隐藏/恢复，支持后退、刷新和浏览器交接。网站存储身份固定；直连站只记住允许列表内的公共平台根地址，避免重开登录页清除网站身份。
3. 菜单、弹窗、环境冲突提示出现时隐藏原生网站，关闭后恢复；四个主入口与底部设置固定，工具列表单独滚动，小窗口账户卡片减少留白。
4. 接入多 WebView 下的媒体、MCP、托盘、退出与更新窗口兼容；应用命令仅允许本地主 renderer，远程页面不得调用助手命令。网站不获账户令牌或模型 Key。
5. 环境变量删除定位真实配置来源、备份后原子写入并复查；无法定位的父进程变量不假报删除，需要重启时明确提示。未删除或修改本机真实环境变量。
6. OpenTu「连接 Codex / MCP」按钮与弹窗采用来源会话的新排版，标题/底部操作固定，中间滚动。

## 字段与兼容

本轮沿用来源的字段定义，不改账户 `system-token-v1`、SQLite、工具凭证或生成参数：

- `BackupInfo.restartRequired` 默认 false、`unresolvedVars` 默认空数组，旧备份可读；TS 字段可选。
- `website-data/direct-entry-v1.json` 的 `version=1` 与 `origin` 仅保存规范化公共入口，损坏、未知版本、未知域回落首次登录入口，不存认证信息。
- `direct/shop` 路由、网站几何区域及加载事件不持久化。网站 profile 不清理、不跨应用复制。
- 详见 [ADR-029](decisions/0029-embedded-website-workspaces.md)、[来源实施记录](2026-11-25-embedded-sites.md)、[来源真实登录验收](2026-11-25-embedded-sites-acceptance.md)、[首页布局](2026-11-25-home-navigation-layout.md)、[展示优化](2026-11-25-navigation-display-polish.md)、[连接弹窗](2026-11-25-opentu-connection-style.md)。这些来源验收不是当前候选重新执行的证明。

## 集成中发现的问题

- 原有 MSW 宿主模拟只导出 invoke，新增真实组件读取 isTauri 后导致原 App 的 24 项测试失败。补齐 jsdom 环境声明，保留独立原生组件及 Rust 权限测试；新增两条网站→创作→首页组合导航测试。
- 既有视频队列测试按数组下标选择待执行项，重启按时间排序后偶发选中中断项。修正为按 pending 状态选取，保持无 taskId 的中断请求禁止自动重发；未改生成实现或增加付费请求。
- 原生探针固定等待 3 秒可能在商店未加载时评估脚本，首次未取得拒绝标记。改为有界等待当前进程的唯一标记，明确区分「允许调用」与「未取得响应」，防止旧 Cookie 导致假通过。修正后两个网站 seed 和独立 verify 进程都取得新鲜拒绝响应，并读回合成持久 Cookie。
- 合并候选实机检查发现 acceptance 配置覆盖了整个 windows 数组，遗漏正式配置的 Overlay 标题栏，导致网站原生层向上偏移遮挡工具条。补齐 acceptance 的 titleBarStyle，与正式窗口保持一致；测试包保留可识别的窗口名称，但设置 hiddenTitle 避免它与自绘导航重叠，增加窗口配置回归并重建复验。

## 当前验证

- 类型检查通过；原生环境 6 项、网站 3 项、renderer 来源权限 1 项通过。
- 电商定向 6 文件 / 51 项通过，包含多图计划、侧栏、参数、队列、失败恢复及工作台。
- 宿主全量 115 文件 / 959 项通过，包含新增两条 App 组合导航；窗口配置修订后的 6 项定向通过（其中 5 项与全量重复，不相加）。前端生产构建及第一轮 Mac ARM 本地包构建、ad-hoc 完整性校验通过。
- 原生专用探针两个网站的合成 Cookie 跨进程、显示/隐藏、刷新、远程 IPC 拒绝通过；不等同真实账号登录或正式客户端完整验收。

日志：`/tmp/tuzi-sites-integration-{host-final,types-final,creative-final,rust-env,rust-sites,rust-security,window,native,native-final,probe-seed-final,probe-verify-final}.log`。早期 `host.log`、`app-final.log` 和 `creative.log` 保留失败定位过程；最终宿主结果以 `host-final.log` 为准，未把失败运行删去或记为通过。

## 合并候选原生检查

第一轮合并包（标题栏修订之前）已真实检查：账户首页及四入口可用；直连站登录页和兔小店首页真实加载；导航菜单开启后网站隐藏并显示正确提示，菜单可切回创作。3 个既有项目恢复；连接弹窗的新排版和既有配置状态可读，未执行安装/解除或复制令牌。电商 2026-11-25 17:03:35 双图历史可切换并显示第二张，gpt-image-2.5、原有多图计划、参考素材和拖拽侧栏均保留。发现工具条偏移后未将该候选作为最终交付。

最终标题栏修订包构建、ad-hoc 签名完整性检查及原生复验通过。正式安装应用未覆盖，当前最终候选已打开并停留在电商工作台。

Overlay 修订包已确认直连站与商店页面不再遮挡工具条；实际点击刷新、商店「客户端下载」站内页再通过宿主「后退」返回主页通过，没有下载或购买。导航菜单实际展开后原生网页隐藏，提示正确。随后继续修正测试包自身标题重叠，未改页面业务。

网站 Cookie 不从来源预览 `com.tuziswitch.website-preview` 复制到当前候选 `com.tuziswitch.desktop.acceptance`，因此当前候选仍是首次网站登录状态；已有助手账户与创作数据保持原状。

最终包实机补验：

- 直连站登录页可见，标题不再与导航重叠；后退/刷新/浏览器交接工具条完整可见，网页从工具条下方开始。商店主页真实加载。
- 先创建直连站和商店两个原生 child WebView，再返回创作，仍有 3 个既有项目和旧双图记录；菜单展开时网页隐藏，返回创作不残留网站覆盖层。
- 在多 WebView 已创建的情况下点击电商「保存图片」，系统保存面板真实打开，保存到隔离目录 `/tmp/tuzi-sites-export.nL3AJT/opentu-首图主视觉.png`。文件格式检查为有效 PNG，像素 1254×1254。该操作只导出历史成果，未发起新生成或改写原图。这验证了来源变更中的 Webview 命令参数兼容与新 renderer guard 没有阻断已有图片导出。
- 本地包：`src-tauri/target/release/bundle/macos/Tuzi Assistant Test.app`；identifier `com.tuziswitch.desktop.acceptance`；版本仍为 1.6.4 本地候选，非新正式版本。
- 最终二进制 SHA-256：`54a6029213ea0a16ee5024a02d06c758f44e74667203d9cfda434572f1ff0f16`。`codesign --verify --deep --strict` 通过，但没有正式开发者签名、公证或 updater 发布。
- 核对集成前已有差异：除进度索引和明确记录的视频测试修正外，60 个原有修改文件的完整 diff 保持不变；未覆盖电商/OpenTu 的前序实现。

尚未重新验收真实网站登录、第三方 OAuth、支付及 Windows/Linux/Intel Mac；新增模型线上生成的待验收范围仍见 [OpenTu 同步报告](2026-11-25-opentu-web-integration.md)。不因本次集成放行正式发布。改动保持本地未提交，避免把此前重叠修改整批归入本次提交。
