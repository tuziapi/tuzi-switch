# UC-TEST-PUBLISH-1117：测试站五平台预览版

2026-11-17。用户明确授权先在测试站发布测试版并更新下载页，测试通过后再考虑正式发布；随后选择重新构建 Mac 双架构、Windows x64、Linux 双架构，全部成功后一起发布。此授权覆盖本轮测试仓库 push、预发行版与测试 Pages 部署；不包含正式仓库或正式更新通道。

基线：整合提交 dc41e65a（Claude 来源 869ceb57，OpenTu 来源 4ff56e54）。发布准备分支 codex/test-opentu-1117。版本 1.6.3-beta.1，独立身份 com.tuziswitch.desktop.opentu-preview，手动安装、关闭自动更新、与正式数据隔离。构建采用优化 Release profile，Mac DMG、Windows x64 NSIS EXE、Linux 双架构 DEB。没有 Apple 开发者签名/公证或 Windows Authenticode；不是正式更新签名验收的替代品。

跨平台共存检查发现预览主程序和 Linux sidecar 沿用正式文件名；已更名为 tuzi-opentu-preview / tuzi-opentu-preview-node，避免写入正式包相同的 usr/bin 路径。Mac/Windows sidecar 位于独立安装目录。新增发布构建参数拒绝正常身份，保留已有本地 Debug 构建语义。

构建前 17 项打包脚本测试通过。远端工作流必须先通过宿主/创作/运行时回归，再在五种原生 runner 执行 Release 特性原生测试、打包与安装包检查。所有附件必须来自同一 SHA 和 run，核对摘要后再创建测试仓库 prerelease；不标记 Latest，不生成正式 latest.json。测试站将使用单独预览清单，正式页面生成器继续拒绝 prerelease。

已知限制沿用真实验收记录：Code 多轮、文件读写和 Sonnet→Haiku 路由实测通过；普通 Chat/Cowork 的 VM 初始化、电脑控制、语音及跨平台实机功能尚未全部验收。Windows ARM64 上一候选 ACL 超时，因此不在本次五平台下载范围。重新打包后的安装包仍须核验，不能把旧包实测写成新包全功能通过。

发布与公网复核进行中，尚未发布。

用户补充确认沿用既有下载页面：移除尚未部署的新独立页面，保留 TuziDownloadPage 原布局、截图、导航与主题，只接入测试清单、五个架构入口和测试说明。正式模式及其严格 stable 清单校验继续保留。测试模式不发送正式下载统计，也不显示正式安装脚本。

候选完整版本同步至 package.json、Tauri 配置与 Cargo 包/锁文件，确保关于页面、原生 MCP 报告和安装包均为 1.6.3-beta.1；前轮构建已取消，重新基于一致源码构建。

本地验证：17 项打包脚本、19 项下载页清单/路由/正式渠道回归、宿主类型检查通过；Cargo `metadata --locked --no-deps` 与前端/Tauri 配置一致为 1.6.3-beta.1。原页面测试/正式两种静态构建通过。浏览器使用仅放在忽略目录 dist 的合成清单验证五种架构选择、SHA 展开、深色主题、窄屏无横向溢出（实际 viewport 520 px）以及损坏清单禁止下载；这些合成地址未当成公开下载。最终五平台重建 run 44044192167 / 6ba2caaf98412ef3542ed5ef0ff276eb293fba8d 进行中。

最终源码 6ba2caaf 的云端 verify 已通过：宿主 899 项、创作 2950 项、类型检查、运行时、打包脚本和下载页检查。五平台原生 Release 构建仍在进行，尚未据此发布。正式站 index/release.json 的部署前 SHA256 已保存至本机 /tmp/opentu-page-before-1117.json，发布后再次比对以确认没有影响正式页面。

构建阻断：run 44044192167 的 Linux x64 缺少 espeak-ng 静态库；Linux ARM64 的 29 项原生测试通过，但 Tauri 正式构建缺少 sherpa-onnx-c-api。日志均恢复了此前 Rust cache；所用 rust-cache d1527c8f 的 cleanTargetDir 会递归删除非 Cargo 目录中的文件，而 sherpa-onnx-sys 1.13.8 仅以 lib 目录存在判断预编译库完整。已核对原官方 tar 中含 libespeak-ng.a。修复为缓存恢复后清除 CI 的生成语音库目录、cargo clean 该 sys crate，让依赖重新下载/解包，保留语音特性和测试门禁；不修改依赖源码或用空库绕过链接。

run 44046652521 再次在 Linux x64 失败，原因是按包执行 cargo clean 默认只清 Debug，日志 Removed 0 files，Release build-script 输出仍指向已被删的语音目录。已用本机临时双 crate 编译实验复现：默认 clean 保留 Release rlib，带 --release 后确实移除。因此补齐 --release 后重新构建；不把命令退出成功等同修复有效。

发布传输使用独立手动工作流 publish-opentu-preview.yml：本机 GitHub 大附件下载较慢，改由测试仓库 runner 读取同一次成功构建的五个产物、逐字节核对清单摘要，生成精确源码与 SHA256SUMS，草稿上传后比对 GitHub 资产 digest 才公布 prerelease；保留原 Latest。仅在测试 main 可运行，失败构建、不同源码/身份/平台拒绝发布，已有标签拒绝覆盖。两个发布脚本合成测试覆盖正确的五平台及错误仓库、提交、run、摘要、缺包、自动更新标志和远端摘要错配。此内部传输调整不另建下载页面，也不改变安装包源码；最终构建 run 44048585617 / ba998a2e4c105d72380b52686aa1f1b4c28f56b9 仍在进行。
