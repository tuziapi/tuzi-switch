# UC-FIX-01：画布生图显示与 Codex 供应商新增修复

日期：2026-11-04。基线：`7376be97`（客户端 v1.5.0），分支 `codex/opentu-assistant-sync`。用户要求修复生成成功但画布空白，并补充新增 Codex 供应商时报 `FOREIGN KEY constraint failed`。本轮修改、验证和本地提交；尚未推送、发布安装包或替换公网下载。

## 画布图片与生成占位

复现：相同的合成 PNG 在 Chrome 正常显示，WebKit 中 HTML 图片 `complete=true`、`naturalWidth>0`，但画布截图的红/青像素均为 0。旧验收只检查解码成功，且使用近乎不可见的 1px 图，无法识别绘制失败。

根因：集成时旧 `isTauriEnvironment()` 被限制为 `__TUZI_CREATIVE_NATIVE__` 存储/IPC 能力；统一宿主未启用该旧能力。图片 SVG 兼容层和生成占位的桌面 SVG 分支也使用该判断，因此在真正的桌面 WebView 中未运行。

修复：

- 新增独立的 `isNativeRenderEnvironment()`，仅判断渲染环境，供图片和生成占位使用；不启用旧文件系统命令。
- SVG 图片加载成功后才隐藏 HTML 回退，失败时恢复；监听和矩形同步在卸载时清理。
- 直接修改 HTML `src` 的已有错误恢复路径也向 SVG 同步最终地址。
- 保留画板元素、缓存地址和任务记录，无数据迁移，不重新请求生图。

验收增加 64px 红/青合成棋盘图，在对应生成元素的实际截图内计数颜色像素；覆盖首次显示与刷新恢复，避免误把任务缩略图当画布成功。WebKit 使用全新独立的持久化 profile：测试中观察到临时 context 刷新会丢失 Cache Storage，改用持久化 profile 后原有缓存路径可恢复；没有据此修改生产缓存逻辑。

## Codex 供应商保存

只读检查本机数据库的外键结构与孤立记录计数，发现 8 条 Codex endpoint 的父供应商已不存在；未读取或修改凭证。合成数据库建立同类历史记录后，真实 `ProviderService::add` 在修复前稳定报相同外键错误。

根因：保存前的补偿事务按行重建私有快照；新快照连接启用了外键约束，复制旧孤立记录时失败，新增供应商尚未执行便中断。

修复：

- 仅私有内存恢复快照关闭外键校验，完整保留历史记录；业务数据库外键约束保持开启。
- 回滚 endpoints 时仅恢复发生变化的行，保留未变的历史孤立行，避免整表删除重建再次触发错误。
- 不清理用户数据库，不放宽新写入约束。合成测试确认新的无父供应商 endpoint 仍被拒绝。

## 验证

| 验证 | 结果 |
| --- | --- |
| 修复前 WebKit 画布像素检查 | 失败：图片已解码但红/青像素均为 0 |
| 修复前含孤立 endpoint 的新增供应商测试 | 失败：`FOREIGN KEY constraint failed` |
| `pnpm exec vitest run --maxWorkers=2 --minWorkers=1` | 91 文件、657 项通过 |
| `pnpm typecheck` | 通过 |
| `cargo test --lib services::tuzi_provider::tests` | 21 项通过，包含 2 个新增历史孤立记录回归，以及文件失败补偿、并发修改保护、七工具备份恢复 |
| Chrome / WebKit 生成验收 | 各 5 场景通过：停留、助手页、项目页、另一项目、未知结果；每次仅 1 次生成 POST，刷新后 0 次重复提交 |
| 生成占位视觉复核 | WebKit 真实截图可见 SVG 状态卡片 |
| `pnpm build:creative` / `pnpm exec vite build` | 通过；保留既有大包警告 |
| 上游补丁重建 | 85 个修改的上游文件与 6 个本地文件重建后，所有保留文件逐字节一致；原始 SHA 不改写 |

本轮浏览器验证使用真实工作区、队列、IndexedDB 与 Cache Storage，只替换 HTTP 为合成传输，所有外部请求拦截。证据目录 `/tmp/creative-webkit-before`、`/tmp/creative-webkit-final`、`/tmp/creative-webkit-progress`、`/tmp/creative-chrome-final`；原生日志 `/tmp/tuzi-orphan-before.log`、`/tmp/tuzi-provider-full.log`。

限制：没有付费生图请求，没有 Windows/Linux 实机安装验收，WebKit 浏览器像素检查不等同于已发布安装包的 WKWebView 实机验收。公开下载的 v1.5.0 尚未包含这些修复。既有上线验收报告中的其他事项不由本轮测试替代。
