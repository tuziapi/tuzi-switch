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

最新安装包请前往 [GitHub Releases](https://github.com/tuziapi/tuzi-switch/releases)。

推荐下载方式：

- Windows：下载 `.msi` 安装版
- Windows 便携版：如当前版本提供，再下载对应的 `Windows-Portable.zip`
- Linux：根据发行版选择 `.AppImage`、`.deb` 或 `.rpm`
- macOS：下载 `macOS-unsigned.dmg` 或 `macOS-unsigned.zip`

目前公开 Release 已支持 Windows 和 Linux 用户下载使用。macOS 当前提供的是未签名测试包。

### 一键安装

直接安装当前推荐版本 `v3.12.13`：

```bash
curl -fsSL https://raw.githubusercontent.com/tuziapi/tuzi-switch/main/scripts/install_tuzi_switch.sh | env TUZI_SWITCH_TAG=v3.12.13 bash
```

补充说明：

- 当前 Release workflow 仍使用 `prerelease` 发布策略
- 因此默认走 GitHub `releases/latest` 时，不一定能命中当前最新测试版本
- 目前 README 默认固定到 `v3.12.13`，这样可以确保安装到我们当前推荐版本
- 需要安装其它版本时，可以改用 `env TUZI_SWITCH_TAG=vX.Y.Z bash`

### macOS 未签名包打开方式

如果第一次打开时被系统拦截，可以用下面两种方式之一：

1. 对应用点右键，选择“打开”，然后在弹窗里再次确认“打开”
2. 或在终端执行：

```bash
xattr -dr com.apple.quarantine "/Applications/tuzi-switch.app"
open "/Applications/tuzi-switch.app"
```

如果你不是把应用放在 `/Applications`，把命令里的路径改成你自己的实际路径即可。

## tuzi-switch 是什么

tuzi-switch 是基于 CC Switch 定制的兔子业务版本。它保留了成熟的多工具桌面管理基础能力，同时把产品重点放在兔子客户更容易上手的接入流程上。

当前版本主要围绕 4 个入口展开：

- Claude Code
- Codex
- Gemini
- OpenClaw

用户只需要输入一次兔子 Key，就可以更快完成线路接入和本地配置，不需要自己手动改配置文件。

## 当前版本更新

当前公开版本为 `v3.12.13`，这一轮更新重点包括：

- 继续收尾 Claude、Codex、Gemini、OpenClaw 四个入口的状态可信度与路线表达
- 页面主状态继续以当前 provider 为准，并新增 provider 与 CLI/安装器记录不一致时的提示
- 同步优化 Codex、OpenClaw 的会话标题提取逻辑，减少噪音信息并提升可读性
- 补充使用统计页的分页体验，增强页码折叠与跳页交互
- 继续补强安装脚本固定版本安装方式，确保一键安装命中当前推荐版本

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

## 界面预览

### Claude

![Claude 兔子接入](assets/screenshots/claude-tuzi.png)

### Codex

![Codex 兔子接入](assets/screenshots/codex-tuzi.png)

### Gemini

![Gemini 兔子接入](assets/screenshots/gemini-tuzi.png)

### OpenClaw

![OpenClaw 兔子接入](assets/screenshots/openclaw-tuzi.png)

## 快速开始

1. 从 [Releases](https://github.com/tuziapi/tuzi-switch/releases) 下载最新安装包。
2. 打开 `tuzi-switch`。
3. 选择 Claude Code、Codex、Gemini 或 OpenClaw。
4. 在引导流程中输入你的兔子 Key。
5. 完成一键配置后开始使用对应工具。

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

为了兼容上游生态，当前本地数据仍沿用原有 CC Switch 存储路径：

- `~/.cc-switch/cc-switch.db`
- `~/.cc-switch/settings.json`
- `~/.cc-switch/backups/`
- `~/.cc-switch/skills/`

## 开发计划 / TODO List

- 已完成：四个入口的第一轮兔子路线管理、Codex 主线路 / Coding 特别线路拆分、Gemini 首版业务接入
- 已完成：状态卡、Key 输入安全、安装脚本固定版本安装流程、基础主题视觉的一轮修正
- 已完成：provider 与 CLI/安装器状态冲突提示的首版落地
- 进行中：继续优化四个入口的状态可信度、刷新反馈与异常提示
- 进行中：继续统一深色 / 浅色主题下的路线卡、状态区、提示区与列表高亮
- 进行中：继续优化 OpenClaw 的业务接入体验和路线说明
- 下一步：继续梳理会话管理能力，明确 OpenClaw 会话恢复边界
- 下一步：补充更完整的 release 说明、安装提示与客户视角文案
- 后续规划：在条件允许时对接更完整的真实业务数据能力

## 说明

- 本仓库是面向兔子业务场景的定制分支。
- 部分文档和内部兼容路径仍保留上游技术约定。
- 安装包与后续版本通过本仓库的 GitHub Releases 分发。

## 致谢

tuzi-switch 构建在开源 CC Switch 的工程基础之上。本仓库在此基础上继续开发，并将产品体验调整为更适合兔子业务流程的版本。
