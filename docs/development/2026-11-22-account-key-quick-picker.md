# ACCOUNT-QUICK-01：账户令牌快捷配置

## 实施

- 普通工具的兔子账户选择入口沿用现有账户 Key 配置流程，继续保留手动配置。
- OpenTu 首次图片发送在兔子账户已连接时发出异步快捷配置事件。
- 快捷窗口只展示 Key 名称、掩码、分组和模型名称；选择后通过现有原生 `bindKey` 生成不透明 `tuzi-account:<bindingId>` 引用。
- 模型目录通过账户引用请求 `/v1/models` 获取，成功后写入账户引用供应商和当前图片路由。
- 快捷配置成功后原始图片发送继续执行；取消、账户无可用 Key、模型无权限或请求失败均回到完整设置，不重放失败请求。

## 验证

- `pnpm --filter @tuzi/creative-workspace exec vitest run upstream/packages/drawnix/src/services/assistant-creation-setup.test.ts --config vitest.config.ts`：10 项通过。
- `git diff --check`：通过。
- `pnpm typecheck`：未通过，工作区依赖缺少 `localforage` 类型/模块，现有 `text-chat/attachments.ts` 报错；本轮改动未产生额外 TypeScript 报错。
- 创作工作区构建：未通过，当前共享依赖缺少 `@tailwindcss/postcss`；未进行真实账户、付费模型或生产请求。

## 边界

本轮只做本地实现、定向测试和文档记录；没有 push、PR、部署、生产数据访问或真实凭证操作。
