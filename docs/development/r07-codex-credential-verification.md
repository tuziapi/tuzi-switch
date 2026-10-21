# R07 Codex账户供应商凭证读取（2026-10-21）

用户授权制定并执行本地修复、重新构建和打开客户端。任务只修复“API Key not found”，不取消测试目录隔离，不改已暂缓的搜索清空，不执行push/PR/发布。客户端起点 `0f5964c4652f189d8d529f56b937e4695a101e38`，分支 `codex/tuzi-assistant-system-token`；API同名分支 `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425` 未改。B4 / system-token-v1保持。

## 根因与方案

账户草稿及旧供应商迁移生成 `TUZI_SWITCH_<标识>_CODEX_API_KEY`，避重时追加 `_1`（前端）或 `_2`起（原生迁移）等后缀。账户事务写入Codex `.env`，再清空数据库内联auth。模型检查/代理共用 `resolve_codex_auth`，其旧规则只接受TUZI/CODING编号族，同时通用规则排除所有TUZI/CODING前缀，因此拒绝了应用自己生成的独立引用。

新增专用名称识别：固定前后缀，标识为ASCII字母/数字/下划线且至少含一个字母或数字，可选避重尾号为无前导零的正整数。引用资格与缓存门共用此识别。独立引用和普通自定义引用一样可用于其供应商配置地址，兼容既有第三方供应商迁移；旧TUZI/CODING编号族仍保留原地址限制。

不放开所有TUZI前缀，不扫描其他凭证、不回退任意shell环境、不将Key重新放入数据库。读取只在当前Codex目录 `.env` 中查找显式引用，大小/占位符/控制字符/文件变化/缓存限制保留。已有供应商不改名、不迁移、不重写Key，修复生效后可直接重试模型检查。缺失或无效Key仍失败；本次只处理被错误拒绝的合法引用，不掩盖其他网络/模型错误。

## 验证（macOS，本地合成数据）

- `cargo test --lib proxy::providers::codex`：58通过。新增账户随机标识、迁移标识、两类避重后缀、旧路由/第三方地址和非法名称矩阵；已有缓存/缺失/读取失败/占位符测试保留。
- `cargo test --lib services::tuzi_provider`：14通过。增强真实保存事务：两个供应商使用不同合成Key，保存后数据库auth为空，生产异步认证函数分别读取正确Key；备份恢复及无关状态保留。
- `cargo test --lib services::stream_check`：31通过。
- `cargo test --lib services::provider`：29通过。
- `pnpm typecheck`、`git diff --check`通过；`pnpm tauri build --debug --bundles app --config /tmp/tuzi-r07-build.json`通过（包含renderer构建），保留既有体积/dead_code提示。

首次增强用例因合成第二条Key缺少现有保存校验要求的 `sk-` 前缀被拒绝；修正合成fixture后通过，未放宽生产Key规则。未读取用户真实Key、没有发起真实模型请求，不声称实际付费调用或三平台验收通过。沿用R02既有全库历史恢复失败限制，本轮未重跑无关全库。

## 测试包与回退

R07产品名称用于区分二进制；沿用R06 identifier `com.tuziswitch.desktop.r06test`，Info.plist LSEnvironment指定 `CC_SWITCH_TEST_HOME=/Users/syd08/Library/Application Support/com.tuziswitch.desktop.r06test/home`。因此保留用户R06已保存的测试账户/供应商，无需复制或读取凭证。构建后本地ad-hoc签名并检查；关闭旧R06进程后启动R07，避免两个实例共用测试数据库。该包仍不会切换日常 `~/.codex` 配置，不是公证发布包。

回退可revert本任务独立提交；没有API/数据迁移，凭证文件不变。回退代码会恢复此读取缺陷，不删除用户测试数据。实际模型检查请用户在R07中对已有卡片重试；代码通过不等于实际模型服务可用或发布完成。
