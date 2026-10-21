# R03 Codex 模型列表语义纠正

2026-10-21；在客户端 `codex/tuzi-assistant-system-token` 的 R02 提交 `0a361a7` 上继续修复。用户实际截图证明 R02 未通过模型完整性验收，此记录修正之前合成验证的适用范围。API 不修改，未 push/PR/发布。

根因：手动模型列表直接显示 `/v1/models`，配置到工具仍按 Responses 协议元数据过滤。图片等非四类工具协议又被归为未知，造成额外禁用条目。R03 Codex 直接展示 Key 全部模型、显示总数，不加协议禁用标签；保存也同步只对 Codex 放开协议元数据门槛，仍检查 Key 及模型成员资格。Claude/Gemini 等不变。见 ADR-012 的 R03 追加决定。

验证：`pnpm typecheck` 通过；`pnpm exec vitest run tests/account` 5文件96项通过；`cargo test --lib tuzi_account` 42通过、1项真实Go配对测试按原条件忽略。新增回归用非 Responses 标签的新模型验证132项完整显示、选择6-astra后可继续；原生验证 Codex 非Responses元数据可保存，但缺失模型和列表错误仍拒绝，其余工具继续拒绝不匹配协议。未读取用户真实 Key 或发起模型调用。沿用 R02 全库历史恢复测试失败限制，本轮未重跑无关全库。

本地构建命令：`pnpm tauri build --debug --bundles app --config /tmp/tuzi-r03-build.json`；产物 `src-tauri/target/debug/bundle/macos/兔子助手 R03 测试.app`，使用独立 identifier `com.tuziswitch.desktop.r03test` 与 CC_SWITCH_TEST_HOME `/Users/syd08/Library/Application Support/com.tuziswitch.desktop.r03test/home`，连接正常 API。产物 Info.plist LSEnvironment 设置后本地 ad-hoc 签名，不覆盖正在运行的 R02 或其编辑草稿。实际 Key 的28项一致性仍需用户在同 Key、同接口地址下验收。
