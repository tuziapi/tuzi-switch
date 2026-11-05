# UC-UP-02：应用内下载，明确点击后重启安装

用户已批准应用内下载与点击重启安装，并要求同步公网下载页。本轮允许实现、验证并沿既有授权发布 AiW520 正式版本；上游 PR 保持 Draft，不合并。

## 实现

- 集成正式渠道走 Tauri updater 的专用签名 manifest，不再走浏览器安装包下载。检测错误在应用内反馈，不降级绕过签名。
- `UpdateSession` 固定待更新版本，下载和安装使用独立方法；传输结束后仍等待原生签名校验成功才进入 ready。重复点击不重复下载/安装，后台检查不替换已下载的资源。
- 设置、顶部和全局通知共用一个更新弹窗。支持进度/已下载字节、后台下载、失败重试、稍后、重启并更新；稍后在当前进程保留更新资源，完全退出后重新检查和下载，不宣称断点续传。
- 安装前检查创作任务恢复/活跃队列和工作流，保存画布快照、刷新已卸载画布的未成功写入，检查存储迁移和原生请求。阻塞时保留 ready 与原因；不会自动重试重启或取消用户生成任务。Windows updater 可能在 install 内退出，保护必须发生在 install 前。
- 发布为各安装类型生成签名，`latest.json` 区分 macOS 架构、Windows MSI/NSIS、Linux DEB/RPM/AppImage。发布前校验 minisign 的载荷签名、Key ID、全局签名及源码 manifest。缺少签名密钥即停止发布。
- AiW520 独立公钥固定于 `scripts/aiw520-updater.pub`，不改变正式 upstream 的信任根。专用私钥保存在仓库外 `~/.local/share/tuzi-switch-release/aiw520-updater.key`（目录0700、文件0600），CI 使用加密 Secret `TUZI_UPDATER_PRIVATE_KEY`。不写私钥到源码、日志或发布文件；不得在以后发版时重新生成该密钥。
- updater 签名不是 Apple 公证/Windows 开发者签名；后两者仍未配置。

## 下载版本反馈

只读核查时公网 latest Release 与页面 `release.json` 均为 v1.5.1，ARM DMG 链接及 SHA256 正确。本机仍运行 `/Volumes/兔子助手/兔子助手.app` 的 1.5.0；没有替换该用户应用。页面主下载显示包版本，macOS 增加退出旧版→拖入应用程序并替换→从应用程序打开的说明；页面回到前台及定时刷新元数据。

v1.5.0/v1.5.1 内置的是手动下载实现，需手动安装一次 v1.5.2。安装好 v1.5.2 后，后续版本才可使用应用内下载、重启安装。不能通过改网页或给旧 Release 补附件改变旧二进制行为。

## 验证状态

实际 Tauri CLI 生成的合成文件签名通过发布验证器，篡改载荷被拒绝。状态机覆盖下载/校验/安装顺序、重复点击、任务阻塞、安装失败和重启失败；创作保存屏障覆盖恢复中、活跃任务、保存失败、迁移和失败写入重试。

浏览器使用合成 IPC 实测：下载完成后尚无安装调用；关闭重开保留 ready；点击后依次保存检查→原生检查→安装→重启；生成中阻塞且不安装；签名失败可重试。此证据不等于真实安装。

本机 macOS ARM 隔离原生更新验证通过：独立应用 1.5.90 从本地签名源下载并安装为 1.5.91，Info.plist 版本正确，安装后二进制 SHA256 与目标包一致。篡改包被原生签名校验拒绝，旧二进制保持不变。验证使用独立应用与合成配置，未替换用户应用；原生 CLI 验证的是后台下载/签名/安装，UI 点击与重启顺序由合成浏览器覆盖。初次验证因 `/tmp` 符号链接和手工 tar 的 AppleDouble 元数据被拒绝，改用真实路径和干净归档后通过。正式 CI 使用 Tauri 产出的归档。

相称验证：宿主 93 文件/669 项、创作 109 文件/1839 项、下载元数据8项、签名2项通过；类型、Rust 编译、renderer/下载页构建与 OpenSpec strict 通过。全量宿主曾与重建 dist 并行导致导入失败，改为构建结束后完整重跑通过。上游补丁 1513 原文件+15本地文件还原一致。生成的 patch 中空白上下文行不做破坏性 trim。正式发布与公网核验已完成，详见下文。真实付费生图、Windows/Linux 用户桌面安装升级以及历史完整迁移等未完成范围不因本轮更新而视为通过。


补充：已核对 Tauri 能力许可包含独立 download/install 与 process restart，fork/upstream 配置分别通过仓库/公钥检查。尝试进一步操作隔离原生界面的按钮时，本机锁屏阻止 UI 控制，已关闭该临时应用；未将此次尝试计为原生点击端到端通过。真实原生后台安装与合成 UI 验证仍按上文分别记录。


## 正式发布与公网交付

- 源码提交 `1fb5ed790a0296711c36ec8ddcfb1f97f8ae5877`、标签 `v1.5.2` 已正常原子推送到 fork main 与集成分支，未强推或覆盖旧标签。
- 云端 [run 41777314996](https://github.com/AiW520/tuzi-switch/actions/runs/41777314996) 的 verify、四个平台构建、原生回归、签名及 publish 全部成功。
- [v1.5.2 Release](https://github.com/AiW520/tuzi-switch/releases/tag/v1.5.2) 于 2026-11-04 13:41:31（Asia/Shanghai）正式公开，Pages 于 13:42:05 部署成功。无测试版本标签；23个附件符合预期清单。
- [公网下载页](https://aiw520.github.io/tuzi-switch/) 实测显示“下载兔子助手 v1.5.2”。Mac双架构、Windows EXE/MSI、Linux DEB/RPM/AppImage 七个 UI 选项逐项检查正确；public release.json 的 URL、大小、SHA256 与 Release 一致。本地下载预览的旧 release.json 也已同步为真实公开的 v1.5.2。
- 实际下载22个验证附件（七个直接安装包、两个 Mac 更新归档、七个签名、四个构建 manifest、latest.json 和 SHA256SUMS），全部与 GitHub asset 摘要一致。`verify-release-assets.py` 再核对源码、版本、构建run、平台及摘要通过；七种更新包的载荷/公钥ID/可信注释签名全部通过，9个更新目标含兼容别名映射正确。源码归档另已公开，本轮未重复下载它。
- ARM DMG 的 hdiutil 完整性检查通过；只读挂载确认内部版本1.5.2、应用ID `com.tuziswitch.desktop`、arm64；DMG和签名更新归档的程序二进制一致。两个Mac更新归档的plist版本/ID和Mach-O架构均正确。验证后卸载挂载点，没有覆盖用户应用。
- 上游 [PR #53](https://github.com/tuziapi/tuzi-switch/pull/53) 同步代码与证据，保持 Draft，未合并。

临时验证证据位于 `/tmp/tuzi-v152-delivery/`：公网下载摘要、run状态、页面元数据/截图、DMG身份、隔离原生升级记录。原生UI完整点击链受锁屏阻塞、Windows/Linux实机安装升级及真实付费生成等限制仍保留；发布成功不代表这些未完成验收通过。
