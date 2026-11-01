# ACCOUNT-OPEN-01 账户页面开放

日期：2026-11-01。客户端分支 `codex/enable-hidden-features`，起点 `857c4e328f10453b8410658af461611662d02171`。仅客户端本地工作，API 未改、未访问生产账户；契约 `system-token-v1` 不变。原有未跟踪附件保留。

## 已批准布局

连接栏下方为 API 密钥、调用明细、模型广场、服务状态四个 Tab，默认密钥。四项概要仅在密钥页；移除重复页标题，币种移到密钥工具栏。不新增总览页。本次批准替代历史 Phase 1 隐藏要求。

调用明细优先表格，时间选择器及常用筛选紧凑排列，高级筛选和消费统计折叠；请求摘要进入抽屉。模型广场展示紧凑卡片，详情进入抽屉；服务状态以模型选择器和指标/趋势为主。账户设置抽屉包含资料五字段和账户分组、累计信息，未保存关闭需提示。余额卡片提供充值/兑换网站入口；独立订阅链接、本地工具状态不放入账户主页面。

## 分阶段实施与回退

1. 导航及设置接入（`69da1ed`）：新增四 Tab、按页挂载、会话内筛选缓存、账户设置及未保存提醒、充值网站入口。保留认证和业务适配。
2. 页面整理与验证：调用记录、模型和性能页紧凑布局、合成 UI 验证和回归。

每阶段独立本地提交。需要回退时按后到先 `git revert` 对应提交，不覆盖附件或重置分支。服务端未更改，无数据库或凭证迁移。

## 验证

阶段一：类型检查通过；账户定向5文件84项通过（连接、预填、密钥、业务和新导航）。新增覆盖按需请求、键盘切页、筛选保留、换账户清空、资料未保存关闭。使用合成 fixture，无真实凭证或支付；MSW 既有预填取消请求警告保留。

阶段二完成：调用明细默认今天，日期选择器输入，提交查询后应用筛选；列表/摘要同一时间范围，金额复用站点元数据与币种偏好。统计默认折叠且按需请求，复用日志统计趋势并保留按模型/错误分布；请求摘要进抽屉。模型详情进抽屉，配置操作固定底部且支持 Key 分页；性能页直接选模型及1/6/24小时，离页卸载查询/轮询。资料主动保存有重复提交保护；未保存/结果未知关闭提示保留。

最终验证命令（本机 macOS，合成数据）：

- `pnpm typecheck`：通过。
- `pnpm test:unit --run`：80文件565项通过。新增导航6项覆盖键盘、只读按需请求、筛选与分页保留、账户代次重置、抽屉关闭确认、日期范围、统计按需加载、离开性能页取消观察及窗口恢复、详情分发。既有连接/预填、Key操作/配置、账户业务与主App回归均通过。
- `pnpm build:renderer`：通过；保留既有动态导入、包体积及浏览器数据过期提示。
- 修改文件 Prettier 和 `git diff --check`：通过。
- 浏览器：`pnpm exec vite --config tests/visual/vite.config.ts --port 5217`；合成预览1280×800、760×800，浅深主题、四页、账户设置/模型详情抽屉、空模型及网络错误。1280宽调用表第一行约y399；760宽密钥首行约y598，文档宽度760，无整页横向溢出。窄表格内部横向滚动。截图见 [密钥](account-opening-evidence/keys-light.jpg)、[调用明细](account-opening-evidence/logs-light.jpg)、[性能](account-opening-evidence/performance-light.jpg)、[窄窗口深色](account-opening-evidence/keys-narrow-dark.jpg)。截图为独立账户组件合成预览，不冒充桌面原生验收。

日志 `/tmp/tuzi-account-opening-{all-tests,typecheck,build}.log`。本次仅修改前端组件、翻译、测试和文档，Rust和服务端未修改，不重建桌面安装包；真实接口、原生平台和用户验收未完成。没有使用真实账户凭证、访问生产业务或进行支付/付费调用；未 push/PR/发布。

## ACCOUNT-OPEN-02 反馈修订（2026-11-02）

用户批准执行新版方案，本节覆盖上文关于统计折叠、单模型状态和请求摘要作为主详情的旧布局。仅本地开发、验证、commit；无 push、PR、发布或生产数据操作。

### 实现

- 模型响应在查询边界规范化：兼容省略/null 的 aliases、enable_groups、supported_endpoint_types、related_pricing（含嵌套相关价格）。真正空数组保留空结果；结构异常走查询错误，不能伪装为空。页面及模型详情增加渲染隔离，Tab 仍可切换。已确认的详情崩溃是直接访问省略的 related_pricing；“11”搜索原始线上异常未捕获，现用空结果和错误响应回归验证，不宣称已复现其线上根因。
- 调用列表固定每页10条，无内部纵向滚动；顶部显示记录数/页数，底部分页显示范围、页码和跳转。换页滚动到列表起点。逐条详情展示日志ID、请求/上游ID、路径、公开错误码/消息/状态和计费、tokens、耗时。同一请求的其他记录仅在详情内按需查询，排除当前记录。
- 消费摘要保持紧凑；趋势与前5模型排行在列表和分页之后常驻展开，避免挤掉首屏请求列表。排行包含本地图标、金额、占比及全部排行抽屉；错误分类和退款分开展示。所有查询共享已应用的时间/筛选条件，日期编辑不会提前改变结果。
- 模型筛选改成搜索选项：供应商、按量/按次/按秒、协议、可用分组和更多筛选内的标签多选。选项来自完整 filter_facets；搜索支持400ms防抖及Enter，选项即选即查、可清空。移除自由输入 models。图标来自本地现有资源及模型名推断，不加载任意远端图标；未识别时沿用通用回退。详情保留价格精度/复杂定价，常见字段补中英日可读标签。
- 状态页每页6模型，宽屏两列、窄屏一列，每卡保留半小时成功率色块和无样本灰条，键盘可聚焦查看时间/成功率。通过已有POST batch接口获取当前页，1/6/24h，离页停止轮询。目录排序直接采用API全局顺序（人工优先级/新模型/公开热度等），不在当前6个模型中重新排序，不伪造缺失热度。

### 契约与源代码依据

契约 `system-token-v1`；API只读参考 `e24dec43f00722733db7264eda32afcef60fc55e`，未更改API，不代表线上部署证明。原生 Log DTO 新增可选 request_path、upstream_request_id、public_error_code、status_code，并恢复普通用户可见 error_message；旧 error_code 分类兼容保留。字段来源与网站普通用户 getUnifiedErrorLogDisplay 对齐：content、other.error_code/status_code/request_path 和顶层 upstream_request_id；不透传 other/admin_info/上游私有诊断。批量性能POST是逻辑只读，使用读取错误语义。无授权/令牌存储/工具事务变更，无数据库迁移。

### 本地提交与回退

- `2b7df3c`：模型字段兼容及错误隔离。
- `5803be7`：日志DTO、详情、消费统计和通用分页/图标样式。
- `ba26aca`：模型筛选、价格标签和批量状态页。

各阶段按逆序 git revert。最终验证记录及合成fixture另行提交；原未跟踪附件不纳入提交。

### 最终验证（2026-11-02）

- `pnpm typecheck` 通过；`git diff --check` 通过。
- `pnpm test:unit --run`：81文件572项通过。新增回归包含可选数组递归、空结果/异常目录区别、11+Enter后恢复、无完整可选字段的详情、十条日志/公开错误、六模型翻页及离页停止观察。
- `cargo test --lib tuzi_account::`：48通过、1按既有设置忽略；含公开日志投影、不透传admin_info及既有认证/凭证/工具资格回归。
- `pnpm tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`：成功，包含renderer构建与macOS debug app打包。产物 `src-tauri/target/debug/bundle/macos/兔子助手.app`。既有chunk体积/依赖数据库过期及Rust未使用项警告未阻断构建。
- 浏览器合成验证：宽窗口、720px深色单列状态，11搜索回车空结果及恢复、计费选项、缺省字段模型详情、模型排行抽屉和常驻统计。截图 `account-opening-evidence/{logs-refinement,statistics-refinement,status-refinement,status-refinement-narrow-dark}.png`。预览 `http://127.0.0.1:5217/`，只使用合成IPC，不连接生产账户。
- 日志 `/tmp/tuzi-account-refinement-final-{full,build}.log`、`/tmp/tuzi-account-refinement-native-all.log`。代码、单元测试及本地构建完成；真实账户联调、Windows/Linux WebView及用户验收未宣称完成，无远端发布。

## ACCOUNT-OPEN-03 展示精简（2026-11-02）

按用户五项反馈执行，仅React/CSS变动，API、原生、权限、凭证和工具事务不变。

- 调用消费摘要和账务说明移到列表下方的常驻消费统计内，摘要使用紧凑底色区；列表前不再堆叠统计内容。
- 模型广场标签直接列在筛选行，移除仅含一个字段的更多筛选，以及“当前桌面账户可见价格…”提示。搜索/查询/刷新同一行，选择项统一高度和样式；窄窗口用等宽网格，长值省略并保留完整提示。
- 状态页使用相同筛选布局，时间窗口融入筛选行，保留6模型分页、接口筛选、全局排序及成功率色块。
- 模型详情分为图标与说明、接口/可用组标签、价格卡片、折叠技术明细。价格和定价字段保留，不计算替代服务端价格；配置密钥及操作保持固定底部。
- 账户设置按钮与挂载入口暂时隐藏；设置组件保留，独立未保存保护仍有回归覆盖，无资料请求或写入。

验证：`pnpm typecheck`通过；账户导航/业务/AccountPage三文件68项测试通过；`git diff --check`通过。合成浏览器检查宽窗口日志首屏、模型筛选、详情及状态页，720px筛选等宽换行；证据 `account-opening-evidence/model-detail-polish.png`、`model-filters-polish-narrow.png`。构建结果见本节后续记录。未进行真实账户业务联调或跨平台验收。允许本地commit，不推送或发布；原未跟踪附件保留。

最终 `pnpm tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'` 成功，日志 `/tmp/tuzi-open03-final-build.log`；定向测试日志 `/tmp/tuzi-open03-tests.log`。已重启本地桌面构建并置前，确认四Tab存在、账户设置入口隐藏；没有开展真实账户写操作或完整业务联调。构建保留既有chunk体积及未使用项警告。
