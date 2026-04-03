# macOS Release Secret 准备说明

如果要让 `tuzi-switch` 的 GitHub Release 自动产出 macOS `.dmg` 和 `.zip`，需要先在仓库 `Settings -> Secrets and variables -> Actions` 中配置以下 Secret：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

## 一键准备脚本

仓库已提供脚本：

```bash
bash scripts/prepare-macos-release-secrets.sh <输出目录> <你的p12路径> <可选的tauri私钥路径>
```

示例：

```bash
bash scripts/prepare-macos-release-secrets.sh \
  /tmp/tuzi-release-secrets \
  /Users/yourname/Downloads/DeveloperIDApplication.p12
```

脚本会做两件事：

1. 生成或整理 Tauri updater 私钥
2. 把 `.p12` 证书转成可直接粘贴进 GitHub Secret 的单行 base64 文本

输出文件说明：

- `TAURI_SIGNING_PRIVATE_KEY.txt`
  直接把整个文件内容粘贴到 `TAURI_SIGNING_PRIVATE_KEY`
- `APPLE_CERTIFICATE.base64.txt`
  直接把整个文件内容粘贴到 `APPLE_CERTIFICATE`

## Apple 侧需要你提前准备的内容

### 1. Developer ID Application 证书

必须是 `Developer ID Application`，不是普通开发证书。

导出成 `.p12` 时请记住导出密码，这个密码对应：

- `APPLE_CERTIFICATE_PASSWORD`

### 2. Apple 公证账号

你还需要：

- `APPLE_ID`
  Apple Developer 账号邮箱
- `APPLE_PASSWORD`
  App-Specific Password，不是 Apple 登录密码
- `APPLE_TEAM_ID`
  Apple Developer Team ID

## 推荐填写方式

- `TAURI_SIGNING_PRIVATE_KEY`
  直接粘贴私钥原文，保留换行
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  如果生成密钥时没有设置密码，可以不填
- `APPLE_CERTIFICATE`
  粘贴脚本生成的 base64 单行文本
- `KEYCHAIN_PASSWORD`
  自己设置一个随机强密码，例如 20 位以上

## 配置完成后的验证方法

1. 在 GitHub 仓库中填好所有 Secret
2. 新建一个版本标签，例如 `v3.12.7`
3. 等待 `Release` workflow 跑完
4. Release 页面应出现：
   - `tuzi-switch-v3.12.7-macOS.dmg`
   - `tuzi-switch-v3.12.7-macOS.zip`

## 我现在能帮你做到哪一步

我可以继续帮你：

- 检查你生成出来的 Secret 文件格式对不对
- 在你把 `.p12` 放到本机后帮你运行脚本
- 在你把 Secret 填进 GitHub 后继续帮你发新 tag 并盯发布结果

我不能替你获取：

- Apple Developer 证书
- Apple 账号密码或 app-specific password
- 你们组织自己的 GitHub Secret 内容
