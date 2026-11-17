# UC-TEST-PUBLISH-1117：测试站五平台预览版

2026-11-17。用户明确授权先在测试站发布测试版并更新下载页，测试通过后再考虑正式发布；随后选择重新构建 Mac 双架构、Windows x64、Linux 双架构，全部成功后一起发布。此授权覆盖本轮测试仓库 push、预发行版与测试 Pages 部署；不包含正式仓库或正式更新通道。

基线：整合提交 dc41e65a（Claude 来源 869ceb57，OpenTu 来源 4ff56e54）。发布准备分支 codex/test-opentu-1117。版本 1.6.3-beta.1，独立身份 com.tuziswitch.desktop.opentu-preview，手动安装、关闭自动更新、与正式数据隔离。构建采用优化 Release profile，Mac DMG、Windows x64 NSIS EXE、Linux 双架构 DEB。没有 Apple 开发者签名/公证或 Windows Authenticode；不是正式更新签名验收的替代品。

跨平台共存检查发现预览主程序和 Linux sidecar 沿用正式文件名；已更名为 tuzi-opentu-preview / tuzi-opentu-preview-node，避免写入正式包相同的 usr/bin 路径。Mac/Windows sidecar 位于独立安装目录。新增发布构建参数拒绝正常身份，保留已有本地 Debug 构建语义。

构建前 17 项打包脚本测试通过。远端工作流必须先通过宿主/创作/运行时回归，再在五种原生 runner 执行 Release 特性原生测试、打包与安装包检查。所有附件必须来自同一 SHA 和 run，核对摘要后再创建测试仓库 prerelease；不标记 Latest，不生成正式 latest.json。测试站将使用单独预览清单，正式页面生成器继续拒绝 prerelease。

已知限制沿用真实验收记录：Code 多轮、文件读写和 Sonnet→Haiku 路由实测通过；普通 Chat/Cowork 的 VM 初始化、电脑控制、语音及跨平台实机功能尚未全部验收。Windows ARM64 上一候选 ACL 超时，因此不在本次五平台下载范围。重新打包后的安装包仍须核验，不能把旧包实测写成新包全功能通过。

发布与公网复核进行中，尚未发布。
