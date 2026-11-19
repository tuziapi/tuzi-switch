# UC-CL-REFRESH-1117：统一验收版继续同步与真实联调

2026-11-17。本轮按用户要求继续同步 ClaudeMom 指定会话，保留已合入的 OpenTu。用户确认使用原应用的“兔子”线路在独立验收版测试，并授权此验收环境的新 CA；随后确认已启用。仅本地集成、构建、安装和验收，本轮没有推送或发布。

## 源码与字段兼容

目标分支 `codex/integrate-opentu-claude-1117`，原 HEAD `17491aa681dff890450832aa99d170a0f504d200`；合入来源 `869ceb573c7d9f4d60138f226b51ec0b9355db13`。来源工作区只读核对，未修改。

本次纳入统一模型选择、全目录搜索、非 Claude 模型自动别名、显式 API 协议、手动路由保留，以及干净构建机资源和 Windows ARM64 QuickJS 绑定修复。README / progress 冲突保留两侧记录，其余源码自动合并。

集成回归发现共享表单 fixture 缺少新生成的 `claudeDesktopModelRoutes.*.displayName`。补齐合成值，并在原生七工具保存/恢复测试中验证该字段持久化。生产字段保持可选；没有新数据库表或列，也没有真实凭证写入 fixture。

## 本地验证

| 层次 | 结果 |
|---|---|
| 宿主全量 | 105 个文件、899 项通过；类型检查通过 |
| 原生组合特性 | `claude-desktop-local,opentu-preview` 的 `local_` 筛选 29 项通过 |
| 跨端表单契约 | 七工具真实表单 fixture 保存/恢复 1 项通过，包含新增 displayName |
| 合成 Claude 界面 | 启动前置检查、授权模拟、绑定、停止、异常恢复与窄屏通过 |
| 模型配置浏览器 | 28 项合成目录；选择 deepseek-chat / openai_chat，保存 27 条路由成功；仅合成数据 |
| 已编译 OpenTu 浏览器 | 草稿原位转进度、结果替换、重载保留且不重复提交通过，未调用付费模型 |
| 构建与安装 | Mac ARM Debug 独立包成功，ad-hoc 深度签名检查通过 |

本次未修改创作源码，不重复引用上轮 2950 项作为本轮重新执行；上轮范围见 [统一集成记录](2026-11-17-unified-opentu-claude.md)。本轮日志保留于 `/tmp/tuzi-unified-refresh-*`，结构化结果和截图见本目录附件。

## 安装与隔离

安装到 `/Applications/OpenTu 验收版.app`，主程序 SHA256：
`07a6acb39da8b7b86a4c7a91f4e28b361d7ef2de574b74217ba5d6f8b012a416`。

原 `/Applications/兔子助手.app` 主程序保持 `64c41bdd071736bd5e836a06050183c872e3e2587ab484725298ebb390e87b0d`。旧验收包和验收数据库备份路径见 [安装证据](attachments/unified-claude-refresh-1117/install.json)。独立 bundle id 为 `com.tuziswitch.desktop.opentu-preview`，更新安装功能关闭，不是正式更新包。

仅将用户指定“兔子”供应商复制到独立数据库，原数据库只读，未复制其他账户令牌。原 Claude 会话确认空闲后正常退出、停止其兼容绑定。共享网关未随停止绑定而关闭，曾导致验收版首次启动报端口占用；正常恢复后用户手动启用成功。实际端口仍为 15721，不将未保存的 15731 设置尝试记为修复。

实际运行的 Claude 为验收 profile 内的官方签名 5.11492.5 私有副本。新 CA 的 SSL 与 Basic X.509 两项信任已只读核验。原生日志共享边界仍存在，不声称全盘隔离。

## 真实验收（部分通过）

1. 验收版原生模型/协议配置入口、原有两个 OpenTu 项目和含参考图的合成草稿正常恢复。
2. Code 使用“兔子”/`claude-sonnet-4-6` 返回指定 `TUZI-ACCEPT-1117-OK`。同一会话第二轮从前文取回该标记，在专用 `Tuzi-Acceptance-1117` 目录创建 `acceptance-result.txt`，读回两行内容。独立文件读取与 UI 返回一致，网关四条推理记录均为 HTTP 200、流式响应。这里使用真实模型和合成提示词，不是 Mock。
3. 普通 Chat 首次被官方 VM 安装空间检查拦截：实际 11.0 GB，要求 16.1 GB。本轮仅清理工作区可重建的 Rust Debug 缓存；保留安装包、备份及用户数据。之后磁盘可用空间恢复到约 30 GiB，通过原生“重试”开始官方下载，未替换旧 VM、未修改客户端检查。下载仍进行中，普通 Chat、Cowork、电脑控制、语音与完整冷重启未通过本轮验收。
4. Code 中将 Sonnet 4.6 切换为 `claude-haiku-4-5`，确认切换后返回 `MODEL-SWITCH-OK`；网关核对实际路由型号为 Haiku 且 HTTP 200。非 Claude 模型统一选择已完成合成验证；当前授权线路保留的目录是 Claude 型号，未将合成 deepseek 结果描述为真实跨供应商联调。

详细脱敏数据见 [真实验收证据](attachments/unified-claude-refresh-1117/real-acceptance.json)。不提交凭证、完整个人日志或用户文件。

## 云端旁证与未关闭的问题

只读检查来源分支 run `44034208276`，它属于 `869ceb57`，不是整合分支的最终候选。六平台运行时均通过；Linux x64/ARM64、Mac ARM/Intel、Windows x64 五个平台候选成功；该运行最终因 Windows ARM64 失败而整体失败。Windows ARM64 的原生集成测试在 `backend::private_dir` 失败，错误为 `Private directory permission check timed out`；QuickJS ABI 测试已通过。

源码确认该检查通过 PowerShell 设置并验证私有目录 ACL，15 秒后终止进程。当前日志不足以区分冷启动延迟和实际挂起；没有跳过 ACL、修改超时后假定通过，也没有重新运行远端任务。Windows ARM64 必须补充诊断并在真实 runner 复验。

当前结论：同步、构建、独立安装、Code 两轮及文件任务已完成；完整功能与跨平台发行门槛未满足。继续使用本候选完成 VM 初始化后的真实任务及重启/恢复；正式身份签名、安装升级、六平台实机与发行材料仍分别验收，不以该 Debug 包代替正式发布。

最后检查：官方 rootfs 压缩文件公开响应大小为 1,246,877,094 字节；独立下载范围探测成功（HTTP 206，1 MiB / 5.12 秒），仅用于排查网络，不替换客户端资源。没有找到可直接复用的原始压缩缓存。普通 Chat 提交后等待正在进行的 VM 初始化，尚无模型回复；窗口捕获随后两次出现 macOS ScreenCaptureKit -3811 错误。Code 已通过的真实结果不受此项影响，普通 Chat 继续标记未通过。
