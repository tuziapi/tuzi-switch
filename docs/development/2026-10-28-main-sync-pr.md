# MAIN-SYNC-01：上游 main 同步与 PR（2026-10-28）

## 范围和基线

用户明确授权将当前兔子助手改造提交到 `tuziapi/tuzi-switch` 的 `main`，并检查最新 main 特性；用户已确认原消息中的 `mian` 指 `main`。本轮包含本地 merge、必要兼容修复、验证、fork 分支推送和 PR 创建，不包含远程合并、标签、Release 或网站部署。

- 改造基线：`37effff17e49474e6b43404d8844b2fd28b291f5`，此前四平台验收构建对应此提交。
- 最新上游：`0b5ff2bd7d9a63a8711ece4ff1919b0e20893b6e`（PR #51，中文操作埋点、默认打开兔子账户）。同步前改造分支缺少该 1 个提交，包含 22 个独立改造提交。
- 对 `refs/heads/main` 显式 fetch；仓库同时存在名为 main 的标签，不能以模糊 fetch 的 FETCH_HEAD 代替主分支。
- 在独立验收 worktree 继续，原 `gaizhao` 工作目录的未提交修改保持原样。API 契约仍为 `TA-AC-1.5-B4` / `system-token-v1`；本轮未改 API。

## 合并行为

保留整个上游 main 历史，通过 merge 集成，非逐项挑选 main 提交。

- 保留新侧栏、全局工作区、Agents、新工具配置/MCP、模型聚合和已有失败补偿。
- 启动固定进入兔子账户，不再根据历史页面恢复到工具/设置；最近工具选择和显式全局目标仍可使用。
- 保留上游中文操作统计、固定字段白名单、失败不阻塞业务及 CSP/脚本配置。
- 固定枚举补齐 Grok Build/Pi/MiniMax Code 导航和已有 MCP 操作。新工具不归入上次选择的旧工具；配置、令牌、名称、路径及原始错误不进入统计。
- MCP 在成功或失败后均刷新真实状态（onSettled），兼容上游统计包装和跨来源部分导入。未改变现有导入错误 DTO，不从原始错误文本猜测部分成功统计分类。
- 原生 Rust 业务源码、Cargo.toml、Cargo.lock 与先前验收 SHA 完全一致；Tauri 配置只合入上游 CSP 域名许可。

## 本次验证

- `pnpm typecheck`：通过。
- `pnpm exec vitest run --maxWorkers=2 --minWorkers=1`：77 文件、543 项通过。包括历史工具/设置/全局页/新工具页均从账户启动、账户配置导航、真实 Hook 的 MCP 失败后刷新、新工具固定统计字段及秘密过滤。
- 首轮存在 1 项测试失败：Agents 从默认账户进入后为懒加载，旧测试同步查找选择器过早；改为等待实际可访问控件后，最终全量通过，未移除断言或跳过测试。
- `pnpm build:renderer`：通过，保留既有包体积、浏览器数据和动态导入警告。
- 修改的 TS/TSX Prettier、`git diff --check`：通过。
- 本轮原生业务无变更，不重复原生全量构建；此前 `37effff1` 的 macOS/Windows/Linux 原生及实际 macOS 安装副本证据继续按原 SHA 记录，不冒充本轮重新打包验收。
- 合成统计测试使用本地 mock，不向生产 Umami 注入测试事件。

## 发布与未迁移范围

PR 是代码评审交付，不是上线放行。既有 Actions 安装包来自同步前 `37effff1`，不含本次 main 更新；合并后须以最终版本号和源码重新构建。仍需完成真实账户、Windows/Linux/Intel Mac GUI 安装升级回退、网站下载源及正式统计部署验收。按用户决定暂不做正式签名/公证；自动更新签名与清单另行验收，不覆盖旧 v1.4.2 标签。

“同步最新 main”不等于“全量同步 develop”。develop 版本历程已按特性迁移；项目切换、develop 原生匿名统计和 CC 底座完整整合仍见 [迁移记录](2026-10-28-develop-feature-sync.md)。此次接入的是 main 的前端中文操作统计，不是 develop 的原生统计实现。

旧阶段文档中的未修复/未推送状态按历史时点保留；此前一致性、Pi 本机归属、Codex 快照和系统文件锁修复见 [MCP 修复记录](2026-10-28-mcp-release-hardening.md)。
