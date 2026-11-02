# 兔子助手独立下载页

该站点源自 new-api / QuantumNous（tuziapi/tuzi-api）下载页改造，按 AGPL-3.0-or-later 分发，见 LICENSE 和 SOURCE.json。桌面客户端 MIT 许可不替代本目录许可。

运行 `pnpm --filter @tuzi/download-page build`，产物为 `dist/tuzi-switch.html`，通过 HTTP 静态服务器访问，支持子路径部署。主下载提供包含 opentu 的集成测试包，历史正式版仅作为次要入口。

`acceptance-build.json` 固定已成功的安装包 run ID 和完整提交 SHA。构建只读核实该 run 所属仓库、工作流、完成状态、提交及四个平台 artifact 的归属、大小和有效期。缺失、过期或不一致会停止构建；页面也拒绝过期数据，不回退到旧正式版。新测试包成功后更新此文件并重建部署即可，不能把尚未完成的当前 CI run 直接作为下载目标。

macOS 支持 Apple Silicon / Intel；Windows ZIP 内含 EXE / MSI，Linux ZIP 内含 DEB / RPM / AppImage。GitHub artifact 下载需要登录、保留 30 天。界面明确测试标识、独立配置和首次连接账户要求。它们不是正式 Release。

构建会先运行下载来源及统计桥回归；也可运行 `pnpm --filter @tuzi/download-page test`。`VITE_DOWNLOAD_SOURCE_URL` 指向当前页面源码。网站 artifact 包含完整源码归档和校验清单；CI 本身不自动部署。

Umami `switch_download_click` 仅包含 platform/version，支持测试构建版本和 macOS Intel；统计点击不代表下载完成。本地 QA 不点击真实下载链接，不发送生产事件。

蓝色兔子沿用 `src-tauri/icons/icon.png`；展示截图使用合成数据。未完成的安装、迁移和真实业务验收见客户端开发记录。

## 自动发布与客户端更新

`Publish acceptance downloads` 在测试 main 的 `Acceptance installers` 全部成功后生成带 schemaVersion/repository/runNumber/publishedAt 的 release.json，先部署 Pages，再发布相同的客户端清单。Pages 配置需为 GitHub Actions，github-pages 环境需允许 main；工作流仅在 AiW520/tuzi-switch 执行。失败构建和旧构建不推进下载目标。旧客户端需手动安装一次带提醒的新包。Actions artifact 保留 30 天并需要 GitHub 登录。详情见仓库 docs/development/2026-11-02-update-notifications.md。
