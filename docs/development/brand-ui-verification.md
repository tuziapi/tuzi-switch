# B10 品牌名称与账户页面视觉验证

2026-10-19（Asia/Shanghai）。用户确认四项修改后实施，仅本地；未 push、PR、远程合并、部署或生产操作。基线 `TA-AC-1.5-B4`、契约 `system-token-v1` 不变。

## 范围和源码配对

- 客户端：`/Users/syd08/Documents/tuzi-switch-system-token`，起点 `69bc262744ace2026a841782d1543ed54e394bb1`。
- API/网站：`/Users/syd08/Documents/tuzi/tuzi-api-system-token`，起点 `6341a800263460c2a29f065a252b0145d7ac7e7c`。
- 两仓分支均为 `codex/tuzi-assistant-system-token`。客户端代码 `d60182c8eb0255b9822b72722914d7cd44f9bc6e`；API/网站代码 `26abbcdd2e7386cf1cc3c29e7fde80171380a102`。后续文档提交不改变被测代码。
- 客户端原有八个未提交文件在操作前保存 SHA-256 并逐一核对。供应商表单、Codex 配置状态、原生合成模型夹具及对应测试均未纳入 B10 提交；既有 B09 记录完整保留。当前预览/测试使用包含这些既有修改的工作树，不声称是纯 B10 提交的独立验收。

## 修改结果

1. 客户端显示名称、三语言文案、关于、HTML 标题、Windows 窗口标题、包描述和发布展示标题统一“兔子助手”；网站提示“已复制，正在准备跳转兔子助手…”。显示名称与内部兼容身份分离，具体见 [ADR-009](decisions/0009-assistant-brand-identity.md)。
2. `TuziAccountIcon` 共用于顶部账户入口、未连接卡片和已连接头像，PNG 256×256、RGBA、40,780 字节。现有应用启动图标未改。
3. 系统令牌改为贴边柔和高亮，2 秒后 400ms 淡出。离开安全页清理定时器，再进入可重新定位。深浅主题沿用 Semi 色彩变量；减少动画时不平滑滚动、不做颜色过渡。自动定位的外层不留下焦点框，键盘 Tab 仍进入令牌输入框和后续按钮。
4. 移除工具页整块返回提示及专用 CSS，保留配置来源、保存事务、工具切换和供应商卡片定位；顶部账户入口可返回。原 `accountToolReturn` 状态改名为 `accountProviderFocus`，反映其剩余职责。

## 验证命令与结果

客户端（macOS，现有依赖）：

```sh
pnpm typecheck
pnpm exec vitest run tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/account/account-improvements.test.tsx tests/integration/App.test.tsx
pnpm exec vitest run tests/integration/App.test.tsx
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib auto_launch::tests -- --nocapture
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh
pnpm exec tauri inspect wix-upgrade-code
```

- 类型检查通过；4 文件原 28 项测试通过，新增导航回归后 App 文件 8/8 通过，最终涉及 29 个不同测试（不把复跑重复相加）。新增回归模拟配置保存成功，检查卡片定位保留、返回提示消失、顶部入口仍能回账户；不写工具配置。
- 新测试首次被异步欢迎弹窗挡住，补齐用户关闭欢迎弹窗的步骤后通过；没有为通过测试改变产品行为。
- 原生 6/6 通过，包括新/旧 macOS bundle 路径与保留旧文件名时避免误删同一启动项。未执行真实系统开机启动修改。
- renderer 与 macOS debug app 构建通过，产物 `/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`。共享构建缓存，源码来自本次指定目录。产物包含既有工作树修复。
- 打包后补充固定 MSI UpgradeCode 和 WiX 兼容路径；CLI 明确显示旧 UUID override 生效，JSON/XML 解析及 UUIDv5 校验通过。这两项 Windows 配置不影响已构建 macOS UI；未在 macOS 冒充完成 Windows 安装升级测试。
- 相关文件 Prettier、两仓 `git diff --check` 通过。构建保留原有包体提示及 dead_code 警告；未升级依赖。

网站（API 仓库 `web/`）：

```sh
bun test ./src/components/settings/personal/cards/SystemTokenCard.test.jsx ./src/helpers/auth.return-target.test.jsx ./src/helpers/loginReturnTarget.test.js ./src/helpers/auth.test.jsx ./src/components/settings/PersonalSetting.alert-migration.test.jsx
bun run build
```

- 5 文件 48/48 通过，含令牌卡片 18 项；覆盖高亮消退/重新进入/减少动画、只读读取复制、普通模式、1.5 秒延迟唤起、取消与登录返回。网站生产构建通过。
- 业务 Go、HTTP/DTO、权限和数据库未修改，未运行无关 Go 全包测试。未声称全仓测试全绿。

## 视觉与实机证据

- 合成视觉页面 `127.0.0.1:5191`：未连接新图标在浅/深主题的清晰度和透明背景已核对：[浅色](b10-evidence/account-light.jpg)、[深色](b10-evidence/account-dark.jpg)。仅使用 fixture，不代表真实原生连接。
- 已运行隔离网站 `127.0.0.1:5180`、合成管理员：真实安全 tab 切换与定位已验证。[浅色高亮](b10-evidence/token-highlight.jpg)、[淡出恢复](b10-evidence/token-resting.jpg)、[深色高亮](b10-evidence/token-dark-highlight.jpg)。DOM 核对淡出后背景白色、无外圈；键盘 Tab 可进入令牌输入。令牌保持遮罩，未揭示、生成、轮换或保存其内容；测试后恢复原自动主题。
- 本地 app 重启后原生窗口及 HTML 页面名称为“兔子助手”，顶部链接为新名称。之后窗口出现正在编辑的供应商表单，未干预或提交该表单。配置保存后无返回提示由上述 App 集成回归证明，本轮未实际写入七工具配置。
- 浏览器自定义协议冷/暖唤起、OS 弹窗显示名称、Windows/Linux 安装和启动项、用户视觉验收仍未完成；既有环境门禁保留。没有真实模型调用或支付。

## 图标来源

参考 `src-tauri/icons/icon.png`；使用会话内置 `image_gen` 生成，调用 `ig_00eb3265feddc9f7016ad5efc38914819393659b17b554044e`。通过 `codex-image-render-fallback/scripts/extract_images.py` 校验并发布当前会话结果，原始 PNG 1254×1254、RGBA，SHA-256 `dc14ade779e3be289f9b781127b412ef1c1df792433514f1e08ff8d7c03ac813`；保留 alpha，仅使用 Lanczos 缩至 256×256 作为项目资产。生成器未回传可独立核验的模型/路由字段，不以本地渲染结果证明底层服务路由。原始输出保留于本地 `outputs/codex-images/`，项目引用的资产已提交在 `src/assets/`，不依赖会话目录。

实际提示词：

> Use case: logo-brand. Generate one UI rabbit icon as a simplified faithful derivative of the existing client app icon shown in the conversation: a seated left-facing rabbit, two upright long angular ears (one tilted right), blue and cyan low-poly facets, dark blue round eye, compact seated body and small pointed tail. Preserve that brand identity and pose, but use fewer larger geometric facets and a stronger compact silhouette so it remains legible at 20–28 CSS pixels. Fill most of a square canvas with even 5% padding. True transparent background with alpha, no solid background, no checkerboard painted into image, no ground shadow, no glow, no text, no letters, no border, no mockup. Single standalone icon, crisp edges, bright medium blue/cyan with dark blue contrasts, readable on both white and charcoal UI backgrounds. This is the icon asset for 兔子助手 account navigation and avatar, not a replacement for the app launcher icon.

## 状态与回退

四项代码完成、定向检查通过、局部本地 UI 已验证；用户验收和发布未完成。发布仍需授权；两端可独立回退本次代码与文档提交，保留配置、数据库、安全记录和旧接入身份，不轮换系统令牌。
