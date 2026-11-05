<div align="center">

# tuzi-switch

### 面向 Claude Code、Codex、Gemini 与 OpenClaw 的兔子业务桌面助手

[![版本](https://img.shields.io/github/v/release/tuziapi/tuzi-switch?color=0ea5e9&label=version)](https://github.com/tuziapi/tuzi-switch/releases)
[![下载量](https://img.shields.io/github/downloads/tuziapi/tuzi-switch/total?color=f97316)](https://github.com/tuziapi/tuzi-switch/releases)
[![平台](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-94a3b8)](https://github.com/tuziapi/tuzi-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-111827)](https://tauri.app/)

中文 | [English](README_EN.md) | [日本語](README_JA.md) | [Releases](https://github.com/tuziapi/tuzi-switch/releases)

</div>

## 下载

**[打开正式下载页](https://tuziapi.github.io/tuzi-switch/)** · [查看 v1.5.5 发布说明与全部安装包](https://github.com/tuziapi/tuzi-switch/releases/tag/v1.5.5)

当前正式版本为 **v1.5.5**，包含工具管理、兔子账户和 opentu 创作工作区。

| 平台 | 安装包 |
| --- | --- |
| macOS Apple 芯片 | `tuzi-assistant-macos-arm64.dmg` |
| macOS Intel | `tuzi-assistant-macos-x64.dmg` |
| Windows x64 | `.exe` 或 `.msi` |
| Linux x64 | `.AppImage`、`.deb` 或 `.rpm` |

### macOS 终端安装

先完全退出兔子助手，将下面整行命令粘贴到“终端”，按提示确认：

```bash
(s=$(curl -fsSL https://tuziapi.github.io/tuzi-switch/install.sh) && bash -c "$s")
```

指定版本：

```bash
(s=$(curl -fsSL https://tuziapi.github.io/tuzi-switch/install.sh) && bash -c "$s" -- --version v1.5.5)
```

- 目前两条命令均安装 **v1.5.5**；仅支持该版本，不能任意替换为旧版本。也兼容 `TUZI_SWITCH_TAG=v1.5.5`，显式 `--version` 优先。
- 仅适用于 macOS，自动识别 Apple 芯片 / Intel。Windows、Linux 请使用上方下载页。
- 校验安装器及 DMG 的 SHA-256、应用身份和包内签名完整性；替换前备份旧应用，保留账户和作品配置。
- 安装和放行分别需要确认，不需要 `sudo`。目标应用名为 **兔子助手.app**，安装目录以终端提示为准。
- 旧的 `scripts/install_tuzi_switch.sh` 入口尚未适配当前安装包，请勿继续使用旧教程中的命令。

### macOS 手动安装与首次打开

从正式下载页选择对应芯片的 DMG，退出旧版后，将“兔子助手”拖入“应用程序”并替换。

此版本未经 Apple 开发者签名或公证。若系统拦截，可使用上面的终端安装流程；核对来源并确认信任后，脚本仅移除兔子助手副本的下载隔离标记，不关闭系统全局安全检查。这不等于 Apple 签名或公证。

### 下载失败或速度慢

安装包仍从 GitHub Releases 下载；能获取脚本不代表安装包连接也畅通。

| 提示 | 原因与处理 |
| --- | --- |
| 下载 `tuzi-switch-macos-aarch64.dmg` 返回 404 | 使用了旧脚本和旧文件名，请改用上面的新命令。 |
| `mirror.ghproxy.com` SSL 错误 | 旧脚本的镜像回退失败；新入口不使用该镜像。 |
| `curl (28)` 或 `curl (16)` | 连接超时或 HTTP/2 传输失败，发生在下载阶段。可更换能稳定访问 GitHub 的网络后重试，或从正式下载页手动下载安装包。 |
| 下载进度缓慢 | 当前到 GitHub 的链路速度较低；更换脚本地址不会加速安装包。 |

当前脚本尚未加入 HTTP/1.1 回退和跨次断点续传。若在安装包下载阶段退出，原应用不会被替换；重跑会重新下载。本节是现有行为说明，不表示网络兼容问题已修复。

## tuzi-switch 是什么

tuzi-switch 是基于 CC Switch 定制的兔子业务版本。它保留了成熟的多工具桌面管理基础能力，同时把产品重点放在兔子客户更容易上手的接入流程上。

当前版本主要围绕 4 个入口展开：

- Claude Code
- Codex
- Gemini
- OpenClaw

用户只需要输入一次兔子 Key，就可以更快完成线路接入和本地配置，不需要自己手动改配置文件。

## 当前版本更新

当前正式版本为 **v1.5.5**：

- 工具管理、兔子账户四个页面与 opentu 创作整合到同一客户端。
- 安装包、下载页和版本说明统一使用正式仓库 `tuziapi/tuzi-switch`。
- 本次提供完整安装包和 Mac 终端安装；应用内自动更新暂不可用，详见 [发布说明](https://github.com/tuziapi/tuzi-switch/releases/tag/v1.5.5)。

### 历史更新：v1.2.0

以下为 v1.2.0 已有能力的记录：

### Codex 官方登录与会话历史统一

- **保留官方登录材料**：切换第三方供应商时保留 `auth.json` 中的 ChatGPT/OAuth 登录信息
- **统一会话历史**：官方与第三方 Codex 会话统一写入受管共享桶，切换线路后仍可连续查看历史
- **安全迁移与恢复**：迁移 JSONL 和 `state_5.sqlite` 历史，记录原始归属，关闭功能后精确恢复
- **升级兼容**：覆盖旧版缺省设置、官方桶差异和受管路由刷新，避免历史遗漏或共享桶残留

### Codex 新配置适配

- **适配 Codex 0.134+/0.135+**：保留 `model_provider`、`[model_providers.xxx]`、`env_key` 与 `wire_api = "responses"` 的兔子线路模型
- **第三方线路不覆盖登录态**：切换第三方 Codex Provider 时只写 `config.toml`，不覆盖用户 `auth.json` 中的 ChatGPT/OAuth 登录状态
- **Provider 级 Token 注入**：从现有 `env_key` 读取 API Key，写入对应 provider 的 `experimental_bearer_token`，同时保留 `env_key` 用于 UI 与迁移兼容
- **模型目录与本地路由**：支持保存 Codex 模型目录、reasoning 能力和 Chat Completions 本地路由元数据，实际 Codex 配置仍保持 Responses 格式
- **配置读写更稳**：支持 section-aware `wire_api`、`experimental_bearer_token` 清理、`model_catalog_json` 生成/移除和保留 `tuziswitch` 稳定 provider bucket

### 既有 Codex 配置能力

- **切换不再覆盖配置**：切换线路时只修改顶层 `model_provider` / `model` / `model_reasoning_effort`，不再整套覆盖 config.toml，MCP、Projects 等用户自定义配置不会丢失
- **多线路共存**：所有线路的 `[model_providers.xxx]` 在同一个 config.toml 中并存，切换只改指针
- **API Key 安全存储**：Key 主存储在环境变量或 shell rc 的 managed block 中（所有线路并存，切换不丢失）
- **同线路多 Key 支持**：同一条线路可配置多个 Key（自动后缀 `_2`、`_3`）
- **对齐官方配置格式**：兼容 Codex CLI 0.134.0+ 的新配置规范（不再使用已废弃的 `[profiles.xxx]`），同时向下兼容旧版本
- **版本自动检测**：启动时检测 Codex CLI 版本，自动选择新旧配置策略
- **卡片 Key 实时显示**：从 shell rc 实时读取 Key 显示在卡片上，不再依赖数据库存储
- **非兔子线路不显示充值/查询按钮**：第三方线路卡片只显示 Key，不显示兔子业务按钮

### 其他改进

- **自动升级链路**：原生能力走 Tauri 官方 updater，前端界面资源支持签名校验后的热更新
- **能力层接口**：新增 Capability Facade v1，热更新前端可按 manifest 调用稳定后端能力
- **Windows 环境变量支持**：Windows 平台通过 `setx` 写入用户环境变量（注册表），macOS/Linux 通过 shell rc managed block，平台自动检测
- API Key 输入框提示文案更新为”填入 API Key，将自动写入环境变量”
- 编辑页面补充”获取 API Key”链接
- TOML 配置编辑器移除已废弃的 auth.json 编辑区和 Common Config 功能
- 模型名称显示兼容新配置格式
- 多语言翻译补充（充值/查询按钮、TOML 配置标题）
- 预设种子卡片配置格式对齐新逻辑

## 产品亮点

- 兔子优先的 Claude Code、Codex、Gemini、OpenClaw 快速入口
- 从主界面直接完成兔子业务线路的一键接入配置
- 独立的兔子品牌视觉、图标和接入卡片
- 支持从应用内切换供应商，并保留桌面版任务栏切换入口
- 保留 providers、MCP、prompts、skills 等基础管理能力
- 基于 Tauri 2 的桌面应用架构

## 当前改版方向

相比原始上游项目，这一版更偏向业务交付和客户使用效率，而不是通用型高级配置工具：

- 右上角入口区改成更适合兔子业务接入的结构
- Claude Code、Codex、Gemini、OpenClaw 各自拥有独立的安装或配置路径
- 兔子快速接入被提升为主流程入口
- 一些原本偏通用的设置与配置流程做了简化

## 快速开始

1. 从 [Releases](https://github.com/tuziapi/tuzi-switch/releases) 下载最新安装包。
2. 打开 `tuzi-switch`。
3. 选择 Claude Code、Codex、Gemini 或 OpenClaw。
4. 在引导流程中输入你的兔子 Key。
5. 完成一键配置后开始使用对应工具。

如果你想查看 `Claude / Codex / Gemini` 当前的状态读取、一键配置、改版切换和 provider 联动逻辑，可直接阅读 [docs/current-route-logic-zh.md](./docs/current-route-logic-zh.md)。

## 主要能力

### 工具入口

- Claude Code、Codex、Gemini、OpenClaw 独立入口
- 支持对应工具的安装与升级引导
- 更强调业务接入，而不是先做通用供应商配置

### 供应商管理

- 支持新增、编辑、启用、停用、导入、导出供应商
- 在适用场景下同步一份配置到多个工具
- 可以在应用内或任务栏中切换当前供应商

### MCP、Prompts 与 Skills

- 保留 MCP 的基础管理能力
- 同步各工具的提示词文件
- 沿用上游桌面基础能力中的 skills 安装与同步流程

补充说明：

- 不同工具的同步能力并不完全一致
- OpenClaw 的部分联动能力仍在持续完善中

### 数据与本地存储

当前本地数据存储路径：

- `~/.tuzi-switch/tuzi-switch.db`
- `~/.tuzi-switch/settings.json`
- `~/.tuzi-switch/backups/`
- `~/.tuzi-switch/web-hot-update/`（签名校验后的前端热更新资源）
- `~/.codex/config.toml`（Codex 配置）
- `~/.codex/auth.json`（Codex 认证）
- `~/.zshrc` 或 `~/.bashrc`（环境变量 managed block）

## 更新机制

**v1.5.5 请从正式下载页下载安装包，或使用上面的 Mac 终端命令更新。** 本次未发布更新签名与自动更新清单，应用内自动更新暂不可用。

当前统一客户端通过完整安装包更新，避免旧界面热更新资源覆盖内置 opentu 工作区。已有更新验签机制保留，App 内不会执行安装脚本。

历史更新架构与维护说明见 [docs/自动升级与能力层设计.md](./docs/自动升级与能力层设计.md)；其中的原生 updater 和界面热更新设计不代表 v1.5.5 已提供自动更新服务。

## 开发计划 / TODO List

- 已完成：Codex 配置逻辑重构（切换不覆盖、多线路共存、env_key 存储、版本兼容）
- 已完成：缺 Node.js/npm 时的确认弹窗、自动依赖安装与继续配置链路
- 已完成：OpenClaw 默认模型选择、primary/fallbacks 写入和配置成功后的默认模型同步
- 已完成：快速接入”已写入”状态语义与下方 provider 卡片存在性对齐
- 进行中：继续跟踪 Windows 客户机真实反馈，特别是 Node/npm、PATH、winget 与 CLI shim 命中差异
- 进行中：继续优化 OpenClaw 会话恢复、默认模型选择体验与业务线路表达
- 下一步：继续推进 macOS 签名分发与客户视角安装说明收口

## 说明

- 本仓库是面向兔子业务场景的定制分支。
- 部分文档和内部兼容路径仍保留上游技术约定。
- 安装包与后续版本通过本仓库的 GitHub Releases 分发。

## 致谢

tuzi-switch 构建在开源 CC Switch 的工程基础之上。本仓库在此基础上继续开发，并将产品体验调整为更适合兔子业务流程的版本。
