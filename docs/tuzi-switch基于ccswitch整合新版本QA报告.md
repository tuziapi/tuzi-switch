# tuzi-switch 基于 ccswitch 整合新版本 QA 报告

## 验收范围

- 实施说明：[`tuzi-switch基于ccswitch整合新版本实施进度.md`](./tuzi-switch基于ccswitch整合新版本实施进度.md)
- 同步与发布维护说明：[`tuzi-upstream-sync.md`](./tuzi-upstream-sync.md)
- PR 分支：`codex/tuzi-next`
- 目标分支：`develop`
- Tuzi 版本：`3.17.0-tuzi.1`

> 当前代码和自动化通过 PR 交付到 `develop`。合并前远端不会执行新工作流；
> 定时同步还要求工作流存在于仓库默认分支。

## 实际验证结果

| 验证项                             |       结果 |
| ---------------------------------- | ---------: |
| `pnpm check:tuzi` 产品契约         |       通过 |
| Codex 会话迁移、备份与精确还原     | 26/26 通过 |
| Codex 官方认证保留                 |   3/3 通过 |
| 完整 `codex_config` 回归           | 67/67 通过 |
| Web 热更新安全与 Tuzi 契约         |   7/7 通过 |
| Tuzi Provider 预设与六线路前端测试 |   2/2 通过 |
| 六线路数据库种子与增量补齐         |   3/3 通过 |
| 原生更新 GitHub Release 兜底测试   |   2/2 通过 |
| 旧设置安全默认值                   |   1/1 通过 |
| TypeScript 类型检查                |       通过 |
| Rust 格式检查                      |       通过 |
| CI、同步、发布 YAML 解析           |       通过 |
| `git diff --check`                 |       通过 |
| Docs 与 QA 文档 Prettier           |       通过 |
| 前端 `src` Prettier（CI 范围）     |       通过 |
| 项目切换入口禁用契约               |       通过 |

功能整合阶段已通过前端生产构建，热更新契约标记齐全。本次文档拆分阶段未重跑
完整生产构建和 450 项前端全量回归。

## 此前累计回归

以下结果来自当前整合分支的前序阶段：

| 验证项                      |         结果 |
| --------------------------- | -----------: |
| Codex 历史迁移              |   26/26 通过 |
| SQLite 数据库迁移           |   15/15 通过 |
| 设置页与保存流程            |   14/14 通过 |
| Codex/数据库 Rust 核心回归  | 104/104 通过 |
| 前端完整测试套件            | 450/450 通过 |
| macOS arm64 应用与 DMG 打包 |         通过 |
| 旧 Tuzi 数据隔离副本启动    |         通过 |
| 版本升级与发布 tag dry-run  |         通过 |

## 会话与认证专项

- 覆盖官方 `openai`/`codex` 双桶、Tuzi `tuziswitch` 共享桶。
- 覆盖 JSONL 会话、`archived_sessions`、SQLite Home 路径、备份账本和精确恢复。
- 统一会话历史和官方认证保留在旧设置缺字段时默认开启，用户显式关闭仍被尊重。
- 官方认证结果针对普通第三方 Provider 切换，不代表真实 CLI 或代理接管端到端验收。

## 隔离数据验证

- 从真实 `~/.tuzi-switch` 只读复制数据库、设置和认证文件到系统临时目录。
- 使用 `CC_SWITCH_TEST_HOME` 启动新版本，未读写真实用户目录。
- 隔离数据库 `integrity_check = ok`。
- schema `user_version = 10`，启动前后保持一致。
- Provider 共 20 个，启动前后数量和应用分组保持一致。
- 未产生迁移错误日志。

## 构建产物验证

- macOS 应用：`兔子switch.app`
- macOS DMG：`兔子switch_3.17.0-tuzi.1_aarch64.dmg`
- Updater 包：`兔子switch.app.tar.gz`
- `CFBundleIdentifier = com.tuziswitch.desktop`
- `CFBundleShortVersionString = 3.17.0-tuzi.1`
- 深链接：`tuziswitch://`
- 应用内更新端点指向 `tuziapi/tuzi-switch`。

完整打包已生成应用、DMG 和 updater 压缩包；命令最终因本机缺少
`TAURI_SIGNING_PRIVATE_KEY` 返回失败。该失败发生在产物生成后，仅影响 updater 签名，
不是编译或打包失败。

## 已知阻断项

1. 自动同步和发布工作流未合并到远端 `develop`，合并前远端不会执行。
2. 仓库默认分支当前仍为 `main`；GitHub 定时工作流不会从非默认分支加载。
3. CC 上游完整底座自带多份未经 Prettier 格式化的历史文件；本 PR 改动文件已通过格式检查，未做无关全仓格式化。

## 发布环境待验收

1. 验证 GitHub Actions 创建 PR、`actions: write`、分支保护和 Auto-merge。
2. 手动触发首次 CC 同步，验证同步 PR、合并 commit、Tuzi tag、全平台 Release 与 updater 清单闭环。
3. 在 `release` Environment 验证 updater、Apple 签名、公证和 Web 热更新密钥。
4. 配置 `GEMINI_OAUTH_CLIENT_ID` 和 `GEMINI_OAUTH_CLIENT_SECRET`，验证过期 Gemini access token 可刷新。
5. 验证 Web 热更新真实 CDN、`release-web` 分支发布、签名校验和客户端加载。
6. 使用隔离账号验证 Tuzi 文本、图片生成、官方 Codex 与 Tuzi Codex 相互切换及真实会话恢复。
7. 在 Windows 验证安装、深链接、自动启动、旧数据目录和 ARM64 updater。
8. 使用 Apple Developer 身份完成 macOS 签名、公证和 Gatekeeper 验证。

## 本地最小回归命令

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

完整 CI 仍需在同步 PR 上执行，不以本地最小回归代替跨平台验收。
