# V01 兔子账户视觉优化与验证

日期：2026-10-14。任务分支：`codex/account-visual-v01`，起点 `43ac2941036042453b0753f6df47d0048117448f`。本任务仅前端展示、本地验证；未提交、推送或上线。基线 B3 / desktop-v1.1 不变。

## 完成内容

依据 `docs/product-plan-v1.5/preview.html` 及 assets 预览图，统一八个账户页面的侧栏、标题、蓝色强调色、卡片边框、表格、筛选区、表单、分页和状态提示。复用现有主题变量、Button 和 lucide 图标，无新增依赖。

| 页面         | 展示优化                                                             | 最终浏览器截图（合成数据） |
| ------------ | -------------------------------------------------------------------- | -------------------------- |
| 总览         | 四项指标、当日消费图、账户信息、原始明细折叠、本机状态与已有网页入口 | [总览](overview.jpg)       |
| API 密钥     | 表格、状态标签、行操作、创建入口、双列表单                           | [密钥](keys.jpg)           |
| 调用明细     | 独立滚动表格、结果标签、选中请求、摘要卡片                           | [调用明细](logs.jpg)       |
| 模型服务状态 | 模型选择卡片、现有半小时成功率色条、原始指标明细                     | [服务状态](status.jpg)     |
| 个人资料     | 身份卡片、原有五个可编辑字段及说明、网页安全设置入口                 | [资料](profile.jpg)        |
| 模型广场     | 双列模型卡片、分组/端点/定价说明、详情                               | [模型广场](models.jpg)     |
| 充值         | 居中网页入口卡片                                                     | [充值](topup.jpg)          |
| 兑换         | 与充值统一的网页入口卡片                                             | [兑换](redemption.jpg)     |

补充截图：[密钥表单](key-editor.jpg)、[配置工具面板](configure.jpg)、[请求摘要](log-detail.jpg)、[深色日志](logs-dark.jpg)、[深色错误](error-dark.jpg)、[空数据](empty-dark.jpg)、[窄窗口](narrow.jpg)、[日语窄窗口](narrow-ja.jpg)。截图均为本地合成数据，没有真实凭证。

样式限定在 `account-*` 元素及账户配置面板内。没有修改 App 外层、工具管理、供应商组件、公共主题、请求/缓存/hooks、表单校验、权限与业务处理函数。现有普通非模态配置面板的状态、事件和动作顺序保持；表单取消文字与翻页无障碍标签作了展示修正，相应更新测试选择器。

## 验证结果

- `pnpm typecheck`：通过。
- 本次变动的账户 TSX/CSS、三种语言 JSON、visual fixture 和回归测试的 Prettier 检查：通过；`git diff --check` 通过。
- 账户、查询、工具切换及供应商兼容回归：8 个文件、61 项通过（2026-10-14 19:50 本地运行）。命令：

  ```sh
  pnpm test:unit --run tests/components/AccountPage.test.tsx tests/account tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx
  ```

- `bash scripts/build-local-preview.sh`：最终 renderer 与 macOS debug `.app` 构建通过。既有 Rust 未使用代码和前端包体积提示仍存在；没有本任务新增编译错误。
- 实际浏览器逐页检查全部八页，以及密钥创建表单、配置工具面板、请求摘要；检查 light/dark、normal/empty/error/loading/offline/disconnected、英文长文本和日语。1280×900、900×800 与 600×800 均有检查；600 宽八页无整页横向溢出，宽表格内部滚动。检查后修正侧栏长文本、深色错误对比、窄窗口侧栏、表单复选框和按钮排列。
- 最终 macOS 应用重新启动，访问八个账户导航入口；实际看到本地账户的总览、密钥、日志、模型状态与模型目录数据，并查看充值/兑换入口。原生截图：[总览](native-overview.jpg)、[密钥](native-keys.jpg)、[日志](native-logs.jpg)、[模型状态](native-status.jpg)。已切换工具管理并实际检查原供应商界面。
- 原生资料页本轮只看到网页入口，未稳定读到完整资料表单；完整资料布局已在真实 React 组件的隔离浏览器预览和回归测试中验证。自动化切换窗口时有数据/选中态延后显示的现象；原有隐藏取消请求机制可能参与其中，本轮未改请求层，也不将原因判断当成已确认缺陷。

本轮不是 G3 完整联调：未执行真实账户写入、Key 揭示/删除、工具配置写入、支付或兑换提交；未验证 Windows/Linux。不以合成截图与本地构建替代产品验收。

## 参考差异与范围约束

- 保留应用现有顶栏及“兔子账户 / 工具管理”切换，账户侧栏未合并工具导航，避免改变工具使用方式。
- 参考图的七日曲线改为当前接口原有当日窗口；金额与 quota 格式化口径不变。图形几何转换为数值，标签及明细继续使用原始精确数据。
- 模型状态保留既有“选择模型再读取质量”的流程，未新增多模型并行请求；未引入参考图中没有既有规则支持的稳定/波动判定或排序。
- 厂商、价格及模型说明只展示当前接口已有字段；没有虚构品牌映射、价格或工具配置状态。
- 资料保留五个原生白名单字段；充值/兑换保留网页入口，没有添加原生支付表单或余额刷新业务。
- 时间筛选继续使用 Unix 秒，密钥额度继续显示原始 quota；较长说明和全部已有筛选保留，通过折叠与层级改善布局。

## 本地预览

无需登录的隔离视觉预览当前运行于 <http://127.0.0.1:5191/>。从仓库目录重启：

```sh
cd /Users/syd08/Documents/tuzi-switch
pnpm exec vite --config tests/visual/vite.config.ts
```

`tests/visual` 仅导入真实账户组件并通过 Tauri mockIPC 提供内存合成数据；未被正式应用入口引用。顶部可切换主题、语言和状态。写入及外部网页动作被隔离，不能用于功能写入验收。

最终原生构建：`/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`。可在 Finder 打开，或：

```sh
open /Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app
```

原生使用已有本地网站/API 预览环境，启动依赖见 [本地预览记录](../local-preview.md)。不改动其配置与服务。工作区原有文档、Rust、脚本和产品附件的未提交修改均保留；本次交付文件未进行混合提交。

## 2026-10-15 提交前复验

用户授权保存现有 V01 改动并集成回 codex/tuzi-assistant-dev；上文未提交描述保留为历史。重新执行 typecheck、上述 8 文件 61 项回归、build:renderer 和改动前端文件 Prettier 检查，全部通过。构建仍有既有包体积及动态导入提示。本轮未重做截图或原生完整资料写入验收；配对提交及最终分支见 ../progress.md。
