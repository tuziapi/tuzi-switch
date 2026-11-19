# CL-GATEWAY-ROUTES-1119：A 方案本地真实验收

后续状态：用户于 2026-11-19 亲自测试并确认“还可以”，明确授权正式发布。以下内容保留本机验收时的证据范围；正式候选、跨平台升级与公网交付状态以 [v1.6.3 发布记录](2026-11-19-v1.6.3-release.md) 为准。

## 结论与范围

2026-11-19 用户选择 A：保留 GPT 等原有模型，先验证内部路由编号与真实显示名。Mac ARM 本地候选已安装，11 模型选择、Code 多轮、Cowork 多轮及文件任务、两次宿主与 Claude 冷启动续聊均通过。`macGatewayRoutingVerified=true`，`customerReady=false`；Windows 客户实机、跨平台发行包和分发信任未验收，本轮没有发布。

源码基于 `8fe9414d714960912ba6447b40e2773c053ed486`，工作区 `codex/opentu-gateway-beta4`，含尚未提交的目录绑定及本轮路由修复。设计见 [ADR-024](decisions/0024-claude-gateway-route-identifiers.md)。没有服务端接口变更，没有自动迁移或重写供应商映射。

## 本机候选与保护

- 当前安装 `/Applications/OpenTu 验收版.app`，原生版本 `1.6.3-beta.5+routes.1119`，身份 `com.tuziswitch.desktop.opentu-preview`。本地 Debug、ad-hoc 签名、无公证；前端版本仍来自 package.json 的 beta.5，不可与公开 beta.5 原包混同。
- 主程序 SHA256：`042ad65c9a27e80d791a5da6c702e97af66cb01878c9e6a3e454a0742f58ffaf`。`codesign --verify --deep --strict` 通过。
- 正常退出两端后备份旧 app、配置及 SQLite 一致性快照到 `~/Library/Application Support/Tuzi Local Backups/beta5-routes-local-20261119-114203`，备份和最终数据库 `integrity_check=ok`。安装采用暂存目录和原 app 保留副本。
- 正式兔子助手仍为 1.6.2，主程序摘要仍是 `64c41bdd071736bd5e836a06050183c872e3e2587ab484725298ebb390e87b0d`；个人 Claude/Claude-3p 五份配置摘要未变。未修改官方 Claude.app，未安装根证书或关闭 TLS 校验。

## 验证证据

1. 原生 `cargo test --lib --features claude-desktop-local,opentu-preview claude_desktop_ -- --test-threads=1` 最终 20 项通过。覆盖编号稳定性、独立路由、显示名不遮蔽真实模型、静态配置到实际请求映射、未知路由拒绝、旧路由与 1M 兼容。日志 `/private/tmp/beta5-gateway-route-tests.log`。
2. `pnpm tauri build --debug --features claude-desktop-local,opentu-preview --bundles app --config src-tauri/target/claude-local-runtime/aarch64-apple-darwin/opentu-gateway-local.conf.json` 成功，使用此前已完成的渲染产物，本轮无前端代码变化。日志 `/private/tmp/beta5-gateway-route-build.log`。`scripts/check-preview-gateway.py` 与 `git diff --check` 通过。
3. 宿主继续显示模拟客户端模式、“兔子coding”、11 模型。检查并应用后启动官方 Claude 5.11492.5，配置警告消失，模型菜单完整显示原 11 个真实模型名称。
4. 本地鉴权 `/claude-desktop/v1/models` 返回 HTTP 200，11 项 ID/显示名与 `inferenceModels` 的 name/labelOverride 逐项一致。第一次探针直接使用 Claude 已加密保存的配置值返回 401；随后使用宿主已有网关令牌完成验证，没有降低鉴权或解密/打印凭证。
5. Code 在专用合成目录 `/private/tmp/tuzi-gateway-acceptance-1119` 使用 gpt-6.1-sol：首轮返回 `TUZI-ROUTES-1119-OK`；第二轮返回 `7319 MULTITURN-OK`；正常退出宿主和 Claude，重新启动并打开同会话后返回 `7319 RESTART-OK`。没有读取用户业务文件。
6. Cowork 初次因可用空间不足未进入任务。官方安装所需空间为 16106127360 字节；通过 cargo dry-run 核查后清理可重建的宿主 dev 编译产物 3.1 GiB 及未打包二进制副本，使空间超过 15 GiB。保留源码、依赖、正式安装、历史数据和回退备份。官方随后完成 VM 准备；最终可用空间约 8.33 GiB。
7. Cowork 使用 gpt-6.1-sol 首轮返回 `TUZI-COWORK-1119-OK`；第二轮创建 `routes-acceptance.txt`，返回 `8426 COWORK-MULTITURN-OK`。原生文件预览与磁盘内容均为 `SYNTHETIC TUZI COWORK FILE OK.`（含末尾句点，与提示一致）。
8. 再次正常退出两端并重启，Cowork 历史、模型、文件均保留；要求只读取该合成文件后，界面显示实际 Read a file 调用，返回 `8426 COWORK-RESTART-OK SYNTHETIC TUZI COWORK FILE OK.`。
9. 宿主请求日志确认内部数字编号被映射为实际 gpt-6.1-sol，流式/非流式请求均 HTTP 200。最终核查内部编号请求共 20 条：gpt-6.1-sol 流式 14、非流式 3，codex-auto-review 非流式 3；包括客户端自动探测和辅助请求，不把它们全部计作人工对话。没有把密钥或完整请求体写入验收记录。

## 限制与交付状态

本次证明本机官方客户端可用该兼容路由完成真实业务，不表示官方保证支持其他模型，也不保证后续客户端升级持续兼容。没有逐一对话测试全部 11 个模型；Code/Cowork 主要验收模型为 gpt-6.1-sol。其他工具真实账号、Windows 实机、正式签名/公证与自动更新仍需独立验收。本地候选留在桌面供用户测试，修复尚未提交、推送或发布。
