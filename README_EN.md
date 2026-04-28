<div align="center">

# tuzi-switch

### Tuzi business desktop companion for Claude Code, Codex, Gemini, and OpenClaw

[![Version](https://img.shields.io/github/v/release/tuziapi/tuzi-switch?color=0ea5e9&label=version)](https://github.com/tuziapi/tuzi-switch/releases)
[![Downloads](https://img.shields.io/github/downloads/tuziapi/tuzi-switch/total?color=f97316)](https://github.com/tuziapi/tuzi-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-94a3b8)](https://github.com/tuziapi/tuzi-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-111827)](https://tauri.app/)

[中文](README.md) | English | [日本語](README_JA.md) | [Releases](https://github.com/tuziapi/tuzi-switch/releases)

</div>

## Download

Get the latest build from [GitHub Releases](https://github.com/tuziapi/tuzi-switch/releases).

Recommended packages:

- Windows: download the Windows installer
- Linux: download `.AppImage`, `.deb`, or `.rpm` based on your distro
- macOS: download `macOS-unsigned.dmg` or `macOS-unsigned.zip`

Current public releases are ready for Windows and Linux users. macOS is currently shipped as an unsigned test build.

### macOS / Linux One-Command Install

Install the currently recommended build `v3.12.17` directly from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/tuziapi/tuzi-switch/main/scripts/install_tuzi_switch.sh | env TUZI_SWITCH_TAG=v3.12.17 bash
```

Notes:

- The current release workflow still publishes builds as `prerelease`
- GitHub `releases/latest` does not reliably resolve to the newest testing build
- The README command stays pinned to `v3.12.17` so it installs the current recommended version reliably
- To install another version, replace the value in `TUZI_SWITCH_TAG=vX.Y.Z`

### macOS Unsigned Build

If macOS blocks the app on first launch, use either of these methods:

1. Right-click the app and choose `Open`, then confirm `Open` again.
2. Or run:

```bash
xattr -dr com.apple.quarantine "/Applications/tuzi-switch.app"
open "/Applications/tuzi-switch.app"
```

If the app was launched from an extracted folder instead of `/Applications`, replace the path accordingly.

## What Is tuzi-switch?

tuzi-switch is a Tuzi-branded business edition built on top of CC Switch. It keeps the mature multi-tool desktop foundation, then focuses the product around a simpler customer onboarding path for Tuzi services.

The current version is centered on four entry points:

- Claude Code
- Codex
- Gemini
- OpenClaw

Users only need to enter their Tuzi key once, then complete route setup and local configuration faster without editing config files manually.

## Current Version Updates

The current public release is `v3.12.17`, with this round focused on:

- Claude, Codex, and Gemini now check latest versions for both official/original and gac modified CLIs, with status states for `Upgrade / Latest / Check failed`
- gac modified upgrades now run the corresponding install URL directly; Codex / Gemini also record `INSTALL_VERSION` to avoid false mismatches between local package versions and remote gac suffixes
- The Codex Coding special route now defaults to `https://api.tu-zi.com/coding` while still recognizing the previous URL for compatibility
- Windows download wording is simplified to “Windows installer”, while macOS / Linux one-command install wording and Git Bash misuse hints are aligned
- Codex status trust was tightened so mismatches between installer records, the actual CLI variant, and the current route are surfaced clearly
- The one-command install flow remains pinned to the current recommended version, with installer-script examples updated accordingly

## Product Highlights

- Tuzi-first quick access for Claude Code, Codex, Gemini, and OpenClaw
- One-click Tuzi route onboarding from the main app entry
- Dedicated Tuzi branding, icon system, and onboarding cards
- Provider switching from the app, with the desktop tray flow retained
- Retained base management capabilities for providers, MCP, prompts, and skills
- Desktop application architecture built on Tauri 2

## Current Customization Direction

Compared with the original upstream project, this edition focuses more on business delivery than generic power-user tooling:

- The top-right entry area is adjusted for Tuzi onboarding flow
- Claude Code, Codex, Gemini, and OpenClaw each have their own independent installation or configuration path
- Tuzi quick configuration is surfaced as the primary guided action
- Some original settings and generic configuration flows were simplified for customer use

## Screenshots

### Claude

![Claude Tuzi Flow](assets/screenshots/claude-tuzi.png)

### Codex

![Codex Tuzi Flow](assets/screenshots/codex-tuzi.png)

### Gemini

![Gemini Tuzi Flow](assets/screenshots/gemini-tuzi.png)

### OpenClaw

![OpenClaw Tuzi Flow](assets/screenshots/openclaw-tuzi.png)

## Quick Start

1. Download the latest package from [Releases](https://github.com/tuziapi/tuzi-switch/releases).
2. Open `tuzi-switch`.
3. Choose Claude Code, Codex, Gemini, or OpenClaw.
4. Enter your Tuzi key in the guided setup flow.
5. Finish one-click configuration and start using your selected tool.

## Main Capabilities

### Tool Access

- Separate entry points for Claude Code, Codex, Gemini, and OpenClaw
- Faster installation and upgrade guidance for supported tools
- Business-oriented onboarding instead of generic provider-first navigation

### Provider Management

- Add, edit, enable, disable, import, and export providers
- Sync one provider configuration to supported apps where applicable
- Switch active provider from the app or tray

### MCP, Prompts, and Skills

- Base MCP management retained from the desktop foundation
- Prompt file sync across supported tools
- Skills installation and synchronization workflow inherited from the upstream desktop foundation

Notes:

- Sync behavior is not identical across every tool
- Some OpenClaw-related integrations are still being refined

### Data and Local Storage

For compatibility with the upstream ecosystem, local data currently still uses the existing CC Switch storage path:

- `~/.cc-switch/cc-switch.db`
- `~/.cc-switch/settings.json`
- `~/.cc-switch/backups/`
- `~/.cc-switch/skills/`

## Development Plan / TODO

- Done: Claude / Codex / Gemini latest-version checks, upgrade button states, and modified-variant upgrade paths are now aligned
- Done: the Codex Coding special route now uses `https://api.tu-zi.com/coding`, while the previous URL remains recognized for compatibility
- Done: Windows download copy is simplified, and macOS / Linux one-command install headings plus Git Bash misuse hints are aligned
- Done: the README install command and installer-script example are now pinned to `v3.12.17`
- In progress: keep aligning route cards, status blocks, provider-list highlights, and copy density across light and dark themes
- In progress: keep refining conflict boundaries between the actual CLI on PATH, installer records, and external-script state files
- Next: continue refining session management and recovery strategy
- Next: keep moving the release workflow toward a more stable `latest` flow and signed distribution experience

## Notes

- This repository is a customized business fork for Tuzi usage scenarios.
- Some documents and internal compatibility paths still retain upstream technical conventions.
- Release packaging is distributed through GitHub Releases in this repository.

## Credits

tuzi-switch is customized on top of the open-source CC Switch foundation. This repository continues that engineering base while reshaping the product experience for Tuzi business workflows.
