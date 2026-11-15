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

## OFFICIAL-REL-02：复用源码、重新构建正式包

用户在核对 v1.5.4 的 23 个附件、Mac 包内测试更新地址及七份测试签名后，明确选择复用源码和页面、重新构建正式包，不搬运旧二进制冒充正式渠道。PR #55 已合并，正式 main 为 `ec913f64e8448ff9ab706feb1657ee6683832cf4`。从 main 启动的正式 run `41979701338` 仍在分配 runner 前因计费锁定失败。

本轮将构建计算与最终签名、发布分开：AiW520 仓库独立分支 `codex/official-build-staging` 只检出固定正式源码，嵌入正式仓库和原正式公钥；只上传明确标记待签名的附件，不接触任何签名 secret，不生成更新清单、不发布 Release/Pages，也不修改测试 main。该临时 workflow 不合入正式 main。实际构建仓库、源码仓库、两个 SHA 和 run 分别保留，不能互相冒充。

首次暂存 run `41983402901` 已正常启动 runner；宿主 772 项测试通过，创作模块 1,860 项通过、1 项失败。失败位于 `ImageEditor.test.tsx`：等待基础 Crop 画布出现后立即断言由 effect 初始化的裁剪区域画布，存在时序竞争。本机原 22 项定向测试通过；修正为等待裁剪画布实际挂载后再断言，保留检查内容，不修改业务代码、不跳过测试。修正后的定向和全量结果在 PR 中记录；成功重建后再记录安装包验收。

当前本机约 35 GiB 空间，原共享依赖与原生缓存已不存在；将本任务的失效依赖链接完整移至临时备份后，按 frozen lockfile 重新安装依赖。网页模板重新编译、签名门禁 5 项及下载元数据 9 项检查通过。本机没有配置正式更新私钥，已向用户询问安全文件路径或是否仅存于 GitHub Secrets。正式签名及公开下载页仍待完成；未降低客户端运行时验签要求。

### 用户明确取消本次签名要求

用户确认本机没有正式私钥备份，并明确要求“不需要签名，直接构建就好”。按此最新授权继续未签名手动安装交付；不再等待私钥，不伪造签名、不生成 latest.json、不关闭客户端验签。PR #56 的测试等待修正已合并；正式构建源码固定为 main `6bc275a1aa2916b573f5450a694927af2ef7b7fc`。暂存 runner 记录实际执行仓库 `AiW520/tuzi-switch`、执行分支提交 `dde97760f6c0885857d05a7e5b46c923d5575caa` 和 run `41984478037`，应用内仓库与公钥仍为正式渠道。

下载页增加可选 `VITE_MANUAL_INSTALL_ONLY` 开关，仅值 `true` 显示本版手动安装说明；默认关闭，未新增业务或数据库字段。发布说明同步修订。页面采用现有正式 Pages main 根目录部署，本地构建时仍须核验已经公开的七份正式附件，不跳过元数据门禁。此交付例外及以后移除根目录快照的条件见 ADR-018。
