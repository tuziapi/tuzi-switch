# UC-MEDIA-MENU-02 / UC-WIN-BRAND-01

2026-11-11，分支 `codex/fix-canvas-media-context-menu`。用户暂停发布后，要求修复图片/视频右键菜单、工作区顶部品牌图标和 Windows 快捷方式旧名称。本轮仅本地修改、测试和构建；不 push、发布、部署，不调用付费模型，不操作真实项目或账户。

## 复现与修复

- 视频：旧图片菜单显式排除视频；原生视频 HTML overlay 是 SVG 的兄弟节点，旧命中过滤也不接收此区域。Chromium 实际画布复现三个区域右键均无菜单。为 overlay 添加非持久 DOM `data-canvas-media-id`，以当前元素 ID 定位，不误取其下方图片。SVG 视频继续沿用画布坐标命中。复用现有视频另存为、预览和提示词复制；视频字节不进入图片解码。右键不能启动原生视频拖动，左键拖动与播放保留。
- 图片：WebKit 选中图片后延迟触发 viewport-container scroll，菜单已经打开又被共享菜单的全局 scroll 监听关闭。事件记录及回归测试均复现。共享菜单新增可选 `closeOnScroll`（默认 true，原调用方行为保留）；媒体菜单设置 false，用户 wheel/touchmove、外部点击、Escape、窗口 resize 仍关闭。聚焦菜单用 preventScroll，避免额外视口跳动。菜单只在打开时监听，没有新增轮询或逐帧全画布扫描。
- 图片保留复制图片、另存为、显示文件、预览原图、复制提示词五项操作。视频提供另存为、预览视频、复制提示词；不伪造系统不支持的视频剪贴板/文件定位。
- 侧栏/下拉导航头部用现有 TuziAccountIcon 替换黑底 Sparkles，复用蓝兔 PNG，无新图片依赖。
- Windows：发布脚本 `--desktop-product-name` 将产品名覆盖成 `tuzi switch`；NSIS/WiX 原模板将产品名直接用于快捷方式。这是确定的构建配置原因。保留该内部安装/注册表名称、应用标识、MSI UpgradeCode、下载资产名称；模板分别使用显示名称“兔子助手”。NSIS 定制模板固定来源 Tauri CLI 2.8.1（与本地报告 2.8.0 的原模板字节一致），保留 MIT 许可，升级 CLI 时须重新比对。新安装、开始菜单、桌面和卸载显示名称一致；迁移 NSIS 旧快捷方式前检查目标，保留指向其他程序/安装位置的同名链接，尊重不创建快捷方式和更新模式。MSI 保留原组件及注册表路径，移除旧的托管快捷方式名；语言使用 zh-CN，避免原 en-US 代码页不能表示中文。

## 验证

- 新组件测试修复前 9 失败/7 通过；增加延迟滚动回归后该项在修复前失败。最终菜单、原生 overlay、原图操作、视频下载、共享工具栏 41 项及共享菜单滚动兼容/监听清理 3 项通过；侧栏/导航 9 项通过。
- Chromium/WebKit 各 14 组实际画布浏览器场景通过，使用本地合成媒体和模拟原生保存/剪贴板边界，阻断外部网络。覆盖选中/未选中、边缘/中心/底部、重复右键、两种媒体重叠、缩放/平移、拖动后、播放/控件、原图复制、视频保存与预览、提示词、输入框/空白区和品牌图片加载。两种浏览器均无 pageerror。WebKit 合成视频 metadata-only 预加载场景采用海报激活后再点击播放器开始播放；不声称一次点击播放在本轮已得到证明。
- 原有图片菜单验收 Chromium/WebKit 各 9 组通过：原图字节、取消/错误、预览导出、重载缓存、深色窄窗口、重叠和原图缺失，不发起补生成。
- TypeScript、创作构建及宿主前端生产构建通过。保留既有 Sass/大 chunk 警告。
- Windows 安装配置/模板 6 项本地回归通过，覆盖两种安装模板、中文编码、旧升级身份、显示名及受保护的快捷方式迁移。此项是源码验证，不是 Windows 安装或升级实测。
- 补充 NSIS 语法编译：使用摘要验证过的 Homebrew makensis 3.13 临时工具，提取生产模板中的迁移宏、创建/更新快捷方式函数，搭配 Tauri 原版 COM/快捷方式宏，编译合成验收 EXE 成功（未运行）。这验证所改快捷方式代码的语法与真实宏展开，不冒充完整安装包构建或 Windows 行为验证。完整 NSIS/WiX 包仍待 Windows 构建。Homebrew 安装尝试因元数据下载停滞已中止，工具仅解压到 `/tmp`。
- 上游来源重建逐字节验证：1,522 原文件 + 105 本地文件 = 1,627 文件。

归档证据：`/Users/sdy09/Documents/tuzi-switch-artifacts/local-menu-brand-2026-11-11/`。原始证据：`/tmp/tuzi-canvas-media-menu-{chromium,webkit}/result.json` 和截图、`/tmp/tuzi-old-image-{chromium,webkit}.log`、`/tmp/tuzi-menu-final-tests.log`、`/tmp/tuzi-menu-host-tests.log`、`/tmp/tuzi-menu-{typecheck,build,host-build,provenance}.log`。

## 交付边界

版本保持 1.6.1，未重打/替换公开同版本附件，未更改下载页面或安装脚本的在线版本。用户电脑已安装的程序和快捷方式不会因为本地源码修改自动变化。Windows 安装包实际编译、全新安装、旧 NSIS/MSI 升级、卸载及自定义快捷方式场景仍需 Windows 验证；本机浏览器测试不能冒充原生系统保存/剪贴板或 Windows 11 + Edge 实机验收。
