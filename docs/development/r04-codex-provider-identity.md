# R04 首次添加保留 Codex provider 标识和名称

2026-10-21，用户批准统一修复普通线路、订阅线路和第三方 Codex 线路。客户端分支 `codex/tuzi-assistant-system-token`，基于 R03 `e17fa01`。API 工作树干净，HEAD `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425`，未修改或部署；本轮无 push/PR/发布。

## 决定与实现

首次添加原先按地址/旧名称/环境变量识别线路并强制编号，覆盖 model_provider、对应表名与name；编辑已有凭证时走不同分支。现在规范化只处理凭证绑定和必要的独立索引分配，不再改 route/name，也不凭 `codex` 名称判断订阅线路。通用落盘函数仅在 name 缺失时填默认名称，保留显式 name。既有绑定保持，新增有效且未占用的独立环境变量引用保持。

保存前后检查标识归属：其他供应商卡片占用同一标识时明确拒绝（即使当前内容相同，也避免后续编辑共享同一线路）；未归属当前卡片的实际配置段内容不同时拒绝覆盖。检查在凭证迁移和写入前执行，保存路由命令使用供应商操作锁；前端对标识/凭证索引冲突展示具体原因。拒绝冲突是对原静默覆盖/重命名行为的有意替代。

默认生成与用户编辑分离：兔子/订阅预设在选择模板时使用其已分配编号；账户入口在生成初始草稿时生成独立 tuzi-随机后缀标识和环境变量，不再重复使用custom。用户此后修改草稿，保存尊重该修改。其他工具保存语义不变。未知配置段、MCP 保留；不重写用户已有卡片，不自动清理历史冲突。

## 验证

- `pnpm typecheck` 通过。
- ProviderForm、真实CodeMirror、Codex hook、配置校验及账户 tests/account：9文件109项通过；新增独立草稿标识/凭证回归1项通过，合计110项。
- `cargo test --test provider_commands save_codex_route -- --test-threads=1`：3项通过。其中新增三地址循环：首次保存路由→ProviderService添加→读取数据库和真实config.toml→再次更新，确认codex标识、自定义name、MCP均保留；冲突前后文件与shell rc字节保持不变。
- `cargo test --lib services::provider`：29项通过；`cargo test --lib codex_config`：67项通过；`cargo test --lib services::tuzi_provider`：14项通过，包含七工具事务备份恢复、第二条Codex卡片保留第一条凭证。
- `git diff --check` 通过。此前R02记录的全库历史恢复测试失败仍是已知限制，本轮不声称全库测试通过；实际用户验收待完成。
- `pnpm tauri build --debug --bundles app --config /tmp/tuzi-r04-build.json` 成功，含renderer构建。已有构建体积/浏览器数据和Rust dead_code警告保留。

## 本地测试与回退

产物 `src-tauri/target/debug/bundle/macos/兔子助手 R04 测试.app`。独立identifier `com.tuziswitch.desktop.r04test`，Info.plist LSEnvironment 的 CC_SWITCH_TEST_HOME 指向 `/Users/syd08/Library/Application Support/com.tuziswitch.desktop.r04test/home`，本地ad-hoc签名，普通构建连接真实API。需重新连接账户；不关闭或覆盖R03编辑草稿。使用合成回归，不读取真实凭证、不发起模型调用。

只回退客户端修复提交，无服务端部署/数据库迁移。保留测试目录和用户数据，不自动改回用户已保存的自定义标识。

## R08 后续替代（2026-10-21）

用户已批准允许跨卡片重复 provider ID。本记录中的全局唯一拒绝及未启用预注册规则由 [ADR-013](decisions/0013-codex-card-local-provider-ids.md) 替代，R04 其余历史事实保留。
