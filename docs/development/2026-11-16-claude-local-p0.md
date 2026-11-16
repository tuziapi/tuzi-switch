# CL-LOCAL-P0：B 方案首版实现与验证

本轮按用户选择实施“嵌入核心，复用兔子网关”。已完成可编译的 P0 接入、真实本机三段 HTTP 合成链路和 Claude profile 隔离启动检查。**完整 P0 验收仍未完成**：信任证书后的真实客户端登录、真实模型聊天与 Code 任务，以及联合分发的许可处理仍待确认。

## 工作区与边界

- 分支：`codex/claude-local-p0`；基线 `6a7df853`。
- 独立工作区：`/Users/sdy09/Documents/ChatGPT/tuzi-claude-local-p0`。未修改“完善桌面端自动更新”工作区。
- 核心来源：ClaudeMom `ec627dbdc2e94ce1dbf5ccae8fc1018d903ac6fa`，`claude-local 0.1.3`。
- 只做本地开发、测试和本地实验包；无 push、PR、发布、系统证书安装或付费模型调用。
- 普通构建默认关闭核心。P0 特性强制隔离兔子数据；实验包使用 `com.tuziswitch.desktop.claude-local-p0`，不会自动导入正式版的供应商或凭证。

## 已实现

| 模块 | 行为 |
|---|---|
| Claude 配置入口 | 实验面板：准备资源、信任证书、启动、停止/恢复、移除信任；中英日文案齐全 |
| 网关接入 | 核心 → 专用令牌与路径 → 兔子原有适配器 → 指定上游 |
| 绑定 | 固定供应商、凭证、模型映射快照；供应商编辑或切换不会使运行中的会话漂移 |
| 模型映射 | 复用既有 route；Direct 仅在内存克隆上补明确模型映射；未知模型拒绝，不默认宣称 1M |
| 隔离 | 独立 Desktop / Code 目录；不共享、导入、合并个人会话；禁止符号链接配置写入 |
| 生命周期 | 操作锁、跨进程目录锁、启动意图记录、失败后显式恢复；正常停止不强杀用户任务 |
| 共享网关 | 活跃会话阻止关闭/改配置；释放绑定后网关继续运行；旧令牌失效 |
| 更新与退出 | 原生重启前检查；普通退出被活跃会话阻止；P0 包禁止自动安装更新 |
| 传输与统计 | 复用流式、转换及取消链路；Claude Desktop 转换响应的消费归属修正为自身应用类型 |

![已接入的运行状态面板，合成数据](attachments/claude-local-p0/running.png)

上图使用真实组件与模拟 IPC，展示已绑定 A 后把页面供应商改为 B，当前会话仍提示绑定 A。它是界面测试，不是实际登录成功截图。

## 操作流程

1. 构建/打开独立 P0 包，在 Claude Desktop 中手动配置测试 API 供应商，填好模型映射或明确的默认模型。
2. 点“准备资源”，只写实验目录并生成本地 CA；点击“信任本地证书”才会请求系统授权。
3. 关闭所有 Claude 窗口并退出 Claude，点击“启动兼容模式”。仅允许 macOS / Claude 2.26454.0，Node.js 需支持 fetch 和 WebSocket。
4. 停止前先正常退出 Claude，再点“停止 / 恢复”。既有会话与配置保留，网关不会随之停止。
5. 如有异常中断，重开实验包后先恢复。无需且不能自动沿用旧会话令牌。

## 新字段与兼容

没有新增供应商持久化字段或改变 Direct / Proxy 枚举。未知上游上下文窗口不显式声明；核心仍有 200k 协议默认值，因此长上下文兼容性需要单独实测。P0 固定关闭高级能力，未把上游默认 `ultra` 当成产品权益。

自有 `session.json` 的 `schemaVersion=1`，含 `phase`（starting/running）、`providerId`、`providerName`、`claudeVersion`；无凭证。缺文件表示未运行；文件残留或不可解析且无核心进程表示需要恢复；停止成功后删除。配置根目录运行期间固定，修改兔子目录设置不能绕过旧会话检查。

IPC：`get_claude_local_status`、`claude_local_action`。未启用特性时状态仅返回 `enabled:false`，动作明确拒绝；不会初始化目录、核心或证书。启用时包含 `recoveryRequired`、`boundProvider`、`profileDir` 和核心状态。前端类型、禁用条件、中文/英文/日文提示及测试已补齐。

## 验证结果

环境：macOS arm64，Claude 2.26454.0，Node 24.14.0，pnpm 10.33.0，Rust 1.95。测试凭证均为合成值，数据库为内存库或专用测试 HOME。

| 验证 | 结果与范围 |
|---|---|
| 核心单测 | Rust 57 项与严格模型路由 JavaScript 1 项通过，含独立配置字段保留、拒绝符号链接、LaunchServices 参数与既有核心回归 |
| 原生定向测试 | `local_` 18 项通过，其中 3 项为本次 P0 测试；另有既有 Claude Desktop 配置 11 项通过 |
| 真实本机 HTTP 链路 | Node 核心 → 兔子网关 → Mock 上游；多轮、tool_use/tool_result、SSE、取消传播、未知模型、无效令牌、Origin 拒绝、错误不重试、绑定不漂移、令牌不泄漏上游、撤销旧令牌通过 |
| 网关生命周期 | 活跃会话下 stop / restore-stop / exit-stop / update_config 被拒绝，端口不变；释放后共享网关继续运行，通过 |
| 前端测试 | 5 文件共 23 项通过，含面板、受控重启、更新会话、更新提醒及既有供应商控件 |
| 浏览器 | Chromium 合成流程、恢复状态、供应商切换、620px 英文窄窗口检查通过；截图已目视检查 |
| 真客户端目录隔离 | 空白 profile 成功生成运行文件；检查范围内个人配置摘要一致；受管测试进程已退出，未安装 CA、无模型调用 |
| 编译 | 默认 / P0 原生检查及前端类型检查通过；两阶段 renderer 构建通过；macOS arm64 独立 Debug app 打包通过，bundle identifier 已核对 |

真客户端隔离证据见 [报告](attachments/claude-local-p0/isolation-report.json)。检测范围是 Claude/Claude-3p 的 `claude_desktop_config.json`、`configLibrary` 与 `~/.claude/settings.json`、`~/.claude.json`；不是对整个 HOME 或系统钥匙串的全盘证明。该探针使用拒绝连接的本机代理，验证目录启动，不证明登录、模型对话或 Code 执行。

关键实测发现：签名发行版会忽略 `CLAUDE_USER_DATA_DIR`，仅传环境变量的探针失败；增加 `--user-data-dir` 后通过。代码保留显式 `open --env` 传参，同时使用验证过的目录参数。没有修改 Claude 安装包或签名，也没有伪造开发测试授权。

## 复现与交付

```sh
# 使用 Rust 1.95；构建产物只留在本工作区，不安装或发布
scripts/build-claude-local-p0.sh

# 原生合成验证，指定全新的测试 HOME
CC_SWITCH_TEST_HOME=/tmp/tuzi-p0-test-home cargo test --manifest-path src-tauri/Cargo.toml --features claude-local-poc --lib local_ -- --test-threads=1

# 仅当本机 Claude 已退出时，显式执行空白目录探针
python3 scripts/qa/claude-local-isolation.py --run
```

实验包：`src-tauri/target/debug/bundle/macos/兔子助手 Claude P0.app`，独立本地 macOS arm64 Debug 包，未安装到 Applications、未启动真实模型会话。可执行文件 SHA-256：`69601e0e57c524826d82eda7e8e4beaf66428d93d3f6a75f83221abd140773b9`。入口代码见 `src-tauri/src/claude_local_integration.rs`、`src-tauri/src/proxy/local_session.rs`、`src/components/proxy/ClaudeLocalPanel.tsx`。上游来源及补丁见 [TUZI-PATCHES](../../src-tauri/vendor/claude-local/TUZI-PATCHES.md)，决策见 [ADR-022](decisions/0022-claude-local-p0.md)。

## 未完成与下一步

1. 在用户确认本地 CA 信任后，选择测试供应商完成真实登录、文本多轮、Code 文件任务、退出/恢复、中文显示验收；实际模型请求会使用测试供应商配额。
2. 继续验证 CONNECT/TLS 边界。专用网关令牌不等于整个兼容代理都已具备逐请求认证；当前仍不适合正式默认开放。
3. 语音、电脑控制、Cowork、后台模式、Windows、内置 Node 发行和完整更新事务留在后续阶段。
4. 确认上游 AGPL 核心的联合分发处理后，才讨论默认开启、合入发行分支与发布。

本地回退：正常退出 Claude，停止兼容会话，按需移除其 CA 信任，退出实验包。专用 profile 保留供恢复；正式版数据与原更新工作区不需要回滚。不要在会话活动中删除目录或切换回无此功能的构建。
