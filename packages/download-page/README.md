# 兔子助手独立下载页

源自 new-api / QuantumNous（tuziapi/tuzi-api）下载页，按 AGPL-3.0-or-later 分发，见 LICENSE 和 SOURCE.json。桌面客户端 MIT 许可不替代本目录许可。

`pnpm --filter @tuzi/download-page build` 生成 `dist/tuzi-switch.html`，支持子路径部署。`RELEASE_TAG` 可固定公开正式版本；默认核实 AiW520/tuzi-switch 的 latest Release。必须非 draft、非 prerelease，七个具体安装文件、URL、大小及 GitHub SHA256 摘要完整有效才构建。不会回退到旧的 Actions artifact。

macOS 提供 ARM64 / Intel DMG，Windows 提供 EXE / MSI，Linux 提供 DEB / RPM / AppImage。直接下载公开 Release 附件，无需 GitHub 登录。页面清楚说明未签名及旧 opentu 数据迁移限制。

`Unified desktop release` 在全部校验和四平台安装包构建成功后公开正式 Release，再构建部署 Pages。Pages 使用 GitHub Actions，github-pages 环境允许版本标签。版本标签和公开安装文件不覆写。若后续 Pages 发布失败，已发布安装包仍可直接下载，可从同一标签重新构建网站并部署，不能重新覆盖安装包。

前端更新提醒直接读分发仓库 Release，按原生架构打开 DMG / EXE / AppImage；不执行自动覆盖安装或重启。旧独立测试客户端须手动安装正式版本，旧测试数据保留在其独立目录。

`pnpm --filter @tuzi/download-page test` 检查来源、缺包、摘要和统计桥。历史 acceptance 模块保留用于旧元数据回归，不再用于公开下载入口。`VITE_DOWNLOAD_SOURCE_URL` 指向此页面对应的精确源码；Pages 和 Release 同时提供源码归档。

Umami `switch_download_click` 仅记录 platform/version，包含 MSI、Mac Intel、Linux 格式选择。点击数不代表安装完成，本地 QA 阻断生产统计。蓝兔图标沿用原图标；截图使用合成示例数据。

独立修订网页或重试部署：从 main 手动运行 `Publish download page`。只使用当前 latest 的已公开正式安装包，不重建、不替换 Release 附件。
