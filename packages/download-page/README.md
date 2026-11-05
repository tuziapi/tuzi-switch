# 兔子助手独立下载页

源自 new-api / QuantumNous（tuziapi/tuzi-api）下载页，按 AGPL-3.0-or-later 分发，见 LICENSE 和 SOURCE.json。桌面客户端 MIT 许可不替代本目录许可。

`pnpm --filter @tuzi/download-page build` 生成 `dist/tuzi-switch.html`，支持子路径部署。`RELEASE_TAG` 可固定公开正式版本；默认核实正式仓库 `tuziapi/tuzi-switch` 的 latest Release。`VITE_RELEASE_REPOSITORY`（优先）或 CI 的 `GITHUB_REPOSITORY` 同时控制元数据脚本与浏览器校验，只允许正式仓库和独立测试仓库 `AiW520/tuzi-switch`，拒绝跨仓库文件。必须非 draft、非 prerelease，七个具体安装文件、URL、大小及 GitHub SHA256 摘要完整有效才构建。不会回退到旧的 Actions artifact。

macOS 提供 ARM64 / Intel DMG，Windows 提供 EXE / MSI，Linux 提供 DEB / RPM / AppImage。直接下载公开 Release 附件，无需 GitHub 登录。页面清楚说明未签名及旧 opentu 数据迁移限制。

`Unified desktop release` 在全部校验和四平台安装包构建成功后公开正式 Release，再构建部署 Pages。Pages 使用 GitHub Actions，github-pages 环境允许版本标签。版本标签和公开安装文件不覆写。若后续 Pages 发布失败，已发布安装包仍可直接下载，可从同一标签重新构建网站并部署，不能重新覆盖安装包。

v1.5.2 起客户端使用分发仓库的签名更新清单，在应用内下载并校验，用户明确点击“重启并更新”后安装。网页仍直接下载对应平台的 DMG / EXE / MSI / DEB / RPM / AppImage。v1.5.0 / v1.5.1 及旧独立测试客户端须先手动安装新版本，旧测试数据保留在其独立目录。

`pnpm --filter @tuzi/download-page test` 检查来源、缺包、摘要和统计桥。历史 acceptance 模块保留用于旧元数据回归，不再用于公开下载入口。`VITE_DOWNLOAD_SOURCE_URL` 指向此页面对应的精确源码；Pages 和 Release 同时提供源码归档。

Umami `switch_download_click` 仅记录 platform/version，包含 MSI、Mac Intel、Linux 格式选择。点击数不代表安装完成，本地 QA 阻断生产统计。蓝兔图标沿用原图标；截图使用合成示例数据。

独立修订网页或重试部署：从 main 手动运行 `Publish download page`。只使用当前 latest 的已公开正式安装包，不重建、不替换 Release 附件。

## v1.5.5 正式仓库发布准备

统一流水线支持正式仓库及独立测试仓库。手动运行时 `publish=false` 为默认值：完成验证、四平台构建、七种安装文件及签名校验后，仅上传 `verified-release` 安装产物和 `download-page-template` 网页编译产物。网页模板不含公开下载清单，不能直接部署。指定版本标签并明确启用 `publish=true`，或推送版本标签，才进入 Release/Pages 发布。旧 `build.yml` 已停用，防止同一标签启动两套发布。

正式仓库沿用 `src-tauri/tauri.conf.json` 中的原公钥与 `TAURI_SIGNING_PRIVATE_KEY` / 可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。测试仓库使用 `scripts/aiw520-updater.pub` 及 `TUZI_UPDATER_PRIVATE_KEY`，不互相兜底。构建前签署合成文件验证密钥配对；不重置、替换或打印真实密钥。GitHub Pages 的 Source 须由管理员设为 GitHub Actions，且 github-pages 环境须允许版本标签；流水线在公开安装文件前检查 Pages Source。

测试渠道已安装客户端不自动转入正式渠道；用户手动安装正式版，保留原数据。正式版使用完整安装更新，保留但不加载旧界面热更新缓存。新正式 Release 尚未存在时完整 `pnpm build:download` 应拒绝生成下载清单；可用 `pnpm --filter @tuzi/download-page exec vite build` 验证页面编译，但该产物缺少已发布安装文件清单，不能当作可用的公开下载页。

### v1.5.5 手动交付补充（2026-11-05）

用户随后明确要求“不需要签名，直接构建就好”。本次从正式源码构建未签名安装包，公开下载页设置 `VITE_MANUAL_INSTALL_ONLY=true`，显示手动安装说明；该变量省略时默认不显示此说明。客户端保留原正式公钥及验签，不生成 unsigned latest.json，也不复制测试密钥。标准签名流水线保留供后续版本使用，本次通过已验证产物手动发布。

正式仓库 Pages 当前仍使用 main 根目录，因此本次将本地编译并核实真实 Release 元数据的静态页面提交至根目录，由现有 Pages 流程部署；不依赖已被计费锁定的自定义发布 runner。源码链接固定至对应页面源码提交，完整客户端源码附件保留于正式 Release。将来恢复 Actions 发布时应删除这份根目录快照，避免两种发布方式并行维护。
