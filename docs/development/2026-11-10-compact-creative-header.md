# UC-CREATIVE-HEADER-01 · 轻量标签顶栏

2026-11-10 用户在三种 44px 设计中选择第一个「轻量标签」，授权本地实现。沿用 codex/opentu-text-chat 工作区；保留其他已有修改，无 push、PR、上线或付费模型调用。

## 实现

- 创作页面合并窗口预留区、品牌栏和创作导航，仅保留 44px 顶栏，画布从顶栏下缘开始。非创作页面保持原布局。
- 左侧沿用兔子助手导航菜单，图标改为兔子；项目/自由画布为文字标签，选中项使用细下划线。
- 右侧保留原创作配置和对话入口，复用原回调、状态与 portal，未创建第二套聊天状态。
- macOS 为原生窗口按钮预留左侧 84px，空白区可拖动；按钮区域不触发拖动。Linux 自绘窗口控件保留右侧空间，沿用现有 Linux 禁用拖动区域的规则。
- 小宽度下收起标签文字，保留图标、可访问名称和提示。此次没有新增存储字段、API、依赖、轮询或媒体请求。
- CreativeTopBar 是宿主组件；无需修改上游画布代码。去掉通用 workspace-view 在创作页产生的额外上下边距。

## 验证

- pnpm typecheck 通过。
- 原导航与 App 集成测试：2 文件 / 27 项通过。
- 生产二次打包预览通过；Chromium / WebKit 各 3 组（1360 浅色、900 浅色、1360 深色）通过。测量顶栏 y=0、高=44；画布 y=44；原生按钮预留>=84；没有横向溢出或重复聊天入口。
- 两浏览器均检查配置开关、对话展开/收起、项目/画布切换、账户往返并恢复画布，无页面异常。仅合成测试传输。
- 初次预览暴露 workspace-view 的 20px 通用边距，已修正后重新打包并完成以上检查。
- 核查原体验包临时配置发现：windows 数组覆盖主配置后缺失 titleBarStyle，导致系统默认 Visible 额外占用标题栏。新增可复现的 tauri.text-chat-preview.conf.json，显式指定 Overlay/hiddenTitle、窗口最小尺寸及原隔离标识。最终包构建完成；第一包未作为交付。
- 最终构建命令：PATH=<stable-rust>/bin:$PATH pnpm tauri build --features isolated-profile --bundles app --config /tmp/tuzi-compact-header-native.json。临时配置来自上述仓库配置，仅将 beforeBuildCommand 设为 pnpm exec vite build；本轮上游创作包未改变，沿用已通过的最新创作构建。

本记录只覆盖此次顶栏变更，不改变前一版本真实视频模型联调及正式发布尚未完成的状态。

## 本机交付完成

- 最终 Release 构建通过（3m58s），保留两条既有 Rust 死代码警告；ad-hoc 签名及 deep/strict 签名核验通过。
- 新包已打开到自由画布；原生截图确认只有一条约 44px 的顶栏，下方立即为画布。菜单、配置开关、对话展开/收起和项目/画布入口已实际操作。
- 重启前确认队列生成中为 0。原画布作品、失败记录和讨论仍保留；本轮没有重试生成或提交模型请求。
- 空白拖动区域已在原生窗口执行拖动手势，未独立量化窗口位移。Windows/Linux 原生平台本轮未运行，只保留相应分支和控件避让。
- 交付目录：`/Users/sdy09/Documents/tuzi-switch-artifacts/compact-header-2026-11-10`；启动器 `启动兔子助手最新版.command`，共享原隔离 profile，旧版保留回退。
- 可执行文件 SHA256：`d4acca7d5317b85ff242cefc10604e0e75dd296767884185467034d4dd350190`。
- 证据：[分层验证记录](evidence/2026-11-10-compact-creative-header.json)。随包附合成截图，不导出用户画布、账户或签名媒体地址。
