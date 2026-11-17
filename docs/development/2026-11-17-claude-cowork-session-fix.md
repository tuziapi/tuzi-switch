# CL-LOCAL-COWORK-01：本地 Cowork 会话路由修复

日期：2026-11-17。范围：已批准 B 方案内的本地修复、候选安装及实机验收；无 push、PR 或发布。

## 问题与修改

Claude 5.11492.5 在提交“你控制我的电脑去打开我的兔子助手”时出现 `startRemoteCoworkSession: no session id in response`。本机 renderer 的云端路由偏好在 `account.settings.dramatic_shrimp_enabled` 缺失或为 null 时默认为 true，随后请求托管 Cowork 会话；本地兼容网关没有云端执行器。

仅在 managed + strictModels 兼容模式的账户响应中明确返回该偏好为 false，使用客户端已有的本地会话执行器。bootstrap account/user 和 account_profile 刷新均保持一致。不伪造远程 session ID，不修改官方客户端资源，不绕过原生操作权限和 TLS 验证。

未新增持久化字段或数据库迁移。账户响应新增字段同时覆盖初始化与刷新路径，并补充回归断言；非严格上游行为保持原状。后续客户端升级必须重新验证路由语义。

## 已有验证

- `pnpm test:claude-local-runtime`：90 项通过。
- 本机 macOS ARM Debug 候选构建成功，已替换 `/Applications/兔子助手.app`，版本仍为 1.6.2 测试包。
- 安装主程序 SHA256：`64c41bdd071736bd5e836a06050183c872e3e2587ab484725298ebb390e87b0d`。
- 原应用及 SQLite 备份：`~/Library/Application Support/Tuzi Local Backups/cowork-routing-20261117-121250`。
- 正常 profile 的本地 CA 经只读核查同时满足 SSL 和 Basic X.509 信任。

## 实机验收（等待桌面恢复）

正常 profile 缺少 VM，旧实验 profile 中的已运行 rootfs 与官方原始校验值不同，不复制其可变镜像、机器标识或会话数据。使用固定官方客户端 manifest 的镜像地址，下载时校验压缩包和解压后 SHA256；稀疏解压只用于节省本机实验磁盘空间，不降低校验条件。已清理本任务可重建的 Debug 编译目录。

镜像已完成双重 SHA256 校验，逻辑大小 10 GiB、实际分配 5,010,210,816 bytes，见 [镜像校验证据](evidence/2026-11-17-cowork-vm-assets.json)。正在运行的代理 account_profile 只读探测确认本地路由偏好为 false。

12:32 后桌面工具无法读取 Claude 与兔子助手窗口（`cgWindowNotFound`），进程仍在；重新获取应用后仍不可访问，已请用户确认解锁并恢复 Claude 窗口。没有绕过桌面操作接口提交任务。

验收必须依次取得：真实本地会话创建、原指令提交、电脑工具实际执行、兔子助手窗口打开和任务结果返回。当前未取得完整链路证据，不能认定 Cowork/电脑控制或全功能可发布。其他系统实机门槛不变。

## 客户交付准备续修

用户要求做到可向客户完整交付。桌面接口再次连续两次超时，已请求恢复桌面；未以终端或其他 UI 自动化绕过当前桌面工具。

补齐两个运行时缺口：

- 严格托管模式下，对两个 API 主机的云端会话创建请求明确返回 501 与固定恢复说明；在通用空响应和 SSE 分流前拒绝，不返回虚假会话 ID，不回显用户提示词、不发起模型调用。
- 云端会话列表及 watch 保持本地响应。检查发现旧 `/v1/` 辅助分支未被这些请求实际触达，API 主机的列表请求会继续上游；已显式路由至本地发现接口。

91 项运行时回归通过。新增 HTTP/TLS 回归覆盖两个主机、两种创建路径、尾斜杠、SSE Accept、列表查询、隐私及未调用网关。首次回归揭示列表路径仍出站并返回 403，修正后通过。

本节新增防护已完成 Mac ARM 候选构建，尚未安装或实机验证；本机仍为上一节主程序摘要对应的路由修复包。新候选主程序 SHA256 为 `8508aed9c595adb5e24bc89297faef0825c03e1c0b5501d576c5c9353f56b63e`，内置 Node 的受限 PATH 探测通过。磁盘一度只剩约 1.5 GiB，已对未打开的旧实验 VM 镜像做无损稀疏化，完整 SHA256 前后一致，回收约 4.1 GiB，空间恢复至约 5.9 GiB 后完成构建。未删除用户数据或回退备份。构建后桌面仍连续超时，客户交付门槛见 [客户交付验收](2026-11-17-claude-customer-readiness.md)。
