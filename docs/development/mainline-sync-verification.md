# B4 远程主分支本地同步验证（2026-10-18）

任务 `B08-local-mainline-sync`；基线 `TA-AC-1.5-B4` / 契约 `system-token-v1` 不变。用户先要求核实远程主分支和方案，随后明确回复“确认”，授权以下本地 fetch/merge/验证/提交及文档更新。没有 push、PR、远程合并、部署、生产数据/配置/迁移操作、真实凭证、支付或付费模型调用。

## 仓库、来源和精确代码配对

两仓开始时均干净，无需 stash，无未跟踪附件迁移；继续使用现有目录、同名分支 `codex/tuzi-assistant-system-token`，未使用旧 `codex/tuzi-assistant-dev`。

| 项目 | 客户端 | API/网站 |
|---|---|---|
| 开发目录 | `/Users/syd08/Documents/tuzi-switch-system-token` | `/Users/syd08/Documents/tuzi/tuzi-api-system-token` |
| origin | `https://github.com/tuziapi/tuzi-switch.git` | `https://github.com/tuziapi/tuzi-api.git` |
| 远程 HEAD 默认分支 | `refs/heads/main` | `refs/heads/dev` |
| 同步前 B HEAD | `cb009d8cbc9eac7af293eb1740a35682c649aa2e` | `9f0bdbb1388334cd176c97460adb7e68bbcaaec1` |
| 本次抓取主分支 SHA | `01546a835a33fd8c1da75f4b67b0816f204e752b` | `a770d4511eb1b9ac7d0707f85a8e3c03e39b5102` |
| 本地 merge 提交/被测代码配对 | `8bcb34a82a15d9f92594b1c8212605eb485cb506` | `eb6816259289ddc0c0f8a0bd8d0914a06709ee02` |

远程默认分支通过 `git ls-remote --symref origin HEAD` 核实。首次两仓 `git fetch origin` 遇 GitHub443连接超时，后续重试成功。客户端远程存在同名 `main` 标签，短名 fetch 只取到了标签，因此改用 `git fetch origin refs/heads/main:refs/remotes/origin/main` 明确抓取主分支；最终 merge 使用 `origin/main`。API 成功 `git fetch origin dev`，其 `origin/dev` 与远程 HEAD 一致。以上“最新”指本次成功抓取的固定时点，不推断后续远程或线上状态。

分别执行 `git merge --no-ff --no-commit origin/main` / `origin/dev`，检查后提交；没有 reset、清理命令、整文件 ours/theirs 或业务回退。两次自动合并均无冲突。后续文档提交只改规则/进度/配对/验证记录，不改变上表被测业务代码，其 HEAD 由 Git 历史定位，避免自引用。

API随后文档交付HEAD为 `11e14cb511607c91f9af9bf9e97ba1c785f93bd1`；客户端文档交付HEAD由本报告所在提交定位。两者业务代码仍为上表merge配对。

## 合并及功能保留核对

- API 纳入5个上游提交：MiniMax H3超时、Gemini Live与流式回归、Pixmax公开错误URL脱敏、前端许可证/格式、手机端按钮换行。77个文件变化，与原站改动一致。
- API 双方重叠文件 `middleware/auth.go` 和 `web/vite.config.js` 自动合并后，仅增加 Live模型Key入口及 `/v1` WebSocket代理；B bootstrap/身份校验、原子Key/profile PATCH、本人汇总、性能扩展、系统令牌卡片/引导及隔离代理保留。逐文件对比确认 B 专用业务路径相对同步前没有被修改；未重新引入 A `/api/desktop`、OAuth表/迁移/撤销钩子。
- 客户端纳入1个上游提交“更新供应商默认模型名称 (#47)”，这些内容在 B 分支中已相同。merge 后代码树与同步前完全相同：tree `33636aaa68ab32a781e7b580cc42de228df8a5e6`，仅补齐父提交关系。账户系统令牌、P2资料缺省修复、七工具、独立凭证及 Phase 1 隐藏状态均保留。
- 有效 AGENTS 将当前两仓分支及已授权本地 merge 写清楚；旧分支条目标记历史 A，原历史文档/快照不改写。

## 验证命令与实际结果

环境：macOS，现有本地依赖，Bun 1.4.2；未安装/升级依赖。Go使用 `env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}"` 干净环境运行，避免继承外部DSN/凭证/真实上游/预览opt-in配置。测试以合成/临时数据为主，既有真实预览服务未重启。证据日志位于本机 `/tmp/tuzi-b4-sync-*.log`，仅临时诊断，不作为持久附件。

| 检查 | 命令/范围 | 结果 |
|---|---|---|
| API服务端及上游回归 | `go test ./middleware ./controller ./model ./router ./pkg/perf_metrics ./common ./docscenter ./relay ./relay/channel ./relay/channel/gemini ./relay/channel/task/pixmax ./relay/common ./relay/helper ./service ./setting/billing_setting ./pkg/billingexpr -count=1` | 16包全部通过；service 279.877s。含B身份/本人/部分更新与新增Live/超时/错误脱敏/计费测试 |
| 客户端类型 | `pnpm typecheck` | 通过 |
| 客户端前端 | `pnpm test:unit --run tests/account tests/config tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/components/ProviderForm.test.tsx tests/components/AddProviderDialog.test.tsx tests/integration/App.test.tsx tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx tests/hooks/useAutoCompact.test.tsx` | 17文件，84通过、1既有失败（下述），未声称全绿 |
| Rust账户/工具 | `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_ -- --test-threads=1` | 47通过、2默认忽略（真实Go配对/OS安全存储），含账户与七工具事务 |
| Rust供应商 | 同上 Cargo 命令，过滤改为 `provider::tests` | 52通过；与上项有交集，不能累加为独立测试数 |
| 网站定向测试 | 下列14文件分别以独立 `bun test <文件>` 进程运行 | 361通过、2既有失败（下述），退出失败的文件不标通过 |
| 客户端渲染构建 | `pnpm build:renderer` | 通过，保留chunk体积提示；未构建发行安装包 |
| 网站构建 | `web/` 下 `bun run build` | 通过，保留chunk体积提示 |
| Git/文档 | `git diff --check`、暂存差异检查、双方父提交和祖先关系、文档本地链接/围栏、历史A快照不变 | 通过（文档提交前后复核） |

网站文件（相对 `web/`）：

```text
src/components/settings/personal/cards/SystemTokenCard.test.jsx
src/helpers/auth.return-target.test.jsx
src/helpers/loginReturnTarget.test.js
src/helpers/auth.test.jsx
src/components/settings/PersonalSetting.alert-migration.test.jsx
src/helpers/utils.test.js
src/components/table/model-pricing/modal/components/GeminiLiveForm.test.jsx
src/components/table/model-pricing/modal/components/geminiLiveMedia.test.js
src/components/table/model-pricing/modal/components/modelQuickStartConfig.test.js
src/components/table/model-pricing/modal/components/modelQuickStartUtils.live.test.js
src/pages/BusinessAnalysis/AnomalyMonitoringDashboard.test.jsx
src/pages/BusinessAnalysis/BackendErrorAlertConfigPanel.test.jsx
src/pages/Setting/Ratio/components/TieredPricingEditor.test.jsx
vite.config.test.js
```

最初将14文件置于同一个 Bun 进程，出现 Semi UI 模块Mock相互干扰（Toast/InputNumber/Banner缺失），不能据此判业务回归。拆为独立进程后消失；系统令牌/引导5文件37项、utils94项、新增Live相关及Vite代理均通过。如下两项独立运行仍失败，未掩盖。

## 既有失败及本次未验证范围

1. 客户端 `tests/config/opencodeProviderPresets.test.ts` 仍断言空预设，但既有 B 实现有 Responses/Chat/Anthropic/Gemini 四个兔子主站预设，与技术方案保留要求一致。该测试及源码相对同步前未变，且整个客户端代码树相同，故非本次 merge 引入；不删预设迎合旧断言。
2. 网站 `AnomalyMonitoringDashboard.test.jsx` 期望详情宽度50vw，而既有实现为80vw。用同步前API `9f0bdbb...` 的 `git archive` 临时只读源码副本复跑：同样14通过、1失败。未改变产品宽度。
3. 网站 `TieredPricingEditor.test.jsx` 的 MiniMax H3预设前后端一致性失败：前端旧0.80/0.50及0.20，后端0.56/0.35及0.14，并有1080P/720P档位。同步前源码副本复跑同样45通过、1失败。本次后端此表达式未改；这是已有价格预设不一致，需要后续独立核定，不在同步任务内调整价格。

未新增真实浏览器/原生app验收，未重新执行真实Go配对或OS安全存储opt-in测试，不把历史联调当本次merge后联调。MySQL/PostgreSQL、三平台发行包、真实OAuth/支付/付费模型调用、生产容量及用户验收均仍未完成。代码同步和上述检查完成不代表全测试通过或发布。

## 后续顺序与回退

本次无接口/数据库契约变更，继续先另获授权并完成门禁，后部署兼容API/网站再客户端。三个既有测试问题和相应环境门禁应独立处理。若需撤回本次本地同步，用经授权的 `git revert -m 1 <对应merge SHA>` 保留B第一父提交业务，文档提交单独revert；两仓非原子，须重新登记配对。不得通过reset/force push或删除数据库回退，不恢复A连接，也不轮换网站系统令牌。
