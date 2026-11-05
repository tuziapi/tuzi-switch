# OFFICIAL-REL-01：兔子助手 v1.5.5 正式渠道统一

日期：2026-11-05，Asia/Shanghai。用户确认 AiW520/tuzi-switch 为测试仓库，要求统一到 tuziapi/tuzi-switch，检查后构建新版本安装包和下载页。

## 基准与范围

- 正式仓库 main：`d7b336586cff1328911a6a3567273c40359c3cdb`，PR #53 已合入；源码版本原为 1.5.4。
- 正式公开 latest 为 v1.4.3；测试仓库 latest 为 v1.5.4。准备新版本 v1.5.5，不覆写任一已发布版本。
- 独立分支 `codex/official-release-1.5.5`，保留原 gaizhao 工作区的未提交修改及附件。
- 本次只涉及分发、下载页和更新渠道，不修改账户 API/契约、权限、凭证格式或数据库字段；有效业务基线继续为现行 PRD 和 system-token-v1。
- 用户已批准方案 B 的实现及构建，随后明确授权推送本分支并运行 publish=false 的四平台构建。分支已推送，构建请求已提交。用户随后明确要求将正式渠道修正合入 main，本轮获准创建 PR 并通过普通合并流程执行；版本标签、公开发布和 Pages 部署仍不在本轮范围。

## 原问题与实现

| 原问题 | 本次处理 |
|---|---|
| 完整流水线只允许测试仓库，正式仓库走旧三平台流水线 | 统一流水线允许两仓；旧流水线停止标签触发并禁用入口，避免竞争发布 |
| 下载页和元数据固定读取测试仓库 | 默认正式仓库；CI 显式传入仓库，前后构建选择一致；只接受该仓库七个准确安装文件 |
| 更新签名校验固定使用测试公钥 | 正式渠道保留 tauri.conf.json 原公钥及原 secret 名；测试渠道保留独立公钥；无跨渠道兜底 |
| 正式客户端可能加载旧 renderer 热更新缓存 | 两个集成渠道均使用完整安装更新；保留原缓存与用户数据，但不加载旧界面覆盖创作工作区 |
| 正式客户端签名检查失败时进入旧浏览器降级路径 | 两个集成渠道都要求签名更新，不把网络/签名错误转换为浏览器下载 |
| 原流水线构建即发布 | 手动新增 publish=false 默认值，只上传经过来源/签名检查的 verified-release；发布须匹配版本标签并显式启用，或推送版本标签 |

四处版本已同步：package.json、Tauri 配置、Cargo.toml、Cargo.lock。新增 `publish` 输入有明确默认值，版本和仓库选择均有失败阻断。签名准备后先签署合成文件，验证私钥与所选渠道原公钥匹配，再进行完整原生构建。最终逐文件校验架构、来源 SHA、run ID、版本、正式身份、大小、SHA256 及更新签名。

## 环境阻塞与发布前置条件

1. 初次核查只有读取权限；用户调整权限后，账号 AiW520 对正式仓库返回 `push=true`、`admin=false`。两个正式签名 Secret 名称均可列出，分支推送及 workflow_dispatch 均已成功。没有读取、生成、轮换、复制真实私钥。当前实际阻塞为 GitHub 返回账户因计费问题被锁定，详见下方远程执行记录。
2. 正式 Pages 仍为 `build_type=legacy`、main 根目录。管理员需改为 GitHub Actions，并确认 github-pages 环境允许版本标签。发布步骤在公开安装文件前检查 Source，配置不符则阻断。
3. 原生 Rust 1.95 工具链实际已安装，但未在默认 PATH；通过 rustup 确认路径。独立原生 target 未建立，本机磁盘空间起初不足 0.5 GiB，后回升约 3.6 GiB，未删除用户文件腾挪构建空间。不能认定足以完成四平台原生构建。
4. 正式 `TAURI_SIGNING_PRIVATE_KEY` 必须对应原公钥，可选密码使用 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。测试的 `TUZI_UPDATER_PRIVATE_KEY` 不作为正式渠道兜底；Secret 名称已确认存在，真实密钥配对仍须由流水线验证。
5. 已安装测试渠道 v1.5.x 仍指向测试仓库并信任测试公钥，需要手动安装正式版切换渠道；不声称现有测试二进制会自动迁移。

## 本地验证

依赖复用另一已有 worktree 的安装，确认 pnpm-lock.yaml 字节完全一致；只在本任务目录生成文件，无重新安装或依赖版本变更。

- `pnpm typecheck`：通过。
- `pnpm build:renderer`：创作工作区及宿主生产资源构建通过，保留现有 Sass 弃用、打包体积等警告；这不是原生安装包。
- `pnpm --filter @tuzi/download-page exec vite build`：页面生产代码编译通过；没有创建虚假的公开下载清单。
- `node --test scripts/verify-updater-assets.mjs`：5 项通过，含真实 Ed25519 合成签名校验、篡改拒绝、正式/测试公钥选择、版本/标签门禁及完整更新清单跨仓库拒绝。
- `python3 scripts/test_release_assets.py`：5 项通过，含缺包、篡改、错误应用身份及错误仓库拒绝。
- 下载页 Node 测试：正式及测试仓库各 9 项通过，包含七种直链、摘要、仓库隔离及统计桥。
- 更新相关前端定向测试：24 项通过，覆盖两仓更新下载与安装分离、签名流程失败不降级、无新版本及手动下载来源校验。
- `rustfmt --edition 2021 src-tauri/src/web_hot_update.rs`：通过；未执行原生 cargo 回归，不以格式检查代替编译。
- `RELEASE_TAG=v1.5.5 pnpm build:download`：正式 GitHub Release 查询返回 404，按预期阻断。完整公开下载页须在真实正式安装文件发布后生成；此次页面编译不等于可下载交付。
- 全量前端首次运行因尚未生成 creative workspace dist，产生 23 项失败和 1 个 suite 加载失败；已补齐 renderer 构建后重跑，结果为 94 文件、772 项全部通过（日志 `/tmp/tuzi-official-front-final.log`）。

- `actionlint 1.7.7`：三份修改后的工作流静态检查通过，覆盖表达式、job 依赖、权限及输入类型。首次 Go 代理下载超时，改用 GitHub 官方 Release 二进制并校验所附 SHA256 后运行；未跳过工作流检查。
- `git diff --check` 与四版本/标签一致性检查：通过。
- 主要日志：`/tmp/tuzi-official-{typecheck,renderer,front-final,download-public}.log`。下载页本地编译产物位于本 worktree 的 `packages/download-page/dist/`，缺少公开 release.json，作为编译验证，不能直接部署给用户下载。

重要选择及兼容回退见 [ADR-018](decisions/0018-official-release-channel.md)。本地检查通过不替代四平台原生构建、真实签名密钥匹配或安装验收，不能认定“所有问题已排除”。

## 后续执行与回退

用户已要求先将准备改动合入正式 main；普通合并须遵守仓库规则，不绕过保护。合并不会代表原生构建已通过。GitHub 计费锁定解除后，从 main 运行 Unified desktop release（publish=false），待四平台全部原生回归与安装包构建成功并核对 verified-release 后，再按发布授权创建版本标签/运行发布及 Pages。正式公开后必须再次核对 Release 的七种文件 URL/大小/摘要、latest.json 签名、网页实际链接及 macOS 包内版本/架构；Windows/Linux 实机安装升级另记，不能以 CI 构建代替。

配置改动可用独立 commit revert 回退；已公开标签及安装包不覆写。安装回退保留用户数据，不删除配置或轮换账户令牌。更新签名不代表 Apple 公证或 Windows 开发者签名。


## 远程构建尝试：2026-11-05

- 用户明确授权：推送 `codex/official-release-1.5.5` 并启动 `publish=false` 四平台构建；授权范围未扩展到 PR、合并、标签、公开 Release 或 Pages 部署。
- 正式仓库远程分支已推送，实际构建源码 SHA：`23f02222d5540e49a9c0d06f499cbd8d039282c9`。
- 执行命令：`gh workflow run unified-release.yml -R tuziapi/tuzi-switch --ref codex/official-release-1.5.5 -f publish=false`。
- Run：`41964518572`，首次尝试；创建于 2026-11-05 11:54:53 Asia/Shanghai。地址：https://github.com/tuziapi/tuzi-switch/actions/runs/41964518572 。
- GitHub 接受 dispatch，但 `verify` job `127038320430` 在分配 runner 前失败：runner_name 为空、steps 为空。检查注释原文：**The job was not started because your account is locked due to a billing issue.**
- 因此没有远程代码测试、签名配对验证或原生编译；installers、assemble 和 publish 全部 skipped，无新安装包产物，不认定下载页已部署。没有可下载的 job 日志，API 返回 log not found；诊断来自 check-run annotations。
- 原因不是已观察到的代码/测试失败，也不是此前的仓库写权限不足。具体计费锁定原因未读取、未推断；须由有权限的组织/账单管理员检查和解除。没有尝试支付、提高预算、修改计费设置或改到测试仓库绕过。
- 锁定解除后可重跑本次构建；在解除前不反复重试。真实 Secret 配对、四平台构建及产物核验仍待完成。


## 正式主分支集成授权：2026-11-05

用户在知悉 GitHub 计费锁定及原生安装包尚未构建的前提下，明确要求“应该合并进去 main 分支”。本轮将通过 PR 集成已有代码与验证记录，不新增业务功能，不创建发布标签，不绕过分支保护或更改计费/Pages 设置。合并前核查 main 仍为 `d7b33658`，待合并源码与已完成本地验证的版本一致；后续提交仅记录构建尝试及授权。PR 合并结果以 GitHub 实际状态为准。
