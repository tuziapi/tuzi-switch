# INTEGRATION-QA-1126 · 两会话集成复核与上线准备

日期：2026-11-26，追加验收完成于 11-27 凌晨，Asia/Shanghai。用户要求核对网站会话最新实现、完成已批准的 B 增量同步，并真实测试、做好上线准备。本轮不推送、创建 PR、发布或修改下载页；未提交新模型生成请求，未调用 `doubao-seedance-2-5-260628`。需要生成视频时仍按用户指定使用 MiniMax-H3。

## 结论与来源

**两项实现均已进入当前本地桌面源码及被测 Mac ARM 候选；本轮组合回归通过，尚不放行正式全平台发布。** 本轮未发现需要补合的来源增量，没有为重新集成覆盖已有电商修改。

用户要求继续后，完整桌面构建阻碍已解除，已生成并打开包含 `claude-desktop-local,isolated-profile` 的完整测试包。追加修正 Mac 测试包误注册正式深链协议、运行时测试引用已删除脚本两项问题。最终产物与新验证见下方“完整测试包追加验收”；首轮记录保留，不混用两个产物的摘要和测试结论。

| 来源 | 本次核查 | 当前结果 |
| --- | --- | --- |
| 网站会话 `01a21174-965a-7921-ac52-eaf253b4181a` | 来源 HEAD `91a5f5e9e7f502bf0dbda037c07c841c066e9164`；仅存在未跟踪预览输出 | 6 个提交均已纳入。46 个来源差异路径中 43 个逐字节一致；README/progress 合并记录，原生探针采用已记录的加强版；业务源码无遗漏 |
| 网页会话 `01a211eb-538e-7011-97df-3d67ea770b61` | 只读 `git ls-remote origin refs/heads/develop`，仍为 `9358b102ae4b26a65c2f371236afb2c79a802233` | B 范围已同步；PR #351 的 Q4 默认值及保留已保存选择也在该版本中。来源本地 `ab128f46` 并非缺失的新功能 |
| 当前桌面 | `codex/sync-opentu-web-1125`，HEAD `48cef23770e2525d9e952d3a842a16fd1a636843` 加现有未提交集成 | 不是仅 HEAD 的构建，也不是公开 v1.6.4 已包含新功能的证明 |

B 范围：画布恢复编辑/框选/渐变/持久化修复、独立画布入口及按需加载、八种 Vidu 与 Mix 参数/参考音频链路、MJ V8.2、默认值兼容、电商参数快照与任务恢复。网站集成包含四主入口、两远程原生 WebView、菜单遮挡处理、安全公共入口恢复、环境变量删除改进和 MCP 连接面板。

原实现及字段兼容见 [网页同步](2026-11-25-opentu-web-integration.md)、[网站集成](2026-11-25-embedded-sites-integration.md)。本轮无新增业务字段、数据库迁移、账户合同或凭证配置变更。

## 本轮重新执行的验证

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm test:unit` | 115 文件，960 项通过 |
| `pnpm test:creative` | 209 文件，3,231 项通过 |
| `pnpm typecheck` | 通过；仅宿主既有覆盖，未解决此前记录的完整创作严格类型基线问题 |
| Rust 环境、网站、调用来源、压缩、连接器 | 15 项通过；压缩引擎的 ignored 项另显式执行，1 项通过，合计 16 项 |
| 原生网站探针 seed → 独立 verify | 两站真实加载；合成 Cookie 跨进程保留；显隐/刷新及远程网页调用本地命令被拒绝。不是账号登录验收 |
| 来源补丁重建 | 1,704 文件逐字节通过，生成前后清单及补丁摘要未改变 |
| 下载页 | 19 项通过；未修改或部署页面 |
| 打包/发布/安装入口脚本 | 26 项中 13 项通过、13 项 Mac 安装测试因未提供当前正式 DMG 跳过；不记为全部通过 |
| preview gateway、差异空白检查 | 通过；生成的上游补丁按字节重建规则排除空白检查 |
| 被测 app 完整性 | `codesign --verify --deep --strict` 通过，仅 ad-hoc 签名 |
| 首轮完整桌面特性额外编译检查 | 当时 `cargo check --locked --features claude-desktop-local,isolated-profile` 因 GitHub 下载超时未完成；后续完整 Release 构建与链接已通过，见追加验收。不将被中止的 check 本身改记为通过 |

日志 `/tmp/tuzi-ready1126-*.log`：`host`、`creative`、`types`、`rust`、`engine`、`probe-seed`、`probe-verify`、`provenance`、`packaging`、`download`、`gateway`、`mcp-before`、`mcp-after`。预期错误分支不按业务联调成功解读，以命令退出码和结尾汇总为准。

## 当前候选实际操作

使用 `tauri://localhost` 的真实 Mac ARM 应用，非浏览器模拟。未播放音视频、未改正式应用或网站登录配置。

1. 直连站登录页、兔小店主页实际加载；展开导航后远程网页隐藏并显示提示。两个 child WebView 创建后返回创作，原图、参考图及双图记录保持可见。
2. 原生选择 `viduq3-turbo`，无图的带货视频模式生成按钮可用；复刻页缺参考视频时禁用。检查完恢复 MiniMax-H3，无生成请求。补齐昨日最终 Turbo 控件未可靠选中的原生检查，不代表线上生成已测。
3. 两网站均已创建后，通过系统文件选择器载入已有耳机视频、取消保留音轨、点击本地压缩；2026-11-26 **22:58:15** 的新任务完成，并经系统保存面板导出。
4. 压缩输入 1,021,347 字节，输出 599,781 字节，减少 41.3%；输出 1280×720、6.583333 秒、H.264，仅视频轨。`ffmpeg` 全量解码通过；不是引用昨日旧记录。
5. 当前包真实 stdio 连接器读取画布及模型成功：11 个工具、6 个画布元素、514 个模型项。只记录计数，不输出令牌、模型凭证或媒体。
6. 正常退出，进程检查确认主程序已停止，再按绝对路径重新启动。3 个项目、双图、原图/参考、生成计划、gpt-image-2.5、MiniMax-H3 保留；22:58:15 的压缩记录恢复。返回同一画布后重新启动连接器读取，数量一致。
7. MCP 面板显示已配置状态、三步教程及 MiniMax 示例；未安装/解除连接或改写用户 Codex 配置。stdio 自检不等同当前 Codex 客户端通过自身 MCP 工具实际调用。

文件选择器曾出现自动化路径输入不完整和临时状态失步；重新读取状态、完整设置路径并确认文件名后完成真实上传。没有以中间操作代替压缩与导出结果。

导出：`/Users/sdy09/Documents/tuzi-switch-artifacts/opentu-film-20261124/assets/qa-integration-20261126-noaudio.mp4`。SHA-256：`ec40c693ea7b133af52c573dafb911f16e1e2455dae0f38026eef2541ea80028`。相同输入及选项产生相同压缩字节，但任务为本轮新执行。

## 首轮被测产物与交付状态

- 应用：`src-tauri/target/release/bundle/macos/Tuzi Assistant Test.app`。
- 身份 `com.tuziswitch.desktop.acceptance`；版本字段 1.6.4；Mac ARM 本地集成候选，非正式升级包。
- 主程序 SHA-256：`54a6029213ea0a16ee5024a02d06c758f44e74667203d9cfda434572f1ff0f16`。
- 该产物为 11 月 25 日最终构建，本轮对同一字节重新验收，未声称今天重建。来源无新业务变化，不为更新时间重复生成二进制。
- 构建相关源码快照：2,490 文件，SHA-256 `cefb3e57e2e6b819a27d3c4472d73e91df7bd2041eae5740a77b296bbfcefa23`。范围为宿主 src、原生 src/Cargo/build/tauri/capabilities、创作 src/upstream/Vite/package，及根 package/pnpm-lock/Vite；唯一相对路径排序后逐个散列路径、NUL、内容、NUL。文档、辅助测试及产物不在此摘要中。
- 保留已有未提交修改，未整批提交、推送、安装覆盖 `/Applications/兔子助手.app` 或更新公开下载地址。

## 完整测试包追加验收（11-26 深夜至 11-27 凌晨）

### 修改及依赖

1. 新增 `pnpm build:local:full`，复用现有 Node 校验/资源打包脚本，并启用 `claude-desktop-local,isolated-profile`。沿用 acceptance 身份与数据目录，保留 Node JIT entitlement，关闭 updater 产物；不改版本、不安装、不发布。普通本地构建入口保持可用。
2. 检查最终包发现根 `Info.plist` 覆盖了测试深链配置，仍注册正式 `tuziswitch://`。增加 `Info.acceptance.plist` 并在 acceptance 配置显式引用，最终包仅注册 `tuziswitch-test://`；正式 plist 保持原值。对普通/完整 acceptance 配置加入回归检查。首个完整包未用于 UI 验收，修正后重新 bundle/sign，随后才打开。
3. `pnpm test:claude-local-runtime` 首次失败，原因是 beta.4 已删除旧证书代理及其测试启动脚本，package 与 CI 仍引用该脚本。两处改为明确运行当前保留的三个运行时测试文件，23 项通过。没有恢复旧代理，也未生成或信任本地证书；已移除代理的 managed/proxy 测试不计入当前通过数，现行网关流程由原生专项覆盖。
4. Node 24.22.3 官方包按既有固定摘要校验并通过原生执行探针。sherpa-onnx 1.13.8 官方归档直连下载缓慢，复用本机既有 `127.0.0.1:7890` 代理完成断点续传，无系统代理变更。归档完整解包检查通过，SHA-256 `9091bf160dc7fdacedbc906b212badf53c2993f4e5277a0e03998e96c31d60da`，通过库支持的 `SHERPA_ONNX_ARCHIVE_DIR` 加载；未跳过库链接。

### 构建及验证

```sh
SHERPA_ONNX_ARCHIVE_DIR=/tmp/tuzi-sherpa1126.n57vzv \
CARGO_BUILD_JOBS=2 NODE_OPTIONS=--max-old-space-size=4096 pnpm build:local:full
```

完整前端及优化原生构建通过。随后仅修正 bundle 的 Info.plist，使用相同 features 执行 `pnpm tauri bundle --bundles app`，依次合并生成的完整 runtime 配置及最新 `src-tauri/tauri.acceptance.conf.json`；无需重新编译业务源码。未来直接运行上述完整构建命令即可包含修正。

| 追加验证 | 结果 |
| --- | --- |
| `python3 scripts/test_prepare_claude_local_node.py` | 22 项通过；跨目标配置检查不代表跨平台实机运行 |
| `pnpm test:claude-local-runtime` | 当前保留运行时 23 项通过；无真实模型请求 |
| 完整 features 下原生 Release 测试 | `local_` 36、`claude_desktop_` 20、`embedded_sites` 3、`renderer_security` 1、`creative_compression` 1、`opentu_connector` 4；显式运行压缩/取消 ignored 项另 1。共 66 条通过记录、去重 64 个测试；不是完整原生测试集 |
| 最终包执行与签名 | 主程序与 Node 均 ARM64；`codesign --verify --deep --strict` 通过；Node JIT entitlement 保留。用仅 `/usr/bin:/bin` 的 PATH 实际执行包内 Node：v24.22.3、脚本、fetch、WebSocket 全部通过 |
| 媒体运行时 | 最终包的 ffmpeg、许可、来源归档及 provenance 均存在。ffmpeg 与首轮真实压缩所用引擎逐字节一致：`93a29a77d352471bf9db0997937f74237b2000b619dbef6e2dd7db81059cd6c1` |
| 原生网站与 Claude 入口 | 两网站真实页面均加载，打开导航时 child WebView 隐藏。Claude Desktop 配置面板可用且检测到客户端；未启动 Claude、绑定线路或改变证书，不认定 Claude 真实对话已测 |
| 创作与冷启动 | 3 个项目、商品原图/风格参考、2/2 双图及模型/计划保持；切到第二张确认真实图片显示。侧栏拖拽 352→510 像素、双击回到 352。MiniMax-H3 历史视频及 22:58:15 压缩结果恢复，无播放发声 |
| 最终包 MCP | 冷启动前后各实际 stdio 读取成功：11 工具、6 画布元素、514 模型项；连接面板及三步教程保留。仍非 Codex 客户端自身调用验收 |

日志：`/tmp/tuzi-ready1126-full-{build,rebundle,build-tests,runtime-tests,native-tests,native-extra,engine,mcp,mcp-restart}.log`。UI 正常退出后另以进程查询确认结束，再重启最终包；冷启动后连接器记录时间为 `2026-11-26T16:01:58.822Z`（上海 11-27 00:01:58）。

### 最终产物

- 应用绝对路径：`/Users/sdy09/Documents/tuzi-switch/src-tauri/target/release/bundle/macos/Tuzi Assistant Test.app`，已打开供本机体验。
- 仍为 `com.tuziswitch.desktop.acceptance`、版本字段 1.6.4，完整 Mac ARM 本地候选；不是公开正式版或已发布测试版。
- 主程序 SHA-256：`ad1bf5da690164a0eee135725fc21563175f87236919cfa0278c5a43ea484c2a`。
- 整包 20 文件、212,528,914 字节；按相对路径排序，逐个散列路径、NUL、文件内容、NUL，SHA-256 `fd08283bbf90c8f7737b5b48e20e66852d61d1b80ed3997767756bd45a1c7ff6`。
- 首轮 65 MB 旧候选保存在 `/Users/sdy09/Documents/tuzi-switch-artifacts/integration-20261126/compact-backup/Tuzi Assistant Test.app`，仅为回退副本，未安装或打开；用户数据未清理。
- 本次新增构建选项和 plist 仅改变本地测试包/验证入口，没有新增账户、任务或历史数据字段。现有未提交业务修改保留，未整批提交。

## 正式发布前仍需完成

| 门禁 | 当前状态 / 下一步 |
| --- | --- |
| 当前候选的真实网站身份保持 | 当前未登录。来源会话曾验证登录，但候选身份不同，不能移植结论；需用户在候选登录后验证退出重开及必要 OAuth 流程 |
| 新增模型线上效果 | 本轮无新付费调用；Vidu/Mix/MJ 自动化通过不代表全部生成效果。视频生成遵守仅用 MiniMax-H3，不为验收擅自调用其他型号 |
| 跨平台与升级 | 本次变更未做 Windows/Linux/Intel Mac 新包实机及旧版→新版升级验收；此前版本记录不能替代 |
| 完整桌面构建环境 | 本机 Mac ARM 已解除：完整 features 的 Release 构建、资源打包、包内运行时执行及原生专项通过。其他平台仍需独立构建验收 |
| 版本与不可变附件 | 测试流程仍固定 `1.6.3-beta.6`，正式包仍 1.6.4。出新包前须统一脚本、CI、版本及说明，避免覆盖旧测试资产；当前未启动发布 |
| 更新与下载交付 | 新产物需通过既有 updater 签名、升级路径、附件摘要和下载页一致性门禁；acceptance 关闭自动更新，不能替代 |
| 签名政策 | 沿用既有分发政策时明确 ad-hoc 与未公证状态；缺 Developer ID 不等同不能构建，完整性校验也不是 Apple 公证 |

允许继续本机用户体验验收。真实登录、跨平台发行及升级门禁未通过前，不给出“所有客户都能直接上线”的结论。回退沿用可审查提交及 revert，不清空网站 profile、项目、媒体或配置。
