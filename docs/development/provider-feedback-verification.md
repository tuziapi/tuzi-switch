# B15 账户配置定位、线路命名与连接反馈

日期：2026-10-19；基线 `TA-AC-1.5-B4` / `system-token-v1`。
用户本轮三项需求直接授权本地实施。客户端 `/Users/syd08/Documents/tuzi-switch-system-token`，API `/Users/syd08/Documents/tuzi/tuzi-api-system-token`，均 `codex/tuzi-assistant-system-token`。无 push、PR、部署、生产数据或模型调用。

## 实施和原因

- 原定位使用向外偏移4px的2px outline，而且 App 长期保留定位 ID；改为卡片内1px细边及6%主题色背景，100ms布局等待后滚动一次，提示在2.4秒内淡入/保持/淡出，并清除 App 请求。等待异步列表可用，清除搜索阻挡；列表数据引用变化不重放，重复查看可再触发，切换视图/工具取消旧定位。减少动画时使用自动滚动、静态短暂提示。实际供应商启用状态仍由原有逻辑展示。
- 新建草稿展示名使用 `兔子线路-${draft.name.trim()}`，空名回退 `兔子线路`。用户仍可编辑名称；不批量重命名旧卡。Codex 内部路由名保持原固定值，不把任意密钥名称插入 TOML；独立 env 索引和七工具保存事务保持。
- `account_retry` 原生会用已保存令牌重新请求身份，有实际用途。入口改为“检查连接”，加忙碌提示和同步点击锁。Hook 返回经过现有事件/代次保护后的状态；UI 只对有身份且无错误的 connected 显示成功。离线/失效/断开及 IPC 失败显示安全错误提示；不显示原始错误消息。已换代/卸载结果不报成功。中英日文案同步。
- 没有重新加入保存后的“恢复配置”按钮或返回账户提示。没有修改 API/IPC 协议、账户凭证保存方式、原生供应商写入语义。

## 代码配对与工作区

客户端代码提交 `91ba068863df9ba369ce67807d2eb9e1e5a9dfab`，起点 `849d0237f3fe04359e0886cb6ed1a262f0488c99`；API `21cd7acd51349407cdc5d332a763907d065f9a86`（本轮未改动、干净）。配对为本地源码记录，不证明部署。

开始时已有 B09/B11/B13 相关文档、business.rs、ProviderForm、useCodexConfigState 及对应测试等未提交改动和 outputs/，全部保留且未纳入本提交。本轮测试/预览使用包含这些已有修复的当前工作树，不声称仅 checkout 本提交即可复现完整环境。

## 验证

- `pnpm typecheck`、`git diff --check` 通过。
- `pnpm test:unit --run tests/components/ProviderList.test.tsx tests/components/AccountPage.test.tsx tests/components/AccountTokenPrefill.test.tsx tests/components/TuziProviderDialog.test.tsx tests/account/account-query.test.tsx tests/integration/App.test.tsx`：6文件62项通过。覆盖定位超时/重复/异步加载/刷新不重放/卸载/减少动画、实际七工具表单名称与保存载荷、空白与特殊字符名称、连接成功/离线/失效/断开/IPC失败/重复/迟到结果及原账户导航。补充滚动模式断言后 ProviderList 7项再次通过。
- Rust：`CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --lib actual_frontend_form_payloads_save_and_restore_all_seven_tools`：1项通过，使用七份实际前端载荷在临时目录完成保存/恢复。
- `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh`：renderer + macOS debug app 构建通过。保留既有浏览器数据/包体积/原生未使用代码提示；组件测试已有 account_cancel_token_prefill 未匹配 MSW 警告。
- 初轮失败来自旧 ProviderList 测试替身缺少 matchMedia 方法，以及 App 测试仍读取旧 prop。已更新替身和断言并重跑通过，不把失败轮算通过。

## UI分层证据

隔离实际 ProviderList/ProviderCard 页面 `tests/visual/provider-locate.html`，全部合成数据、原生 IPC mock。IAB 实测浅色、深色、360px卡片长名称换行、再次定位与自然消退；DOM确认外部 outline 为 none，内部淡背景及动画生效，超时后定位属性为0。截图只证明视觉，不作为原生保存联调。

- [浅色定位](provider-feedback-evidence/locate-light.png)
- [深色窄卡片](provider-feedback-evidence/locate-dark-narrow.png)

确认原生应用没有未保存表单后，正常退出旧进程，重新打开最终 `.app`：`/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`。本地合成管理员 `preview-admin` 点击“检查连接”，通过真实原生/本地API返回并出现“连接成功，兔子账户可正常访问”。[原生成功提示](provider-feedback-evidence/connection-success.png)。未修改或保存实际用户工具配置。

macOS本地连接成功路径通过；网络失败/失效路径为组件测试，未切断正在使用的本地API。未宣称本轮在原生窗口完整重做七工具新增/启用联调，未调用模型或验证其他操作系统。用户对视觉的最终验收待完成，未发布。

## 回退

可单独 revert B15 代码和文档提交，恢复原定位/命名/反馈行为；不清除账户本地文件，不轮换令牌，不删除供应商或恢复工具数据。API不需配套变更。
