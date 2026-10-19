# B17 提交前审查修复（2026-10-19）

用户授权：只修复审查第 1 项（删除成功但响应丢失后无法回读解除门禁）和第 3 项（4 个以上模型的工具配置保存被 API 拒绝）；第 2 项空分组问题明确不修改。任务范围为本地实现和验证，用户自行后续整理提交；未 commit/push/PR/部署、操作生产或调用付费模型。

## 代码范围及配对

两仓分支均为 `codex/tuzi-assistant-system-token`，基线 B4 / `system-token-v1`。本轮基准 HEAD：客户端 `44a809125bf1f42de1b06ff5ecbce81b531c9ce3`，API `21cd7acd51349407cdc5d332a763907d065f9a86`；修复为这两个 HEAD 上的工作树增量，尚无最终提交 SHA。客户端已有 9 个未提交文件及 outputs 图片均保留，包含默认关闭的 local-preview 夹具及 Codex Key 回填修复；不混称本轮新增内容。

- API `GetToken` 仅对归属查询的 `gorm.ErrRecordNotFound` 增加 `error.code=not_found`，HTTP200/success/message 保留。已删除、不存在和他人 Key 返回同一语义，不泄露他人 Key 是否存在。数据库错误和非法 ID 仍为失败，不添加不存在码。
- 客户端删除未知结果回读识别原生返回的 `not_found`，仍兼容404；先展示回读结果，再由用户确认解除写入门禁，不自动重发 DELETE。任意业务失败不可当成删除成功。
- 原生工具资格查询按每批最多3个模型串行发送；多批固定首批 snapshot_id，每批完整校验 Key/分组/协议，缺失、刷新或跨快照拒绝。保留最多50个模型、请求前后代次检查、来源证明及七工具本地事务。最后一批失败或断开账户均不得进入保存。

## 验证

本机 macOS；所有测试只用内存、临时文件或隔离合成 SQLite/loopback HTTP。

- `pnpm test:unit --run tests/account/desktop-business.test.tsx`：28通过。未知创建/编辑/启停/删除的失败回读仍锁定；删除同时覆盖HTTP200/not_found和旧404，确认前不解锁，无重复写请求。
- `cargo test --lib tuzi_account`：40通过、1既有真实Go配对用例默认忽略。新增本机HTTP测试覆盖200/not_found与普通失败区分、3/4/50模型、后续批缺模型/协议或分组不符/HTTP失败、快照缺失/变化/刷新、批次间退出账户。
- `go test ./controller -run 'TestGetTokenRecovery|TestGetTokenMasksKey' -count=1`：通过。覆盖本人存在、他人、缺失、删除、非法ID及数据库故障；原掩码响应保持。
- `pnpm typecheck`、改动TS/TSX的Prettier检查、Rust改动格式检查及两仓diff检查通过。

- 扩大 API 回归 `go test ./controller ./middleware ./router -count=1`：3 包通过。
- 扩大客户端回归 `pnpm test:unit --run tests/account tests/components/TuziProviderDialog.test.tsx`：6 文件、112 项通过；测试输出保留既有 React 组件警告，无失败。
- 工具保存回归 `cargo test --lib services::tuzi_provider`：14 项通过。

未重新构建或重启用户预览应用，未声称完整真实 Go→Rust→UI 联调或三平台/生产 MySQL/PostgreSQL 验收；原生新增网络测试使用合成 Axum HTTP 服务，Go语义另由真实controller/SQLite测试验证。

## 兼容与回退

接口为向后兼容的符号错误字段扩展，不改变路由、权限、数据库或价格查询上限。旧网站/其他OAuth按success/message仍正常；新客户端连接旧API时，删除未知结果仍可能无法完成确认，故后续上线须先API、再客户端。多模型分批对当前API独立兼容。

本轮未改登录授权页、令牌存储、支付、模型调用、空分组处理、临时夹具开关及已有工具写入语义。接口契约、任务和跨仓库兼容记录同步更新。未来回退优先客户端修复，再API扩展；无迁移/数据清理/令牌轮换。提交后按对应独立提交revert，未提交时只撤本轮差异，不覆盖已有工作树。
