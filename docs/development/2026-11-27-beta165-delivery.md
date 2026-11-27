# PREVIEW-165-1127 · 集成测试版交付

用户授权：本机验收后推送测试仓库、构建新测试包。仅操作 `AiW520/tuzi-switch`，不推正式仓库，不发布 stable，不覆盖已有版本。新版本 `1.6.5-beta.1`，新标签 `opentu-preview-v1.6.5-beta.1`。

## 来源及放行范围

以 `48cef23770e2525d9e952d3a842a16fd1a636843` 及当前已验收增量为基础：电商生成计划/参数/参考用途/可拖动侧栏、网页 OpenTu B 增量、四站点导航及安全边界。具体来源与本机真实验收见 [集成准备报告](2026-11-26-integrated-release-readiness.md)。本轮不增加模型调用，不使用禁止的视频模型，不改变真实账户配置。

本机证据足以进入独立测试版交付，不认定正式上线门禁全部通过。账户契约未变，无新增数据库迁移；既有任务字段兼容见电商及网页集成报告。

## 本次打包修正

- 公开 preview 的窗口配置补齐拖放、标题栏、尺寸与首次隐藏，避免覆盖数组后丢失已验收设置。
- 增加独立 preview Info.plist，仅注册 `tuzi-opentu-preview`。构建配置合并保留 Node JIT entitlement 与 hardened runtime；最终 Mac DMG 检查启动协议。
- 构建、汇总、发布、回归样例统一新测试版本；旧公开附件不变。下载页待实际发布清单生成后一起切换版本与摘要。
- 五平台流程新增运行时、发布脚本和原生网站/调用边界/压缩/画布连接器门禁。

## 发布前本地检查

- 构建脚本 23 项、发布脚本 4 项、窗口配置 8 项、当前运行时 23 项通过。
- preview gateway 与差异空白检查通过；生成上游补丁按来源重建规则另验。
- 149 个候选文件的常见密钥/私钥模式检查未发现匹配；不替代完整秘密审计。
- 测试远程 main 为基线 HEAD，测试构建分支 `23d4c71c86208a87d4e82d6080f608c146107d29` 在祖先链。发布前稳定 Latest 为 `v1.5.4` / release ID `433896872`，应保持不变。

## 交付状态

源码 `4128b5c5bed7e3a1c9228bd29a562017a29dc5d6` 已推送测试仓库的 `codex/test-opentu-1117` 与 `main`。首次直连推送遇 TLS 网络错误，复用已有本机代理后成功；没有改全局 Git 或系统代理设置。云端 run `45938099334` 的 verify 已通过：宿主 115 文件 / 962 项、创作 209 文件 / 3,231 项、下载页 19 项、运行时 23 项、构建脚本 23 项、发布脚本 4 项以及宿主类型检查。五平台及公开交付最终结果见下文。

同提交本机已构建真实公开 preview 身份的 Mac ARM DMG（区别于上轮 acceptance 身份）：

- 文件：`src-tauri/target/release/bundle/dmg/OpenTu 验收版_1.6.5-beta.1_aarch64.dmg`，94,027,534 字节，SHA-256 `406c19eb92240f78418799b6ca25268addded5a12c3d9cd673f74cc4c0f27a65`。这是本机产物，不替代云端公开产物摘要。
- 只读挂载后验证 `com.tuziswitch.desktop.opentu-preview`、版本 `1.6.5-beta.1`、唯一 `tuzi-opentu-preview` 协议、ad-hoc 签名及 Node JIT entitlement。清空环境仅保留系统 PATH，包内 Node 24.22.3 的脚本、fetch、WebSocket 探针通过。
- 媒体引擎 SHA `93a29a77d352471bf9db0997937f74237b2000b619dbef6e2dd7db81059cd6c1` 与前轮真实压缩所用引擎一致；资源、许可证和源码归档齐全。
- 解包至独立产物目录 `tuzi-switch-artifacts/preview-165-20261127/OpenTu 验收版.app` 并启动，进程存在；没有覆盖 Applications 中应用。macOS 捕获报 `SCStreamErrorDomain -3811`，已请求解锁，未将进程存在记为 UI 验收通过。
- 新 preview 身份未配置画布连接器，stdio 只读探针被拒绝（`-32000`）；没有添加 enabled 文件或修改 Codex 配置。前轮 acceptance 连接器成功证据不移植到此身份。

五平台构建 run `45938099334` 已全部成功，包含全量 verify、五个平台实际 release features 的原生专项、安装包资源检查。Windows 另完成真实静默安装、窗口启动与再次启动；不代表完整跨平台用户界面验收。原生压缩引擎 ignored 项未在这次云端命令执行，前轮本机显式实测证据保留。

五个安装包已逐个下载到本机，再由 `prepare-opentu-beta-assets.py` 统一验证版本、来源提交、run、隔离身份、文件大小、SHA 与必要运行时检查；准备对应提交的源码归档。Mac ARM 云端最终 DMG 另在本机只读挂载，签名、身份、版本、唯一启动协议及清空环境后包内 Node 执行通过。

| 平台 | 字节 | SHA-256 |
| --- | ---: | --- |
| macOS ARM64 | 93,931,823 | `0b311328568a7e3884730a024f88b7d6ab026e8a9d6a7a574d6574df029597df` |
| macOS Intel | 98,306,194 | `18a9dec485c6fec03c8ab6c1cddd41a73f0be49f293894710f668bb16bca8a09` |
| Windows x64 | 71,938,734 | `f88a3b8e397fe225a17414c4bb27b8787e13e1287e1bd5bd4ead0f4d23c3dfdf` |
| Linux x64 | 105,514,524 | `33aa05ddb602e79823c790501eb2a02678fedb6d636720331844a85588651f4b` |
| Linux ARM64 | 104,603,566 | `0f15d39a1a3ef92ce5580446704bb4b3652bd13225fff33fb238a869b1619c5f` |

公开测试附件流程 run `45944194857` 成功。新标签 `opentu-preview-v1.6.5-beta.1` 指向准确构建 SHA；发布为非 draft 的 prerelease，8 个公开附件摘要由发布流程逐一核对。下载后的发布证明与本机已验证清单逐字节一致。稳定 Latest 仍为 `v1.5.4` / ID `433896872`，未修改正式仓库、旧标签或附件。

下载页提交 `d31552d6e9faeea232a50d40892c2552088a3cdb` 已推送测试 main，Pages run `45944565845` 成功。页面按发布证明同步版本、五平台链接及摘要，并更新电商生成计划、参数、参考图用途、可拖动侧栏及网站集成说明。

- 本地下载页 19 项测试、preview 生产构建与公开 release/build/tag/附件检查通过。
- 五个公开安装包 URL 经跟随重定向实际 HTTP HEAD 均为 200；GitHub 8 个附件摘要与已下载校验的构建产物一致。
- 公开 `preview-release.json` 与发布证明逐字节一致；按 CI 的完整环境（含页面源码 URL）重建后，公开 HTML、JS、CSS 与本地输出逐字节一致。首次对比使用了缺少源码 URL 的本地构建，资产名不同；按相同配置重建后通过，没有把该次失败误记为通过。
- Chrome 原有页面刷新后显示 `1.6.5-beta.1`；真实切换 Mac ARM/Intel、Windows、Linux x64/ARM64，五个按钮地址均对应新标签正确安装包。更新说明已显示本轮内容，恢复 Mac ARM 选项并保留下载页。
- 测试发布 ID `460191990`，非 draft 的 prerelease；正式仓库无推送，测试稳定 Latest 仍为 `433896872` / `v1.5.4`。没有改写已有标签或附件。

下载页：<https://aiw520.github.io/tuzi-switch/>。测试发布：<https://github.com/AiW520/tuzi-switch/releases/tag/opentu-preview-v1.6.5-beta.1>。

**结论：测试版代码、五平台安装包、公开附件及下载页已交付，正式版未发布。** 本轮无新增付费模型调用；新公开身份的完整原生点击复验受屏幕捕获限制，真实登录、全部模型效果及跨平台业务实机验收仍保留，不宣称全部客户使用场景已验收。

Windows 已实际下载并核对安装报告与 EXE 摘要一致，安装、窗口启动、再次启动、证书存储不变均通过。报告的 `productVersion` 文本为基础 Cargo 版本 `1.6.4`：当前 tauri-winres 0.3.5 从 `CARGO_PKG_VERSION` 填充字符串，tauri-build 2.5.6 只按预览配置覆盖数字版本；预览流程有意不修改基础 Cargo/package 版本。该显示差异保留为已知限制，不能用文件属性文本单独识别测试版，应以安装包名、对应 SHA、构建提交和清单为准。未将 Claude 真实对话记为通过。

真实网站账号登录、全部模型效果、跨平台用户实机和正式升级仍按准备报告保留。预览版独立数据目录、无自动更新，Mac ad-hoc 签名未公证。
