# Tuzi 跟随 CC 正式版本维护说明

Tuzi 采用“CC 主线 + Tuzi 产品扩展层”的维护方式，当前基线记录在根目录的
`upstream-base.json`。

相关文档：

- 实施进度：[`tuzi-switch基于ccswitch整合新版本实施进度.md`](./tuzi-switch基于ccswitch整合新版本实施进度.md)
- QA 报告：[`tuzi-switch基于ccswitch整合新版本QA报告.md`](./tuzi-switch基于ccswitch整合新版本QA报告.md)
- Codex 统一会话历史：[`guides/codex-unified-session-history-guide-zh.md`](./guides/codex-unified-session-history-guide-zh.md)
- Codex 官方认证保留：[`guides/codex-official-auth-preservation-guide-zh.md`](./guides/codex-official-auth-preservation-guide-zh.md)

> 本工作流随当前 PR 提交到 Tuzi `develop`。合并前远端自动同步不会启用；GitHub 定时工作流只从
> 仓库默认分支加载，若默认分支仍为 `main`，还需将工作流同步到 `main` 或把 `develop` 设为默认分支。

`.github/workflows/sync-cc-upstream.yml` 每小时检查 CC Switch 最新正式 Release，也支持手动触发。流程会：

1. 通过 GitHub Release API 获取 CC 最新正式 tag，拉取该 tag 对应的完整源码；
2. 从 Tuzi `develop` 创建 `sync/cc-release-<version>` 分支并合并上游；
3. 更新上游基线元数据并检查 Tuzi 品牌、预设、会话、认证、热更新等不变量；
4. 通过 `ci.yml` 的 `workflow_call` 直接复用项目 CI，校验指定同步分支；
5. 全部通过后创建同步 PR，由 GitHub Auto-merge 完成合并；
6. 合并完成后自动创建 `v<CC版本>-tuzi.1` tag，调用 `tuzi-release.yml`
   重新构建 macOS、Windows、Linux 的完整原生安装包与 updater 清单。

本地可运行 `pnpm check:tuzi` 执行同一套 Tuzi 产品契约门禁。

同步分支在 PR 创建前先完成同一套 CI；创建 PR 后仍保留仓库原有 PR 检查，作为分支保护
门禁。未修改 CC 原有检查项目。

如果 CC 提升基础版本，流程会把 Tuzi 的三个应用版本入口统一调整为相同基础版本，并
同步记录正式 Release tag、Release commit 和已整合的上游 commit。当前首次整合曾包含
Release 后的 CC 修复，因此两个 commit 可能不同；后续自动同步只接受包含既有上游基线的
线性正式版本，否则停止并要求人工审查。`upstream-base.json` 提供精确的 Tuzi/CC 代码映射。

发生冲突时，流程会列出冲突文件并停止。维护者应在对应同步分支解决冲突，重点确认
Tuzi 产品扩展仍为增量实现，不要用旧 Tuzi 文件整体覆盖新版 CC 文件。合并同步 PR 前，
还应人工检查 CC 新增配置字段、迁移逻辑和更新机制是否被保留。

同步阶段使用仓库自带的 `GITHUB_TOKEN`。仓库设置中需允许 GitHub Actions
创建 Pull Request 并启用 Auto-merge；分支保护必须要求 CI 通过后才允许合并。发布阶段继续使用
GitHub `release` Environment 中的 updater 签名、Apple 签名和公证凭据。

客户端同时具备两条更新链路：

- **原生自动更新**：下载签名的 App/MSI/AppImage updater 产物，安装后自动重启；用于 Rust、Tauri、数据库迁移等完整版本升级。
- **界面热更新**：下载签名的前端资源包，下次重启时加载；资源包必须满足原生版本、能力清单和 Tuzi 功能契约。

界面热更新不会覆盖 Rust 二进制；涉及原生能力、数据库或权限的 CC 更新必须走完整原生更新。

### Tuzi 功能保护

CC 同步只用于更新上游底座，不得改变 Tuzi 产品层。`tuzi-protected-paths.txt` 列出了
Tuzi 专属预设、品牌常量、热更新、图标和发布工程等受保护路径。合并 CC Release 后，
工作流会先从 Tuzi `develop` 逐字节恢复这些专属路径，然后才执行版本更新和全量门禁。

保护清单自身也从合并前的 Tuzi `develop` 读取并恢复，CC 变更不能弱化保护边界。
macOS/Windows 标识及其他共享文件不整份冻结，以便接收 CC 新能力；其中的 Tuzi 行为由产品不变量、
Provider 预设与六线路测试、官方认证保留测试、Codex 会话
迁移/还原测试、项目切换入口禁用检查、热更新契约检查与全套 CI 共同保护。任一门禁失败时都不会
合并、打 tag 或发布。

若前一个同步 PR 尚未合并，而 CC 又发布新版本，流程会删除旧同步分支，使旧 PR 自动关闭，
再从最新 Tuzi `develop` 创建新的 `sync/cc-release-<version>`，避免多个过期同步 PR 并存。

同一 CC SHA 的远端同步分支不会被强制覆盖；维护者在该分支上的冲突修复会被保留。

## 每次 CC 更新的 QA 门禁

自动同步必须通过以下门禁，任一失败都不得合并、打 tag 或发布：

| 门禁           | 验收内容                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 上游基线       | 只接收最新正式 Release；新 Release 必须包含已整合的 CC commit，非线性历史转人工处理              |
| Tuzi 产品契约  | 品牌、数据目录、深链接、更新地址、图标、预设、生图请求头和 `tuziswitch` 会话桶保持不变           |
| Codex 数据安全 | 官方认证保留、统一会话、既有会话迁移、`archived_sessions`、SQLite 路径和账本精确恢复通过定向测试 |
| Provider 数据  | 兔子 Codex 六线路全部存在；只补缺失端点，不覆盖密钥、模型、排序和用户自定义端点                  |
| 界面行为       | 主界面、通用设置和托盘不得重新出现项目切换入口；Web 热更新包必须包含 Tuzi 功能契约               |
| 原生更新       | macOS updater、Windows MSI、Linux AppImage 及各自签名必须齐全，缺任一产物即失败                  |
| 发布提交       | tag 必须指向刚通过 CI 的同步 PR 合并提交，不得捎带等待期间进入 `develop` 的其他提交              |
| 静态检查       | TypeScript、Rust、单元测试、Prettier、YAML 和 `git diff --check` 全部通过                        |

本地最小验收命令：

```bash
pnpm check:tuzi
pnpm exec vitest run src/config/tuziProviderPresets.test.ts tests/lib/updater.test.ts
cargo test --manifest-path src-tauri/Cargo.toml codex_history_migration --lib
cargo test --manifest-path src-tauri/Cargo.toml third_party_switch_ --lib
cargo test --manifest-path src-tauri/Cargo.toml official_switch_only_writes_auth_with_login_material --lib
cargo test --manifest-path src-tauri/Cargo.toml web_hot_update --lib
cargo fmt --check --manifest-path src-tauri/Cargo.toml
git diff --check
```

完整 CI 仍需在同步 PR 上执行，不以本地最小验收代替跨平台检查。

> 主界面、通用设置和托盘的项目切换入口均已移除，并由 Tuzi 产品契约防止后续同步回归。

## Tuzi 发布前置条件

`tuzi-release.yml` 只接受 `v<CC版本>-tuzi.<修订号>` 格式的 tag，且 tag 必须与
`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 版本完全一致。

GitHub `release` Environment 需配置：

- `TAURI_SIGNING_PRIVATE_KEY`：必需，必须与 Tauri 配置中的 updater 公钥成对。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥有密码时必需。
- `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`：macOS 签名必需。
- `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`：macOS 公证必需。
- `WEB_UPDATE_MINISIGN_PRIVATE_KEY`：可选；配置后发布签名 Web 热更资源。
- `GEMINI_OAUTH_CLIENT_ID`、`GEMINI_OAUTH_CLIENT_SECRET`：正式构建的 Gemini OAuth
  access token 刷新能力；只通过构建环境注入，不写入源码。

正式发布不允许在 updater 私钥或 Apple 签名/公证凭据缺失时降级为无签名产物。
macOS updater 压缩包、Windows MSI、Linux AppImage 及其签名任一缺失时，发布流程直接失败，
不会生成一个客户端无法自动安装的“伪成功”版本。
同步流程只给刚通过 CI 的 PR 合并提交打 tag，并显式触发原生发布工作流；期间 `develop` 的其他
提交不会被误带入本次版本。
本地开发打包不受此限制。

远端启用前还必须确认：

1. 工作流已经合并到 `develop`，并同步到仓库默认分支，或已将 `develop` 设为默认分支；
2. GitHub Actions 允许创建 Pull Request，且工作流令牌具备 `actions: write`；
3. 仓库已启用 Auto-merge，分支保护要求 CI 通过；
4. `release` Environment 的 updater、Apple 签名、公证和 Web 热更新密钥可用；
5. 首次手动触发同步后，确认 PR、合并 commit、tag、原生 Release 和更新清单形成完整闭环。

发布顺序：

1. 运行 `pnpm run version:tuzi:dry-run` 确认下一版本。
2. 运行 `pnpm run version:tuzi` 或显式传入修订号，并完成 CI。
3. 创建与代码版本一致的 tag，推送后触发发布。
4. 确认 macOS、Windows、Linux 产物齐全，`latest.json` 包含全部已签名平台。
5. 在 macOS 上执行 `spctl --assess --type execute --verbose=4 <应用路径>` 验证 Gatekeeper。
