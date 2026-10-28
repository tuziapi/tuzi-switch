# UI-05 新工具配置接入与聚合基础能力

2026-10-27。基于 `gaizhao` / `531e1709`，用户授权进入新增工具与聚合阶段；仅本地编码、合成验证和提交，无 push/PR/部署/发布、真实凭证或付费调用。API 仓库未修改，账户 system-token-v1 不变。设计、存储字段默认值与恢复边界见 [ADR-015](decisions/0015-native-tool-adapters-and-model-aggregation.md)。

## 实现与未完成范围

- 侧栏新增 Grok Build、Pi、MiniMax Code，Claude/Gemini 显示名称对齐 Claude Code/Gemini CLI。新入口连接真实原生命令，支持读取、添加、编辑、删除确认、刷新和上次修改恢复。Grok 另支持选择默认档案；Pi/MiniMax 的当前模型和登录继续由原工具管理。
- 原生供应商配置页使用工具原生字段 JSON 编辑器；模板含全部必要字段，保存前校验，不把空模板当作有效配置。API Key 不进入前端持久存储，原生配置与恢复备份使用私有文件权限。旧账户系统令牌路径不改。
- Claude Code/Codex 聚合支持显式默认供应商和模型名单、保留前缀精确分发、客户端目录发布及退出覆盖层恢复；不同应用分别配置。Gemini 不显示不支持的聚合入口。既有故障转移设置保留，聚合请求不使用队列。
- 聚合进入时要求先在卡片上启用默认供应商，且满足既有路由设置门禁。修改名单及供应商前须退出聚合。官方 OAuth 聚合、新工具 MCP/Skills/会话扩展、聚合高级子代理/审批设置及自动模型资料补全未完成。

## 分层验证

| 层级             | 结果与限制                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量前端         | 70文件、476测试通过；使用 `pnpm exec vitest run --maxWorkers=4 --minWorkers=1`，日志 `/tmp/tuzi-ui05-tests.log`。首次与编译并发时有一项5秒超时，独立重跑和降低并发后的全量通过，未放宽断言。                                        |
| 类型与 renderer  | `pnpm typecheck`、`pnpm build:renderer` 通过，日志 `/tmp/tuzi-ui05-typecheck.log`、`/tmp/tuzi-ui05-build.log`。                                                                                                                     |
| 原生全量         | `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`，1427通过、0失败、1项既有真实Go配对忽略；日志 `/tmp/tuzi-ui05-native-all.log`。                                                                |
| 新适配器文件测试 | 三工具写入、未知字段保留、恢复精确字节、外部修改拒绝覆盖、当前模型删除保护及Unix0600权限通过。                                                                                                                                      |
| 聚合             | 7项通过，涵盖本机HTTP模型/凭证分发、未知模型400且零额外上游请求、当前供应商不变/故障转移计数不变、模型发现、实际Claude接管进入退出恢复、Codex模型目录和注释/原目录恢复、外部冲突与名单校验。日志 `/tmp/tuzi-ui05-aggregation.log`。 |
| 桌面构建         | `bash scripts/build-local-preview.sh` 成功生成独立标识debug app，日志 `/tmp/tuzi-ui05-native-build.log`。不代表完成窗口人工或真实工具验收。                                                                                         |

Rust 实际安装于 `~/.rustup/toolchains/1.95-aarch64-apple-darwin/bin`，本轮显式加入 PATH；此前“本机缺少 Rust”的判断不准确，不再作为当前限制。既有构建体积/浏览器数据/动态导入提示，local-preview 未使用函数和测试MSW警告保留。

## 验收方式

合成预览继续使用 `http://127.0.0.1:5193/ui04.html`，已接入三个新入口及聚合表单；写入只改变内存合成数据，未知 IPC 拒绝。可在页面侧栏进入新工具，检查添加/编辑/删除/恢复和聚合名单。

独立原生预览包：`src-tauri/target/debug/bundle/macos/兔子助手.app`，应用标识 `com.tuziswitch.desktop.preview`。只使用隔离合成配置，预览账户指向原既定 localhost5180；不要求真实令牌，也不代发模型调用。

本轮已打开此包，进程及启动日志确认主窗口已显示；浏览器合成预览也已打开。首次隔离启动保留既有预设缺少 TUZI_CODEX_API_KEY 的提示，未覆盖有效配置；该提示不代表聚合或真实账户联调成功。

尚未完成浏览器截图矩阵、真实Grok/Pi/MiniMax运行、真实Claude/Codex模型选择器与流式工具调用、Windows/Linux以及用户验收。代码、自动化、原生构建、真实工具验收和发布分别记录，本轮不能宣称完整CC Switch功能对齐或上线完成。
