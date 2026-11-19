# UC-TEST-PUBLISH-1117：测试站五平台预览版

2026-11-17。用户明确授权先在测试站发布测试版并更新下载页，测试通过后再考虑正式发布；随后选择重新构建 Mac 双架构、Windows x64、Linux 双架构，全部成功后一起发布。此授权覆盖本轮测试仓库 push、预发行版与测试 Pages 部署；不包含正式仓库或正式更新通道。

基线：整合提交 dc41e65a（Claude 来源 869ceb57，OpenTu 来源 4ff56e54）。发布准备分支 codex/test-opentu-1117。版本 1.6.3-beta.1，独立身份 com.tuziswitch.desktop.opentu-preview，手动安装、关闭自动更新、与正式数据隔离。构建采用优化 Release profile，Mac DMG、Windows x64 NSIS EXE、Linux 双架构 DEB。没有 Apple 开发者签名/公证或 Windows Authenticode；不是正式更新签名验收的替代品。

跨平台共存检查发现预览主程序和 Linux sidecar 沿用正式文件名；已更名为 tuzi-opentu-preview / tuzi-opentu-preview-node，避免写入正式包相同的 usr/bin 路径。Mac/Windows sidecar 位于独立安装目录。新增发布构建参数拒绝正常身份，保留已有本地 Debug 构建语义。

构建前 17 项打包脚本测试通过。远端工作流必须先通过宿主/创作/运行时回归，再在五种原生 runner 执行 Release 特性原生测试、打包与安装包检查。所有附件必须来自同一 SHA 和 run，核对摘要后再创建测试仓库 prerelease；不标记 Latest，不生成正式 latest.json。测试站将使用单独预览清单，正式页面生成器继续拒绝 prerelease。

已知限制沿用真实验收记录：Code 多轮、文件读写和 Sonnet→Haiku 路由实测通过；普通 Chat/Cowork 的 VM 初始化、电脑控制、语音及跨平台实机功能尚未全部验收。Windows ARM64 上一候选 ACL 超时，因此不在本次五平台下载范围。重新打包后的安装包仍须核验，不能把旧包实测写成新包全功能通过。

测试预发行 opentu-preview-v1.6.3-beta.1 与原测试下载页均已上线，公网复核通过；本轮未发布正式版本。下方过程记录保留当时状态，当前交付以本节及末尾记录为准。

用户补充确认沿用既有下载页面：移除尚未部署的新独立页面，保留 TuziDownloadPage 原布局、截图、导航与主题，只接入测试清单、五个架构入口和测试说明。正式模式及其严格 stable 清单校验继续保留。测试模式不发送正式下载统计，也不显示正式安装脚本。

候选完整版本同步至 package.json、Tauri 配置与 Cargo 包/锁文件，确保关于页面、原生 MCP 报告和安装包均为 1.6.3-beta.1；前轮构建已取消，重新基于一致源码构建。

本地验证：17 项打包脚本、19 项下载页清单/路由/正式渠道回归、宿主类型检查通过；Cargo `metadata --locked --no-deps` 与前端/Tauri 配置一致为 1.6.3-beta.1。原页面测试/正式两种静态构建通过。浏览器使用仅放在忽略目录 dist 的合成清单验证五种架构选择、SHA 展开、深色主题、窄屏无横向溢出（实际 viewport 520 px）以及损坏清单禁止下载；这些合成地址未当成公开下载。最终五平台重建 run 44044192167 / 6ba2caaf98412ef3542ed5ef0ff276eb293fba8d 进行中。

最终源码 6ba2caaf 的云端 verify 已通过：宿主 899 项、创作 2950 项、类型检查、运行时、打包脚本和下载页检查。五平台原生 Release 构建仍在进行，尚未据此发布。正式站 index/release.json 的部署前 SHA256 已保存至本机 /tmp/opentu-page-before-1117.json，发布后再次比对以确认没有影响正式页面。

构建阻断：run 44044192167 的 Linux x64 缺少 espeak-ng 静态库；Linux ARM64 的 29 项原生测试通过，但 Tauri 正式构建缺少 sherpa-onnx-c-api。日志均恢复了此前 Rust cache；所用 rust-cache d1527c8f 的 cleanTargetDir 会递归删除非 Cargo 目录中的文件，而 sherpa-onnx-sys 1.13.8 仅以 lib 目录存在判断预编译库完整。已核对原官方 tar 中含 libespeak-ng.a。修复为缓存恢复后清除 CI 的生成语音库目录、cargo clean 该 sys crate，让依赖重新下载/解包，保留语音特性和测试门禁；不修改依赖源码或用空库绕过链接。

run 44046652521 再次在 Linux x64 失败，原因是按包执行 cargo clean 默认只清 Debug，日志 Removed 0 files，Release build-script 输出仍指向已被删的语音目录。已用本机临时双 crate 编译实验复现：默认 clean 保留 Release rlib，带 --release 后确实移除。因此补齐 --release 后重新构建；不把命令退出成功等同修复有效。

发布传输使用独立手动工作流 publish-opentu-preview.yml：本机 GitHub 大附件下载较慢，改由测试仓库 runner 读取同一次成功构建的五个产物、逐字节核对清单摘要，生成精确源码与 SHA256SUMS，草稿上传后比对 GitHub 资产 digest 才公布 prerelease；保留原 Latest。仅在测试 main 可运行，失败构建、不同源码/身份/平台拒绝发布，已有标签拒绝覆盖。两个发布脚本合成测试覆盖正确的五平台及错误仓库、提交、run、摘要、缺包、自动更新标志和远端摘要错配。此内部传输调整不另建下载页面，也不改变安装包源码；最终构建 run 44048585617 / ba998a2e4c105d72380b52686aa1f1b4c28f56b9 仍在进行。

最终五平台构建完成：run 44048585617 / ba998a2e4c105d72380b52686aa1f1b4c28f56b9 的 verify 与五个平台任务均 success。Mac 双架构通过 DMG 挂载、独立身份/版本、ad-hoc 签名完整性及包内 Node 执行；Linux 双架构通过 DEB 解包、正式二进制路径无冲突与 Node 执行；Windows x64 完成原生测试与 EXE 打包/摘要，不冒充实机安装或完整功能验收。

发布 run 44058368402 已逐字节核对并上传八个附件，但 GitHub release-by-tag 接口对草稿返回 404，因此保持草稿 448415988，尚未公开。发布脚本改用草稿数字 ID 核验，并只恢复同标签、同源码、逐字节一致的草稿附件；拒绝覆盖已公开版本或修改标签。补充草稿恢复/拒绝覆盖的测试后继续，安装包沿用原成功构建，不重建。

测试预发行已完成：发布 run 44058932399 成功，Release 448415988 / opentu-preview-v1.6.3-beta.1 公开，8 个附件均与原构建逐字节一致；测试仓库 Latest 仍为 v1.5.4。实际 preview-release.json 来自发布凭据产物，已在本机核对真实 Release、五安装包摘要、固定标签与成功构建。即将推送清单以触发原测试页部署。


## 测试交付与公网验收完成

- 安装包源码：`ba998a2e4c105d72380b52686aa1f1b4c28f56b9`；五平台构建 `44048585617`、发布 `44058932399`、Pages 部署 `44059366175` 均 `completed / success`。页面部署源码为 `3bd54f7a88815a9b337cff2df80c1c94929219bb`；后续文档提交不改变安装包。
- 沿用原测试下载页 https://aiw520.github.io/tuzi-switch/ ，原布局、导航、主题及截图保留；删除新独立页面。当前公开版本 `1.6.3-beta.1`，包含 Mac ARM64 / Intel、Windows x64、Linux x64 / ARM64 五个安装包。
- 公网浏览器真实选择五种平台/架构，逐一核对下载链接与发布清单；SHA256 展开与平台切换、源码下载链接、测试说明正确，当前加载的产品图与图标无破图。截图及五个实际链接见本节附件。
- 八个公开附件摘要与构建一致；五个安装包 HTTP 200、长度一致。Mac ARM 云端 artifact 已完整下载至本机，SHA256 一致，额外只读挂载 DMG 验证版本、独立应用身份和 ad-hoc 签名完整性后卸载；没有覆盖或启动现有应用，不把此检查描述为新包完整业务验收。
- 正式页面 index 与 release.json 前后 SHA256 完全一致。测试 prerelease 未标记 Latest，测试 Latest 仍 `v1.5.4`；未修改正式更新通道或发布正式版。
- 用户可开始测试；Chat/Cowork VM、电脑控制、语音、目标 ChatGPT 客户端完整联调和跨平台实机功能仍待完整验收。此前候选实测范围继续单独记录，不能替代当前 beta 全功能验收。

证据目录：[preview-publication-1117](attachments/preview-publication-1117/)。包括 `publication.json`、`build-manifest.json`、`SHA256SUMS`、`public-download-heads.json`、`browser-downloads.json`、`official-before.json`、`official-unchanged.json`、`local-macos-dmg.json` 和 `download-page.jpg`。只保存公开发布元数据，不含凭证或用户业务数据。
