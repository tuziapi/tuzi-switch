<div align="center">

# tuzi-switch

### Tuzi business desktop companion for Claude Code, Codex, and OpenClaw

[![Version](https://img.shields.io/github/v/release/tuziapi/tuzi-switch?color=0ea5e9&label=version)](https://github.com/tuziapi/tuzi-switch/releases)
[![Downloads](https://img.shields.io/github/downloads/tuziapi/tuzi-switch/total?color=f97316)](https://github.com/tuziapi/tuzi-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-94a3b8)](https://github.com/tuziapi/tuzi-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-111827)](https://tauri.app/)

English | [中文](README_ZH.md) | [日本語](README_JA.md) | [Releases](https://github.com/tuziapi/tuzi-switch/releases)

</div>

## What Is tuzi-switch?

tuzi-switch is a Tuzi-branded business edition built on top of CC Switch. It keeps the mature multi-tool desktop foundation, then focuses the product around a simpler customer onboarding path for Tuzi services.

The current version is centered on three tools:

- Claude Code
- Codex
- OpenClaw

Users only need to enter their Tuzi key once, then complete route setup and local configuration faster without editing config files manually.

## Product Highlights

- Tuzi-first quick access for Claude Code, Codex, and OpenClaw
- One-click business route setup from the main app entry
- Dedicated Tuzi branding, icon system, and onboarding cards
- Provider switching from the desktop app and tray menu
- Unified management for providers, MCP, prompts, and skills
- Cross-platform desktop support on Windows, macOS, and Linux

## Current Customization Direction

Compared with the original upstream project, this edition focuses more on business delivery than generic power-user tooling:

- The top-right entry area is adjusted for Tuzi onboarding flow
- Claude Code, Codex, and OpenClaw each have their own independent installation or configuration path
- Tuzi quick configuration is surfaced as the primary guided action
- Some original settings and generic workflow content were simplified for customer use

## Screenshots

| Main Interface | Add Provider |
| :--: | :--: |
| ![Main Interface](assets/screenshots/main-en.png) | ![Add Provider](assets/screenshots/add-en.png) |

## Quick Start

1. Download the latest package from [Releases](https://github.com/tuziapi/tuzi-switch/releases).
2. Open `tuzi-switch`.
3. Choose Claude Code, Codex, or OpenClaw.
4. Enter your Tuzi key in the guided setup flow.
5. Finish one-click configuration and start using your selected tool.

## Main Capabilities

### Tool Access

- Separate entry points for Claude Code, Codex, and OpenClaw
- Faster installation and upgrade guidance for supported tools
- Business-oriented onboarding instead of generic provider-first navigation

### Provider Management

- Add, edit, enable, disable, import, and export providers
- Sync one provider configuration to supported apps where applicable
- Switch active provider from the app or tray

### MCP, Prompts, and Skills

- Centralized MCP management
- Prompt file sync across supported tools
- Skills installation and synchronization workflow inherited from the upstream desktop foundation

### Data and Local Storage

For compatibility with the upstream ecosystem, local data currently still uses the existing CC Switch storage path:

- `~/.cc-switch/cc-switch.db`
- `~/.cc-switch/settings.json`
- `~/.cc-switch/backups/`
- `~/.cc-switch/skills/`

## Notes

- This repository is a customized business fork for Tuzi usage scenarios.
- Some documents and internal compatibility paths still retain upstream technical conventions.
- Release packaging is distributed through GitHub Releases in this repository.

## Credits

tuzi-switch is customized on top of the open-source CC Switch foundation. This repository continues that engineering base while reshaping the product experience for Tuzi business workflows.
