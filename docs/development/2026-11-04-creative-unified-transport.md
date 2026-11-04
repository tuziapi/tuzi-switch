# UC-TRANSPORT-01：统一模型适配与独立凭证获取

日期：2026-11-04（Asia/Shanghai）。用户已选择“统一模型适配流程，分开凭证获取”。

## 工作区与范围

- 基线：`4ee6a4014d24e55bb7e8a6fb4c8aaa9b135115aa`，来源 `codex/opentu-assistant-sync`。
- 独立工作区：`/Users/sdy09/.codex/worktrees/creative-unified-transport/tuzi-switch`，分支 `codex/creative-unified-transport`。
- 原主会话工作区及 `/Users/sdy09/Documents/tuzi-switch` 原有修改不写入、不切分支；本轮不替换正在运行的客户端。
- 仅客户端宿主请求/凭证桥接、测试与文档；创作适配器与 API 仓库没有改动，`system-token-v1` 不变。
- 无 push、PR、合并、发布、部署、真实账户数据访问或付费调用。

## 实现

两种来源共用 HTTP 请求序列化、原生构造及响应传递。账户来源改为原生获取所选本人模型 Key，然后发送原适配器请求；不再依赖 action 清单或模型目录接口标签，不再每次生成/轮询前获取目录。图片、视频、音乐、文本以及查询使用相同业务请求，账户来源保留凭证和目标地址边界。

字段、旧 IPC 兼容、凭证边界、模型命名空间、完整安装包交付要求及回退见 [ADR-018](decisions/0018-creative-shared-transport.md)。无新增持久化字段和迁移。

## 验证

环境：本机 macOS ARM64，独立 worktree；Node/pnpm 复用已安装版本，Rust 1.95。依赖和原生 target 使用 APFS 克隆到本工作区，没有在主会话目录运行构建或测试。

| 验证 | 结果 | 本机日志 |
| --- | --- | --- |
| `pnpm typecheck` | 通过 | `/tmp/creative-unified-typecheck-final.log` |
| `pnpm exec vitest run` | 94 文件 / 702 项通过 | `/tmp/creative-unified-host-final.log` |
| `pnpm test:creative` | 111 文件 / 1852 项通过 | `/tmp/creative-unified-creative-final.log` |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib tuzi_account -- --test-threads=1` | 63 通过，1 既有真实配对测试忽略 | `/tmp/creative-unified-account-final.log` |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib creative_http -- --test-threads=1` | 3 通过 | `/tmp/creative-unified-http-final.log` |
| `pnpm build:renderer`（含创作包构建） | 通过；最后目标地址规则调整后另跑 `pnpm exec vite build` 通过 | `/tmp/creative-unified-build.log`、`/tmp/creative-unified-renderer-final.log` |
| 改动 TS/JSON 的 Prettier、改动原生请求模块的 rustfmt、`git diff --check` | 通过 | 命令输出 |

原生新增 5 项测试：一项包含 18 组协议的账户/手动实际 HTTP 对照；其余验证未获准目标/错误归属/过期代次/禁用 Key、未知 IPC 字段、HTTP 403 错误体脱敏及重定向、凭证获取与生成等待期间断开。对照含 OpenAI 图片、multipart 原始二进制与文件名、OpenAI/Kling/MiniMax 视频、Suno 三种路径及轮询、Chat SSE、Responses、Messages、Gemini、MJ、Flux 与图片找回。生成和轮询期间没有 `/v1/models` 请求；显式模型获取另行验证。账户绑定文件不含合成系统令牌或模型 Key。

前端新增 24 项共享请求回归，配合原有 29 项桥接/取消/Channel 测试；包含 multipart 还原、业务查询参数、协议头与凭证占位剔除。未添加或更改创作模型适配器。

首次验证的失败没有计为通过：新工作区缺少创作包依赖和 dist 导致宿主全量首跑导入失败，补齐独立依赖并构建后全量复跑通过；测试环境 Node Request 与 jsdom AbortSignal/FormData 混用导致初跑失败，序列化 Request 不再接管信号（原生流仍全程处理取消），multipart 测试使用同一 Node Web API 环境后通过。Rust 首次因 PATH 不含 rustc/cargo 未执行，使用已安装工具链目录后完成上述验证。构建保留既有 Sass、Browserslist 及大 chunk 警告。

## 限制

本机合成 HTTP 验证覆盖真实 Rust 网络/流传输与隔离凭证，不是连接线上模型服务。没有进行真实视频/音乐付费生成、实际桌面 IPC 操作或 Windows/Linux 安装运行；没有构建发布安装包，也没有将本分支合入主会话。现有公开安装包不会自动获得本轮改动。
