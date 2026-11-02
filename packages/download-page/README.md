# 兔子助手独立下载页

该独立站点源自 new-api / QuantumNous（tuziapi/tuzi-api）的下载页改造，按 AGPL-3.0-or-later 分发，见 LICENSE 和 SOURCE.json。桌面客户端本身的 MIT 许可不替代本目录许可。本目录不导入桌面客户端运行时。

执行 `pnpm --filter @tuzi/download-page build`；产物位于 `dist/tuzi-switch.html`。通过 HTTP 静态服务器访问，支持子路径部署。构建时仅查询正式仓库公开 Release 并验证实际资产；失败会停止构建，不伪造下载链接。页面提示版本快照，最新版本可从发布记录核对。部署后需重新构建才能更新版本快照。

CI 将下载页面、原始来源记录和完整源码归档一起上传为 artifact，不自动部署。`VITE_ACCEPTANCE_RUN_URL` 可提供当前测试构建的 Actions 链接，测试包需要 GitHub 登录并且未签名，不是正式 Release。`VITE_DOWNLOAD_SOURCE_URL` 指向当前提交的页面源码。

点击实际平台包发送 Umami `switch_download_click`，只带 platform/version；统计点击次数，不代表下载完成。Umami 站点 ID 使用用户指定值；本地 QA 应阻断外部分析请求。

蓝色兔子沿用 `src-tauri/icons/icon.png` 原始字节。截图来自本地集成预览，不冒充正式版已发布功能。
