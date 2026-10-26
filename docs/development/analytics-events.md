# ANALYTICS-02：第一期操作统计

2026-10-26 用户确认聊天中的第一期方案后实施。基于远程 main `1a32301`（v1.4.2）及基础脚本提交 `c699711`，本地分支 `codex/umami-operation-events`。只改客户端；账户接口契约仍为 `system-token-v1`，不修改 API、依赖、凭证存储或工具配置协议，不推送或发布。

用户已确认 ANALYTICS-01 基础访问上报成功；下方新增操作事件的合成测试、桌面启动与真实后台入库分开记录。

## 事件字典

事件名称已按用户要求改为中文（2026-10-26）；英文模块和操作字段保持稳定。历史英文事件保留，不自动迁移，也不双发中英文事件。同一个操作事件的 `stage=submit` 表示真正提交业务调用，`stage=result` 表示结果；导航/打开入口/选择工具使用 `stage=interaction`。必带 `version`、`environment`、`module`、`action`、`stage`，仅部分事件带固定枚举的 `tool`、`page`。

| 事件模块 | 操作后缀 | 实际接入位置 |
| --- | --- | --- |
| `navigation` | `view` | App 当前页面/工具与设置页签；首次进入和实际切换，排除重复渲染/StrictMode effect 重放 |
| `account` | `get_token`, `connect`, `check`, `disconnect` | 获取令牌页面、账户连接、主动检查、断开；不跟踪启动读取或账户状态订阅 |
| `keys` | `create`, `edit`, `enable`, `disable`, `delete`, `reveal`, `copy` | 密钥页写入、查看完整密钥和复制；不跟踪搜索、列表刷新或详情查询 |
| `configure_tool` | `open`, `select_tool`, `save` | 账户密钥配置入口、选择目标工具、最终添加表单的原生预检与保存事务 |
| `providers` | `add`, `edit`, `duplicate`, `delete`, `switch` | 七工具 UI 的配置写入；复制单独分类，不重复记为添加；托盘/原生自动切换不计 |
| `skills` | `install`, `import`, `uninstall`, `restore` | 发现页安装、ZIP 安装、从应用导入、卸载和技能备份恢复 |
| `mcp` | `add`, `edit`, `import`, `delete`, `enable`, `disable` | 统一 MCP 管理的提交；启停带目标工具 |
| `prompts` | `add`, `edit`, `delete`, `enable`, `disable`, `import` | 提示词管理的提交；仅操作分类，不上传正文 |
| `proxy` | `start`, `stop`, `failover_enable`, `failover_disable` | 用户通过界面启动/停止代理或切换故障转移；排除状态轮询 |
| `config` | `import`, `export`, `backup`, `restore`, `sync_upload`, `sync_download` | 配置导入导出、手动备份/恢复、手动 WebDAV 上传/下载；排除定时同步 |

会话、工作区、Hermes 记忆和 OpenClaw 专属页面仅统计导航。隐藏账户页面无新增操作事件。工具仅接受现有七个固定 AppId；页面仅接受源码中的固定页面/设置页签标识。打开弹窗、取消文件选择、未通过前端校验不算提交；导出在确认保存路径后才计数，供应商在实际写入调用时计数。

## 中文事件名称对应表

历史英文名称用于对照旧记录；更新后的客户端仅上报右侧中文事件名。`stage`、`outcome`、`environment` 等属性及其枚举值保持不变。

| 历史英文名称 | 新中文名称 |
| --- | --- |
| `navigation_view` | 页面访问 |
| `account_get_token` | 获取账户令牌 |
| `account_connect` | 连接兔子账户 |
| `account_check` | 检查账户连接 |
| `account_disconnect` | 断开兔子账户 |
| `keys_create` | 创建密钥 |
| `keys_edit` | 编辑密钥 |
| `keys_enable` | 启用密钥 |
| `keys_disable` | 停用密钥 |
| `keys_delete` | 删除密钥 |
| `keys_reveal` | 查看密钥 |
| `keys_copy` | 复制密钥 |
| `configure_tool_open` | 打开配置到工具 |
| `configure_tool_select_tool` | 选择配置目标工具 |
| `configure_tool_save` | 保存密钥到工具 |
| `providers_add` | 添加供应商 |
| `providers_edit` | 编辑供应商 |
| `providers_duplicate` | 复制供应商 |
| `providers_delete` | 删除供应商 |
| `providers_switch` | 切换供应商 |
| `skills_install` | 安装技能 |
| `skills_import` | 导入技能 |
| `skills_uninstall` | 卸载技能 |
| `skills_restore` | 恢复技能备份 |
| `mcp_add` | 添加 MCP 服务 |
| `mcp_edit` | 编辑 MCP 服务 |
| `mcp_import` | 导入 MCP 服务 |
| `mcp_delete` | 删除 MCP 服务 |
| `mcp_enable` | 启用 MCP 服务 |
| `mcp_disable` | 停用 MCP 服务 |
| `prompts_add` | 添加提示词 |
| `prompts_edit` | 编辑提示词 |
| `prompts_delete` | 删除提示词 |
| `prompts_enable` | 启用提示词 |
| `prompts_disable` | 停用提示词 |
| `prompts_import` | 导入提示词 |
| `proxy_start` | 启动本地代理 |
| `proxy_stop` | 停止本地代理 |
| `proxy_failover_enable` | 开启故障转移 |
| `proxy_failover_disable` | 关闭故障转移 |
| `config_import` | 导入配置 |
| `config_export` | 导出配置 |
| `config_backup` | 创建配置备份 |
| `config_restore` | 恢复配置备份 |
| `config_sync_upload` | 上传 WebDAV 同步 |
| `config_sync_download` | 下载 WebDAV 同步 |

## 结果口径与隐私边界

- `outcome=success|failure|unknown|partial`：已知成功、已知失败、结果未知、部分成功。密钥写入 `outcomeUnknown` 保留为 unknown；账户返回 invalid 等非成功状态即使 Promise resolve 也不记成功；配置导入成功但 live 同步失败记 partial。
- 失败分类 `error_category=network|permission|validation|local_write|other` 只映射结构化错误码。普通原生字符串错误归 other，不解析或上传原始消息，不假称精确故障诊断。
- 不收集用户/账户/密钥/供应商 ID、用户名、密钥/令牌内容、余额、搜索词、名称、URL、路径、模型名称、提示词、会话、配置对象、原始异常。统一出口在运行时只逐字段构造允许的数据，非法 tool/page 值丢弃，非法模块/操作组合不发送。
- `environment=development` 用于 Vite dev 或 Tauri `TAURI_ENV_DEBUG=true` 构建，其余为 production；它是构建标记，不是部署证明。独立 `pnpm build:renderer` 的默认产物属于 production。
- 仅调用已有 `window.umami.track`。未加载脚本时丢弃事件，无本地缓存/补报；同步异常、Promise rejection 不影响业务，也不等待统计网络响应。每次操作的完成回调只发送一次结果。
- 进程关闭、离线或被拦截可能丢事件；提交数减成功数不等于失败数。安装/导入批量操作按一次提交计数，不按项目数量计数。配置成功表示本地保存成功，不代表已发起模型请求或模型调用成功。

## 在 Umami 中查看

选择原网站项目的事件列表，查看例如“页面访问”“切换供应商”“保存密钥到工具”。正式使用分析先筛选 `environment=production`，测试时选 development；导航按 `page`/`tool` 分组。

同一个操作会产生 submit/result 两条事件，因此不能直接把总事件数当操作次数。尝试次数筛选 `stage=submit`；成功次数筛选 `stage=result` 且 `outcome=success`；失败/未知/部分成功分别查看。成功率应注明所选时间范围及丢报限制。

## 验证记录

2026-10-26 后续：用户已确认英文操作事件在后台可见。按其要求将46个事件名改为中文，保留原始分类字段；`pnpm test:unit --run tests/analytics` 11项通过，`pnpm typecheck`、Prettier、diff 检查通过，下面的 macOS debug 构建命令再次通过。未重新执行不受影响的业务回归；中文事件后台入库尚待重启测试包后核对。

macOS 本机：

- `pnpm typecheck` 通过。
- `pnpm test:unit --run tests/analytics tests/account tests/hooks/useProviderActions.test.tsx tests/hooks/useProxyStatus.test.tsx tests/hooks/useImportExport.test.tsx tests/hooks/useImportExport.extra.test.tsx tests/hooks/useImportSkillsFromApps.test.tsx tests/components/AccountPage.test.tsx tests/components/TuziProviderDialog.test.tsx tests/components/UnifiedSkillsPanel.test.tsx tests/components/McpFormModal.test.tsx tests/integration/App.test.tsx`：18 文件、214 项通过。其中新增统计测试9项，随后补充取消导出/代理查询回归，`pnpm test:unit --run tests/analytics` 最终11项通过（总计216个不同用例）。
- 新增测试验证白名单、原始错误/业务字段排除、统计异常/挂起不阻塞业务、返回值/异常保持、完成去重、StrictMode 导航去重、账户 resolve 非成功状态、密钥未知写入、MCP 新增/编辑、复制配置只计一次且统计字段不写入原生配置、取消导出无事件、后台查询无事件。测试均使用合成值和模拟原生响应，不伪称真实服务端业务联调。
- `pnpm build:renderer` 通过。`pnpm tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'` 通过，生成 `src-tauri/target/debug/bundle/macos/兔子助手.app` 并启动。第一次未覆盖 updater 设置时已生成 app，但因缺少更新签名私钥命令失败；随后仅通过命令行关闭此次本地包的 updater 产物生成，重跑成功，仓库发布配置不变。
- 改动源文件 Prettier 与 `git diff --check` 通过。构建保留既有浏览器数据库过期、混合动态导入、包体积与 Rust dead_code 警告。
- 桌面自动化读取新窗口出现应用标识冲突/超时；本轮未确认新增事件的真实网络响应或 Umami 后台入库，未代操作真实凭证/删除用户数据/付费调用。Windows/Linux 未验证。可在已打开的本地包切换工具/页面后，通过开发者工具 Network 与 Umami“页面访问”核对。

回退：revert 本任务提交即可移除自定义事件，保留此前基础访问脚本。技术选择见 [ADR-015](decisions/0015-operation-analytics.md)。
