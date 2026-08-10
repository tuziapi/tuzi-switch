# Linux `.deb` 安装包无法安装修复文档

## 问题描述

### 现象

用户在 Ubuntu 上使用 `sudo dpkg -i tuzi-switch-linux-x86_64.deb` 安装 GitHub Releases 提供的 `.deb` 包时，出现如下错误：

```
dpkg: 处理归档 tuzi-switch-linux-x86_64.deb (--install)时出错：
 在解析文件 '/var/lib/dpkg/tmp.ci/control' 第 1 行附近时：无效的软件包名存在于 'Package' 字段: 必须以字母或数字开头
在处理时有错误发生：
 tuzi-switch-linux-x86_64.deb
```

### 影响范围

- 所有从 GitHub Releases 下载的 `tuzi-switch-linux-x86_64.deb` 安装包
- macOS `.dmg`、Windows `.msi/.exe`、Linux `.AppImage` 不受影响
- 出现自 `v1.1.x` 系列的 Linux 构建产物开始

## 问题根因

### 代码分析

`src-tauri/tauri.conf.json` 中 `productName` 使用了中文：

```jsonc
{
  "productName": "兔子switch",
  ...
}
```

Tauri 的 deb 打包器会把 `productName` 转成 kebab-case 后写入 Debian 控制文件的 `Package:` 字段。该字段受 Debian 政策严格约束：

> Package names must consist only of lower case letters (a-z), digits (0-9), plus (+) and minus (-) signs, and periods (.). They must be at least two characters long and **must start with an alphanumeric character**.

因此中文字符打头的 `兔子switch` 无法通过 dpkg 校验，导致整个包无法安装。

同一个 workflow 里，Windows 构建（[.github/workflows/build.yml:161-164](../.github/workflows/build.yml)）已通过 `--config '{"productName":"tuzi switch"}'` 在构建时覆盖为 ASCII 名字（NSIS/MSI 也有名称限制），但 **Linux 构建段落漏掉了这一步**，直接使用了默认的 `productName`，从而产出了非法的 `Package:` 字段。

### 根本原因

- `productName` 含非 ASCII 字符
- Linux 打包阶段没有像 Windows 那样通过 CLI 参数覆盖 `productName`
- 导致 deb 控制文件中的 `Package:` 字段以中文字符开头，不符合 Debian 命名规则

## 修复方案

在 `.github/workflows/build.yml` 的 `build-linux` 作业里，把 `pnpm tauri build` 全部改为携带 `--config '{"productName":"tuzi switch"}'`：

```yaml
- name: Build
  env:
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  shell: bash
  run: |
    set -euo pipefail
    if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
      pnpm tauri build --config '{"productName":"tuzi switch","bundle":{"createUpdaterArtifacts":false}}'
    else
      pnpm tauri build --config '{"productName":"tuzi switch"}'
    fi
```

覆盖后，Tauri 生成的 deb 控制文件中：

- `Package: tuzi-switch`（合法：以字母开头，仅含小写字母、数字、连字符）
- 应用可执行名与 AppImage 命名保持一致，避免额外分歧

## 为什么其他平台不受影响

| 平台 | 打包格式 | 是否有命名限制 | 备注 |
| --- | --- | --- | --- |
| macOS | `.dmg` / `.app` | 无（支持任意 Unicode） | 保留中文 `productName` 呈现效果 |
| Windows | `.msi` / NSIS `.exe` | MSI/NSIS 对包名有部分限制 | workflow 已通过 `--config` 提前修复 |
| Linux | `.AppImage` | 无 | 只是文件名 |
| Linux | `.deb` | **Debian 政策：`Package:` 必须以字母数字开头** | 本次修复目标 |
| Linux | `.rpm` | 类似限制 | 覆盖 `productName` 后同样解决 |

## 用户临时规避方案（在新版本发布前）

- 优先使用 `.AppImage`（本次问题不影响 AppImage）
- 或使用一键安装脚本：`curl -fsSL https://cdn.jsdelivr.net/gh/tuziapi/tuzi-switch@<tag>/scripts/install_tuzi_switch.sh | bash`
- 若必须使用 deb：可以下载后用 `dpkg-deb -R` 拆包、手动改 `DEBIAN/control` 中的 `Package:` 值，再 `dpkg-deb -b` 重打包；但推荐直接等下一版发布

## 验证方式

- 在含本次修复的 tag（例如 `v1.1.32+`）发布后，从 Releases 下载 `tuzi-switch-linux-x86_64.deb`
- 执行 `dpkg-deb -f tuzi-switch-linux-x86_64.deb Package`，应返回 `tuzi-switch`
- `sudo dpkg -i tuzi-switch-linux-x86_64.deb` 能正常完成安装
- 启动应用后功能与 AppImage / Windows / macOS 版本一致

## 相关文件

- `.github/workflows/build.yml`（Linux 构建段落）
- `src-tauri/tauri.conf.json`（`productName` 定义）
- Tauri 官方文档：[Bundle Configuration](https://tauri.app/v2/reference/config/#bundleconfig)
- Debian Policy §5.6.7 Package name rules
