# UC-SYNC-54：账户四页工作区同步

用户要求将正式仓库 PR #54 最新特性同步到 opentu 集成分支。同步前工作区干净，分支 `codex/opentu-assistant-sync`，HEAD `e970eb984b7f59f4053df2c5113e783071938044`。PR 已于 2026-11-02 合并，上游最终提交 `4f1653578b35f2588697f67bf136efcce613c70b`，对应 PR head `c14df7170469376869f3fc13f937b1e0f6d12217`。

本地 merge 保留双方历史。唯一冲突为开发入口顶部记录，保留双方内容；业务源码自动合并。同步四个账户页面、日志公开字段、分页、分组价格及复杂计费回退网站等最后修订。账户设置仍隐藏，opentu 配置关联、创作运行时、系统令牌存储和来源验证保留，system-token-v1 不变。未修改 API 仓库。

## 验证

- `pnpm typecheck` 通过。
- `pnpm exec vitest run --maxWorkers=2 --minWorkers=1`：87 文件、625 项通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --features isolated-profile tuzi_account:: -- --test-threads=1`：58 项通过、1 项按既有配置忽略。包含日志公开投影与测试包线上账户协议校验。
- 四个账户 Tab 在 1200/720 宽度下正常挂载，无页面脚本错误或文档横向溢出。集成宿主能从账户切入 opentu 并打开创作配置，保留兔子账户和手动配置。仅合成数据，阻断外部请求。首次检查使用不适用于当前弹层的 role=dialog 选择器超时；根据实际弹层内容复核通过，未改产品源码掩盖此情况。
- `pnpm tauri build --debug --features isolated-profile --bundles app --config src-tauri/tauri.acceptance.conf.json` 通过。产物 `src-tauri/target/debug/bundle/macos/Tuzi Assistant Test.app`，标识 `com.tuziswitch.desktop.acceptance`，编译特征 default/isolated-profile；二进制包含线上账户地址，不含本机 5180 地址或模拟账户客户端标识。
- 日志 `/tmp/tuzi-pr54-sync-{typecheck,tests,native,build}.log`；截图 `/tmp/tuzi-pr54-sync-{account,creative}.png`。

## 本机账户连接问题

用户此前打开的是 `com.tuziswitch.desktop.creative.preview` 调试包。二进制包含账户地址 `http://127.0.0.1:5180` 和 `tuzi-switch-desktop-test`；本机 5180 端口没有服务，因此账户检查离线。该包用于早前合成验收，不能作为线上账户验收包。线上公开状态接口无凭证探测返回 HTTP 200，不等于真实账户登录通过。

本轮重新构建使用 isolated-profile 而非 local-preview，继续隔离账户与工具配置目录。没有复制、读取或迁移真实账户令牌；用户需在独立测试包中自行连接账户。旧应用和数据保留。

本记录仅证明本地同步、合成回归和 macOS 构建；未将本次改动推送到测试 main 或远端 PR，未更新公网下载页。真实账户、跨平台及既有上线门禁仍需分别验收。
