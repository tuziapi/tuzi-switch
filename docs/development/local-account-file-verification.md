# B13 本地账户文件与 Codex 隐藏环境变量（2026-10-19）

## 授权与版本

用户明确“保存为一个配置文件，而不是修改授权流程”，并确认环境变量表单一起修改。代码提交 `d7b41dcdbae715d9ece2762753ae339c16e8a8ff`；配对未修改API HEAD `21cd7acd51349407cdc5d332a763907d065f9a86`。两仓均为 `codex/tuzi-assistant-system-token`，契约 `system-token-v1` 不变。

开始客户端HEAD为c5d70cc6837706a76181b78c0c4f92d18705a39a；期间另一既有工作提交B12成功提示跟进，落地代码基于49e7463f8058908f60faa6f674011e0d9a1d9fa9。保留已有Codex账户Key预填、business.rs合成fixture、测试、文档和outputs；本任务只分段提交自身变化，没有把已有预填补丁混入提交。测试与产物使用完整工作树，包含这些既有补丁，不能声称干净代码提交单独验证了先前预填修复。

## 交付

- 原生账户LocalFileStore替代SystemStore/keyring。账户启动、连接、恢复及断开不再调用钥匙串；未修改系统钥匙串权限或签名流程。旧条目不读取/迁移/删除，用户首次更新需重新粘贴系统令牌。
- 明文JSON存于系统用户本地数据目录的com.tuziswitch.desktop/account；预览为com.tuziswitch.desktop.preview/account。文件名为origin与client的SHA256，记录继续校验版本/站点/client。macOS/Unix目录0700、文件0600，原子替换、大小限制及符号链接拒绝；Windows继承用户本地目录ACL，尚未实机验证。
- 文件独立于可迁移配置、SQLite和工具配置。核查WebDAV仅打包SQL/Skills、供应商备份只包含明确工具写集；不包含账户文件。普通IPC、日志和错误不返回凭证。退出写空v2记录，不轮换网站令牌。
- 仅Codex新增/编辑移除环境变量输入与说明，不移到高级设置；底层env_key与原始TOML仍保留。新配置实时读取已用变量并自动避重；编辑引用前后端保留；旧缺失配置保存时分配独立变量并保留自身Key，不凭空读取OPENAI_API_KEY。原生保存失败不再吞错后提交空凭证。
- 保留Claude认证选择、Gemini.env编辑和其他工具机制。中文/英文/日文存储错误文案改为文件读写错误，旧IPC错误码保持兼容。

## 本地验证

本机macOS，命令与结果：

```sh
pnpm typecheck
pnpm exec vitest run tests/utils/codexFormEnvKey.test.ts tests/components/ProviderForm.hiddenEnv.test.tsx tests/components/ProviderForm.test.tsx tests/hooks/useCodexConfigState.test.tsx tests/components/TuziProviderDialog.test.tsx tests/components/AccountPage.test.tsx tests/account/account-query.test.tsx
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account:: -- --test-threads=1
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib services::provider:: -- --test-threads=1
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib actual_frontend_form_payloads_save_and_restore_all_seven_tools
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh
git diff --check
```

- 类型检查通过；前端7文件47项通过。最终将失败处理明确限定在Codex后，相关2文件7项和类型检查再次通过。覆盖隐藏字段、新增与本地env重名、编辑保留原名、旧配置缺失补齐、原生保存失败保留输入及账户/来源既有回归。
- 账户原生35通过、1默认忽略（真实Go合成服务全业务配对，本轮未重跑）。新增真实临时文件测试覆盖私有权限、损坏/超长、失败保留旧文件、符号链接拒绝、站点/client隔离，以及Rust合成HTTP账户连接→新实例重启恢复→断开→再次重启。只使用合成值，不读取用户钥匙串或实际凭证。
- 供应商原生29通过；包括新回归验证编辑时修改端点/路线、共享旧变量名仍保持原引用且不迁移密钥。七工具原生1项循环验证隔离保存和恢复通过。
- renderer和macOS debug app构建通过；路径 `/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`。源码来自指定system-token目录，共享构建缓存。日志 `/tmp/tuzi-b13-*.log`；已有CodeMirror/jsdom测量、MSW未匹配请求、chunk体积及原生未使用项警告保留，不宣称全仓全绿。
- 原生实际UI：重启前确认仅工具列表无未保存表单，正常退出旧预览并打开新包。账户页直接显示“未连接”，未见钥匙串弹窗；Codex新增表单从模型直接到API Key，独立环境变量名和说明已消失，原始配置env_key保留。取消核验表单，没有保存任何工具配置，首次核验后停在账户连接页。本助手未输入令牌或执行首次连接；收尾再次启动最终包（21:06:01）后，实际账户页已自动恢复本地合成管理员连接，未见钥匙串提示。仅核查凭证文件元数据：存在，21:00:44已保存，文件0600、父目录0700；没有读取或输出文件内容。

代码完成、定向自动测试和本机构建通过；UI已验证首次启动/无旧钥匙串自动读取/新增字段移除，并观察到最终包重启后从已存在本地文件恢复合成账户。首次连接输入过程未由本助手操作或录制；所有历史配置编辑、Windows/Linux权限/安装包与正式发布未验收；隔离文件和HTTP测试不替代这些实机门禁。没有push、PR、部署、生产访问、真实凭证录制或付费模型调用。

## 回退

代码可单独revert `d7b41dcdbae715d9ece2762753ae339c16e8a8ff`，保留用户文件/旧钥匙串及已有改动。B13文档在共享工作区收尾时被另一工作的文档提交 `df34c77` 一并纳入；该提交同时包含供应商标题验证资料，不可整笔revert，文档回退需仅选择B13相关改动。旧版本可能重新读取旧钥匙串连接；回退前需核对旧账户状态，不声称新版断开会删除旧钥匙串条目，也不自动轮换网站令牌。

## 收尾并发核查

本任务完成代码提交后，同目录另一工作提交了 `80354e6`（供应商字体）与 `df34c77`（字体文档及已暂存B13文档）。已核对：B13代码仍独立位于d7b41dc，文档内容完整；未重写对方提交或回滚其字体改动。最终工作区仍只保留原有预填/fixture/测试/文档及outputs。产品构建使用当前工作树，不能将其他工作的字体UI验收归入B13功能验收。
