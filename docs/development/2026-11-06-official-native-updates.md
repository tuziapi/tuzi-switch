# OFFICIAL-UP-02：正式应用内更新与旧版衔接

日期：2026-11-06，Asia/Shanghai。

## 范围与来源

用户选择 B：复用原生更新模块，实现发现新版、展示说明、应用内下载验签、显式点击后保存并安装重启。独立分支 `codex/official-native-updates`，基于正式 main `387a324f99b0844861fb30617a8884e7542e6209`；worktree `/Users/sdy09/.codex/worktrees/tuzi-official-native-updates/tuzi-switch`。原工作区的批量生图未提交改动未被修改。

只操作本地实现、验证、记录及 commit；未 push/PR/合并远程、运行云端工作流、构建或发布正式安装包、替换本机用户应用。没有读取或轮换真实签名私钥。账户 `system-token-v1`、原生业务与创作源码不变。

## 已核实与改动

- 正式 latest 为 v1.5.6，发布于 2026-11-06 00:19:30 Asia/Shanghai。公开附件是手动安装文件，无 `latest.json` / `.sig`。
- 正式仓库可列出 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，只说明 Secret 名称存在，值和密钥配对未验证。
- 接通正式 Release 与原生签名更新。完整附件、版本与平台 URL 一致才交给原生下载；不允许测试仓库、不同版本或不完整清单。未声明签名的历史版本继续显式手动安装，校验错误不降级。
- 全局提醒和设置入口先展示说明，不自动下载。复用已有下载、验签、任务/保存检查、安装、重启状态机；下载失败、任务阻塞、保存失败与安装失败均保留相应反馈和重试路径。
- 正式默认配置清除旧 raw/CDN 更新清单，公钥不变。签名检查超时或不一致时释放原生资源。
- 增加只验证现有正式密钥的工作流；统一发行流程新增默认关闭的 `signing_preflight_only` 输入。所有依赖分支均有明确行为，不与 `publish` 组合触发发布。

## 验证记录

- 最终更新专项：7 个文件、85 项通过，含原生四平台选择、旧清单/空返回/版本竞态拒绝、跨仓库 URL、缺包/缺签名、超时资源释放、原生签名错误传播，以及手动历史版本兼容。
- 设置/更新组件：3 个文件、19 项通过；验证说明先行、显式下载、稍后再打开、后台检查不替换已下载版本、保存→原生检查→安装→重启顺序。
- `pnpm typecheck`：通过。测试首次误用了 Testing Library 不支持的 `exact` 参数，已修正并重跑。
- `node --test scripts/verify-updater-assets.mjs`：5 项通过，包含实际合成 Ed25519 签名、篡改拒绝、渠道公钥与完整清单校验；不代表真实正式 Secret 已验证。
- `pnpm exec vite build`：宿主前端生产构建通过，复用已有编译后的创作依赖；没有重新构建创作模块或原生安装包，保留既有体积警告。
- `tests/visual/official-inapp-update-smoke.cjs`：9 个 Chrome 模拟场景通过，覆盖 macOS ARM/Intel、Windows、Linux 的成功操作，以及断网、签名拒绝、生成中、保存失败、安装失败的停止与重试。双主题、900/1200px；全部外部网络阻断，元数据与原生 IPC 均为合成，不执行真实下载或安装。首次脚本误用旧按钮名称，修正定位器后重跑通过。
- `actionlint 1.7.7`：两份工作流通过；`git diff --check` 通过。
- 全量宿主首次 94 个文件、791 项通过，另 2 个测试套件因独立 worktree 缺少创作包依赖目录而无法加载。补齐指向已有依赖的临时链接后完整重跑：96 个文件、807 项全部通过。依赖链接不会提交，不改锁文件或依赖版本。

日志 `/tmp/tuzi-native-updates-{tests-final,ui-tests,typecheck,signatures,build,host-tests,host-final,browser}.log`；浏览器截图和 `results.json` 位于 `/tmp/tuzi-official-native-updates/`。

## 下一步与必须完成的真实验收

需要另行授权推送本分支，再通过已存在的统一工作流触发分支上的只验签入口：

```sh
gh workflow run unified-release.yml -R tuziapi/tuzi-switch --ref codex/official-native-updates -f signing_preflight_only=true -f publish=false
```

该步骤只有签名探针，不会发布。若 runner 仍被组织计费锁定，保留失败诊断交管理员处理，不改用测试仓库。如果私钥或密码不匹配，保留现有公钥并明确停止；新信任根需要独立迁移决定，不能悄悄替换。

| 必须验证的来源 | 后续验收要求 | 本轮状态 |
| --- | --- | --- |
| 最初 v1.5.5 | 真实旧包对匹配旧公钥的新版签名清单/产物能否升级 | 未执行；不能凭代码推断成功 |
| 手动检测版 v1.5.5 / v1.5.6 | 下载并安装过渡版，核对应用身份、项目与配置保留 | 未执行；旧二进制仍需一次手动安装 |
| 包含本改动的过渡版 | 真正下载、验签、保存、安装到更高版本并重启；核对包内版本及数据保留 | 未执行；不能以合成 UI 代替 |
| 错误与平台差异 | 原生篡改拒绝/中断、安装权限不足、Windows/Linux/macOS 实机升级与恢复 | 仅合成行为验证；实机待完成 |

后续须发布严格递增的新版本，不重写同名 v1.5.6 来掩盖旧包差异。此记录不是发布完成或旧用户升级验收通过的声明。决策及回退见 [ADR-019](decisions/0019-official-native-updates.md)。
