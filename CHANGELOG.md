# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-09-21

### Features

- 新增 Codex 安全票据一键导入、导入确认和受管凭据持久化流程。
- 新增 Codex 图片渲染兼容模式、专用图片代理、本地渲染兜底 Skill 与子代理并发设置。
- 完善 Codex 供应商配置编辑、端点管理、会话历史统一和多线路工作流。

### Fixes

- 修复 Codex 线路切换可能继续使用旧令牌的问题；旧版供应商会迁移到独立 `env_key`，并保留官方 OAuth 登录状态。
- 修复代理接管热切换绕过凭据迁移、多个旧供应商共享 `OPENAI_API_KEY` 以及模型配置重复导致 TOML 解析失败的问题。
- 修复 Codex 图片结果展示、票据导入启用状态、配置编辑内容和模型字段注入等问题。

### Documentation

- 补充 Codex 图片渲染兼容、供应商配置迁移和人工验证文档。

## [1.2.1] - 2026-07-24

### Fixes

- 基于已核验的最新 `main` 重新发布补丁版本，确保安装包与当前主分支代码一致。

## [1.2.0] - 2026-07-14

### Features

- 新增 Codex 应用增强设置：保留官方登录材料，并将官方与第三方供应商的会话历史统一到受管共享桶。
- 新增 Codex JSONL 与 `state_5.sqlite` 历史迁移、备份账本和关闭开关后的精确恢复能力。

### Fixes

- 修复 Codex 历史迁移默认值、官方桶识别、受管路由刷新及共享桶残留问题，避免升级或关闭统一历史后会话归属异常。
- 收紧 Codex、Claude、Gemini 等供应商配置清理边界，并适配 Codex agent 最新凭据配置方式。
- 将 Claude 兔子线路默认域名迁移到 `https://apius.tu-zi.com`，仅更新仍使用旧默认值的历史配置。
- 修复 Linux `.deb` 包名由中文产品名生成时不符合 Debian 规范、导致安装失败的问题 (by @AiW520)。

### Documentation

- 补充 Codex 会话历史统一、供应商配置迁移与 Linux 安装包修复的交接文档、用户手册和人工验证说明。

## [1.1.31] - 2026-06-23

### Fixes

- 修复 `codex订阅` 在多端点测速后仍共用同一条 Codex route，导致打开 Codex 时可能错误进入 ChatGPT 登录界面的问题。
- 修复第三方 Codex provider 在保存、导入与种子重建时可能保留错误 OAuth 标记的问题，统一改为独立 API Key 路径。
- 修复 Codex 供应商编辑时环境变量自动改名后未随保存链路落盘的问题，并允许供应商名称重复以兼容多线路配置。

## [1.1.28] - 2026-06-13

### Fixes

- 修复自动更新检查在 Tauri updater 卡住或返回空结果时无法提示新版本的问题。
- 修复原生更新安装后重启流程可能被退出保护拦截，导致应用卡住的问题。
- 修复 Windows 更新清单优先选择未压缩 MSI，可能导致签名更新包不可用的问题。

## [1.1.27] - 2026-06-11

### Fixes

- 修复编辑单个 Codex 官方供应商 API Key 后，多个供应商可能共享同一个 API Key 的严重串号问题。
- 修复 Codex provider backfill 时可能丢失 `[profiles.*]` override，导致供应商历史配置恢复不完整的问题。

### Documentation

- 新增 Codex 供应商 API Key 串号事故复盘，明确 env-first 凭据隔离原则与多 Key 能力边界。

## [1.1.26] - 2026-06-10

### Improvements

- 为 Codex 订阅供应商新增 `https://coding.opentu.ai` 和 `https://coding.sydney-ai.com` 两个 API 请求地址候选，并复用同组充值与查询入口。

### Documentation

- 更新 Codex 供应商端点管理经验文档，补充新增候选端点的验证要点。

## [1.1.25] - 2026-06-09

### Fixes

- 修复 Codex 供应商卡片已显示 API Key，但进入编辑页后 API Key 输入框为空的问题。

### Documentation

- 补充 Codex env-first 凭据来源与编辑表单初始化的复盘经验。

## [1.1.16] - 2026-06-08

### Fixes

- 发布验证版本，用于确认 GitHub release fallback 更新检测链路可发现后续新版本。

## [1.1.15] - 2026-06-08

### Fixes

- 在 Tauri updater 清单缺失时降级读取 GitHub latest release，避免启动和手动检查完全发现不了新版本。
- 对无签名清单场景使用手动下载更新流程，避免误触发不可用的自动安装重启。

## [1.1.14] - 2026-06-07

### Fixes

- 修复发布流程在缺少可选签名密钥时阻断安装包构建的问题。
- 修复 Windows 打包时中文产品名可能导致安装器构建失败的问题。
- 将 Release 创建延后到安装包构建完成后，避免前置 Release 状态异常阻断多平台构建。

## [1.1.13] - 2026-06-07

### Fixes

- 修复原生更新清单不可用时会阻断界面热更新检查的问题。
- 强化发布流程校验，避免缺少签名密钥或 updater 签名产物时发布无法自动更新的版本。

### Improvements

- 将用户可见应用名称更新为「兔子switch」，覆盖安装包名称、窗口标题、关于页、提示文案与发布说明。

## [1.1.11] - 2026-06-07

### Features

- Integrated Codex endpoint management and speed testing directly into the provider add/edit form.
- Added dual URL candidates for the Codex subscription provider and automatic fastest endpoint selection.
- Displayed the active API URL on provider cards with a compact key and API badge layout.

### Fixes

- Preserved Codex subscription endpoint candidates when editing existing providers.
- Removed duplicate API URL inputs and redundant inline endpoint save action.
- Removed Codex `env_key` when writing experimental bearer token config to avoid missing environment variable crashes.

### Documentation

- Documented Codex endpoint management UI design lessons and verification points.

## [1.1.10] - 2026-06-07

### Fixes

- Replaced the GitHub Release publish API call with `gh release edit --latest`.

## [1.1.9] - 2026-06-07

### Fixes

- Allowed GitHub Releases to publish installer assets even when updater signing secrets are not configured.
- Skipped updater manifest generation when signed updater artifacts are unavailable.

## [1.1.8] - 2026-06-07

### Fixes

- Treated the Tauri signing key password as optional in release secret validation.

## [1.1.7] - 2026-06-07

### Fixes

- Fixed GitHub Actions workflow validation by avoiding job-level `secrets` expressions.
- Kept Web hot update publishing optional without blocking the native release workflow.

## [1.1.6] - 2026-06-07

### Fixes

- Fixed release workflow signing environment variables for Tauri updater artifacts.
- Added early release secret validation so failed releases report missing signing secrets clearly.
- Made frontend hot update publishing optional when the minisign private key is not configured.

## [1.1.5] - 2026-06-07

### Features

- Added Tauri official updater release flow with signed updater artifacts.
- Added signed frontend hot update flow for Vite/React assets.
- Added Capability Facade v1 for stable native capability discovery and invocation.

### Security

- Removed App-side remote install script execution from the automatic update path.
- Added sha256 and minisign verification before enabling frontend hot update assets.
- Restricted hot-updated frontend terminal command capability to declared safe commands.

### Documentation

- Documented the automatic update, frontend hot update, and capability-layer design.
- Updated README installation and update mechanism notes.

## [1.1.4] - 2025-xx-xx

### Bug Fixes

- Fixed API Key not being recognized for OpenCode provider
- Fixed Codex CLI 0.134.0+ compatibility issue (deprecated `profile = "xxx"` configuration)
- Fixed multi-provider configuration conflict in Codex module
- Fixed Codex provider switch and API Key display inconsistency (provider list vs card display)
- Fixed legacy Codex provider API Key detection (support old config formats with env_key at top-level or in profiles section)

### Improvements

- Updated Codex configuration handling to support new `model_provider` format
- Added automatic migration for legacy Codex profile configuration
- Improved API Key detection logic for OpenCode applications

### Technical Changes

- Updated React Query usage in ProviderList component
- Fixed TypeScript type errors in provider configuration utilities
- Removed unused imports and dead code

## [1.1.3] - 2025-xx-xx

### Bug Fixes

- Various minor bug fixes and improvements

## [1.1.2] - 2025-xx-xx

### Features

- Initial public release
- Support for Claude Code, Codex, and Gemini CLI
- Multi-provider management
- API Key configuration
- Code editor integration
