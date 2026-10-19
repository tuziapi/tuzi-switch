# B09 账户体验改进验证记录

2026-10-19，基线 `TA-AC-1.5-B4`，契约 `system-token-v1`。本轮执行用户批准的九项账户体验需求；代码与定向验证完成，局部真实 UI 通过，完整手工验收有下述限制，未发布。没有更改 HTTP 路由、数据库 schema、付费调用或生产配置；仅开放用户指定的单 Key 配置入口，其他隐藏页面保持隐藏。

## 两仓配对与工作区保护

| 仓库 | 目录 | 起点 SHA | 本次代码提交 |
|---|---|---|---|
| 客户端 | `/Users/syd08/Documents/tuzi-switch-system-token` | `9a6a0af6606dd5c2c336b1d8940408895b3970ba` | `1bfb98bb76eaacfd03b467cf3232406cbc7149de` |
| API/网站 | `/Users/syd08/Documents/tuzi/tuzi-api-system-token` | `11e14cb511607c91f9af9bf9e97ba1c785f93bd1` | `924cd70711daf852c18ff513394300808ac1c668` |

两仓均在 `codex/tuzi-assistant-system-token` 修改及本地提交；后续文档提交只记录此代码配对，不循环把自身 SHA 写入自身。原有客户端 `tests/config/opencodeProviderPresets.test.ts` 修改未改动、未暂存、未提交，SHA-256 保持 `dac1a3c2b9ae4b34a3b212fb01ece1329255986527cb0cbc1bf67515e42f9904`。无 reset/清理、push、PR、部署、生产操作或真实凭证。

## 九项需求对应结果

| 项 | 交付 | 证据 |
|---|---|---|
| 1 | 网站说明精确改为“用于API调用的身份验证令牌，可以用此连接兔子助手，请妥善保管” | 网站组件测试、实际安全卡片截图 |
| 2 | 仅助手引导复制成功后尝试 `tuziswitch://account/connect`，提供手动打开入口；普通设置只复制 | 网站回归、原生严格 URL 解析；冷/暖实际唤起受限 |
| 3 | 居中连接卡片、等宽对齐按钮，“连接”，约3.5秒错误提示且聚焦输入框 | 账户组件测试、最终 app 实机截图 |
| 4 | 空 Key 提示位于密钥表内，四概要与列表之间不再有大块消费占位 | 空态回归、账户 UI 核验 |
| 5 | 仅显式确认触发删除；取消/Esc零请求，重复确认只请求一次 | 新增回归；实际取消后两条 Key 均保留 |
| 6 | 创建/详情/编辑/查看密钥独立弹窗；名称+分组为主，默认不限额度、永不到期，高级选项折叠，使用金额/日期输入 | 默认创建/只读详情回归、实际弹窗核验 |
| 7 | 创建草稿与详情隔离，迟到详情响应不覆盖创建内容；显式编辑才进入编辑表单 | 延迟响应回归 |
| 8 | 默认人民币，可切 USD；使用站点元数据和精确十进制金额换算；永久到期显示“永不到期” | 金额精度回归；实际 ¥730→USD100→人民币 |
| 9 | 独立突出配置按钮，七工具按平台和兼容条件展示；已有来源定位现有配置，新增复用事务表单，保存后停留工具页并可返回账户 | 来源/跨账户/协议筛选组件测试、七工具原生事务回归、实际选项核验 |

删除根因是 Tauri 中异步 `window.confirm` 返回 Promise，被旧代码直接当作 truthy；现在采用组件确认弹窗，确认按钮执行删除。配置来源投影按 provider id 和 app_type 关联现存供应商，已删除供应商不再误标为已配置，历史来源记录不删除。

## 定向测试与构建

环境：本机 macOS，现有 pnpm/Bun/Rust 环境；测试仅合成值。API 业务服务未改，本轮未重复无关 Go 全包测试。所有下列命令退出0。

客户端工作目录为上表客户端目录：

```sh
pnpm exec vitest run tests/account/account-improvements.test.tsx tests/components/AccountPage.test.tsx tests/account/desktop-business.test.tsx tests/account/tuzi-tool-compatibility.test.ts tests/account/account-query.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx
pnpm typecheck
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_ -- --test-threads=1
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh
```

- 前端9文件72测试通过（`/tmp/tuzi-b09-client-final.log`）；最后为空态“创建第一个密钥”按钮补充写入结果未知时的禁用保护后，重跑 `pnpm exec vitest run tests/account/account-improvements.test.tsx tests/account/desktop-business.test.tsx`，2文件35测试通过（`/tmp/tuzi-b09-client-review.log`）。35是72中相关子集复跑，不重复相加。
- 类型检查实际执行 `tsc --noEmit` 通过（`/tmp/tuzi-b09-typecheck.log`）。
- 原生49通过、2默认忽略（真实Keychain/Go opt-in 未在本轮重跑），包含七工具事务与来源投影回归（`/tmp/tuzi-b09-rust-final.log`）。
- 最终预览构建在全部代码修正后通过（`/tmp/tuzi-b09-app-build-final-css.log`）；实际 app 路径 `/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`。共享 target 目录，源码来自 B worktree。

API 的 `web/` 目录：

```sh
bun test ./src/components/settings/personal/cards/SystemTokenCard.test.jsx ./src/helpers/auth.return-target.test.jsx ./src/helpers/loginReturnTarget.test.js ./src/helpers/auth.test.jsx ./src/components/settings/PersonalSetting.alert-migration.test.jsx
bun run build
```

网站5文件38测试通过（其中系统令牌卡片8项），`/tmp/tuzi-b09-web-tests.log`；构建通过，`/tmp/tuzi-b09-web-build.log`。选定前端文件 Prettier 检查、两仓 `git diff --check` 通过。

非阻断输出包括 MSW 未配置新增 `account_take_open_request` 的提示、网站原有 chunk 大小提示及 Rust 两项既有 dead-code 警告。本轮没有升级依赖来消除这些提示。全仓既有 OpenCode 预设断言、网站旧50vw断言和MiniMax H3预设差异不属于本轮范围；不宣称全套全绿，来源见 [B08同步验证](mainline-sync-verification.md)。

## 真实本地 UI 与限制

本地网站 Vite5180→Go3180，隔离合成库 `~/Library/Application Support/com.tuziswitch.desktop.preview/system-token-api/synthetic.sqlite`，原生隔离目录 `~/Library/Application Support/com.tuziswitch.desktop.preview/home`。未轮换合成账户系统令牌、未删除已有 Key，未添加真实上游或发起付费调用。

已核验：网站原句/安全卡片；四概要与 Key 列表；默认创建、独立详情/编辑、取消删除保留两条 Key；币种切换与永久到期；工具选项；最终构建居中连接页和短暂校验提示。最终重建后初始读取曾等待，随后正常进入未连接页，并经正常粘贴连接到本地合成管理员，最终列表保留两条 Key；未修改安全存储策略或绕过系统授权。

未手工完成的两项：

1. 点击引导复制后浏览器工具以安全策略阻止自定义协议导航，故不换浏览器或借 shell 绕过。网站行为和原生 URL 解析有测试，完整冷/暖 OS 唤起仍需用户在正常浏览器验收。
2. 当前合成模型仅 `synthetic-g2-model`，无满足 Claude/Codex 的已确认协议资格；实际 UI 正确显示无兼容模型。未改 fixture 或放松条件，未执行完整七工具 UI 保存；兼容筛选和原生事务通过不能冒称这一手工链路通过。

截图均仅合成数据、掩码，不含完整系统令牌或模型 Key：

- [最终连接页及短暂提示](b09-evidence/connect-validation.png)
- [最终账户与密钥列表](b09-evidence/keys.png)
- [默认创建弹窗](b09-evidence/create-key.png)
- [网站简化说明](b09-evidence/website-system-token.png)

Mock/组件/原生测试、实机局部交互分别记录；本轮不替代三平台发行安全存储、MySQL/PG、完整旧网站OAuth/支付、生产性能和用户验收门禁。

## 回退与交付

本轮 HTTP 契约和 schema 不变。必要时经授权分别 `git revert` 上述客户端/网站代码提交，再回退相应文档；保留本地用户修改、业务库和历史来源，不恢复 A、不清库、不轮换共享令牌。跨仓库不是原子提交，回退后重新核对配对与原有 B4 兼容要求。本轮只本地代码和文档提交，不 push、不建 PR、不部署。

## 2026-10-19 三项体验跟进

用户在B09验收后追加三项要求，本轮仅调整这三处：引导复制成功先展示“已复制，正在准备跳转 tuzi-switch…”，1.5秒后尝试固定导航；人民币/USD当前项蓝底白字；配置弹窗每项右侧复用`ProviderIcon`图标（与现有工具切换栏一致，不新增图片资源）。不修改模型筛选、密钥资格、来源识别、原生配置事务、API路由/权限/schema或其他工具行为。

代码配对（后续文档提交不改变被测代码）：

| 仓库 | 起点 | 本轮代码 SHA |
|---|---|---|
| 客户端 | `9070986d084358b82ef22f75a18f575b12b84dcf` | `58e152c96aef293cfc17fde888a79b6bd462a24e` |
| API/网站 | `10e29bd311448d2a358b9e7ed58e44b6bc48d935` | `1dc35a9e15f5f716f202539b3b54e05f91bcff83` |

两仓均为`codex/tuzi-assistant-system-token`，基线B4/契约`system-token-v1`不变；原有OpenCode预设测试文件SHA-256仍为`dac1a3c2b9ae4b34a3b212fb01ece1329255986527cb0cbc1bf67515e42f9904`，未改动、未暂存、未提交。

### 跟进验证

客户端：

```sh
pnpm exec vitest run tests/account/account-improvements.test.tsx tests/components/AccountPage.test.tsx tests/account/desktop-business.test.tsx tests/account/tuzi-tool-compatibility.test.ts
pnpm typecheck
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh
```

4文件49测试、类型检查及最终macOS本地预览构建通过；对应日志为`/tmp/tuzi-b09-followup-client-tests.log`、`/tmp/tuzi-b09-followup-typecheck.log`、`/tmp/tuzi-b09-followup-app-build.log`。本轮未修改Rust/配置事务，不重复无关原生全量测试。

网站`web/`：

```sh
bun test ./src/components/settings/personal/cards/SystemTokenCard.test.jsx ./src/helpers/auth.return-target.test.jsx ./src/helpers/loginReturnTarget.test.js ./src/helpers/auth.test.jsx ./src/components/settings/PersonalSetting.alert-migration.test.jsx
bun run build
```

5文件45测试通过（卡片15项）。新增回归验证1499ms不唤起、1500ms只唤起一次、无凭证深链参数、普通复制无延迟唤起、重复复制重置计时、手动打开去重、卸载/离开引导/离开安全区/开始轮换取消计时，以及剪贴板权限等待中离开引导不触发迟到唤起。最终源码测试及build日志为`/tmp/tuzi-b09-followup-web-tests.log`、`/tmp/tuzi-b09-followup-web-build.log`。改动代码格式和两仓diff检查通过；保留既有chunk/dead-code提示，不宣称全仓测试通过。

### 本地配置条件核查

只读检查隔离SQLite（URI `mode=ro`、`query_only=ON`），`channels`没有记录，`abilities`只有default分组的合成`synthetic-g2-model`。随后启动已有本地预览脚本（5180→3180，未添加渠道），以合成身份只读请求`GET /api/pricing/models`，返回该模型的`enable_groups=[default]`、`supported_endpoint_types=[openai]`；其余4个内置模型均为`openai-video`。因此当前没有Claude所需Anthropic协议或Codex所需Responses协议，配置界面没有对应可选模型符合现有校验。OpenAI Chat候选可用于支持该协议的工具，但本地无真实上游渠道，不能证明实际模型调用可用。

这支持“尚未接入合适渠道/模型会造成不能配置”的判断，不能推断用户其他站点或生产配置。正常配置还需启用且有额度/未过期的Key、匹配分组与模型限制、服务端正确协议元数据。不为通过验收添加渠道、伪造协议或放宽筛选，不执行付费调用。

### 实机验收与交付状态

首次预览停在“正在读取账户状态”。2026-10-19用户确认已手动处理钥匙串访问提示后，复查显示身份已读取、服务离线；只读探测确认本地3180服务未运行。重新启动既有隔离合成预览脚本（5180→3180），在客户端点击“重试连接状态”后恢复“已连接”，保留原有账户和两条测试Key，未更改安全存储或账户数据。

补充实机目视验收通过：人民币选中为蓝底白字，切换USD后激活样式同步切换、余额由¥730.00显示为$100.00，列表币种同步；随后恢复人民币。打开现有测试Key的配置弹窗，确认Claude、Claude Desktop、Codex、Gemini、OpenCode、OpenClaw、Hermes七项均左侧名称/状态、右侧对应图标。调整窗口后完整检查弹窗，取消返回账户页；未创建或保存工具配置、未执行模型调用。代码配对及原测试结果不变，本次只补记UI证据。

前轮浏览器安全策略阻止自定义协议导航的限制继续适用，本轮不重试或绕过该拒绝；1.5秒时序和手动恢复通过组件测试验证，不冒称实际冷/暖唤起已验证。

本轮只本地代码和文档提交，未push、PR、部署或操作生产；原历史A/B4/B08/B09证据保留。回退按两仓上述代码提交分别revert及相应文档提交，不清理数据或改动共享令牌。

## 2026-10-19 CNY标签与遮罩修正

客户端代码 `ad0fcb1074c1550811639654bbc358b6756e9d48`，配对未修改的API HEAD `6341a800263460c2a29f065a252b0145d7ac7e7c`，同名B分支，契约不变。仅CurrencySwitcher标签显示CNY、AccountDialog使用既有alert层级60（原40低于工具栏50），不修改全局弹窗或工具栏层级。原有未提交测试修改保持不变。

`pnpm exec vitest run tests/account/account-improvements.test.tsx tests/components/AccountPage.test.tsx` 19项通过；`pnpm typecheck`、两文件Prettier检查、diff检查及既有macOS预览构建命令通过。日志为 `/tmp/tuzi-b09-cny-tests.log`、`/tmp/tuzi-b09-cny-typecheck.log`、`/tmp/tuzi-b09-cny-build.log`。UI仍为旧进程，重启连续被电脑工具以用户正在改变窗口状态阻止，未强制终止；新构建实机目视未通过验收。仅本地提交，无push/PR/部署，回退使用代码提交revert。

补充实机验收（2026-10-19）：用户反馈看不到效果后，确认旧进程仍显示“人民币”。通过正常退出应用后重新启动同一路径的最新预览，账户自动恢复，界面已显示CNY；打开配置弹窗后，顶部兔子switch与七工具栏均随背景变暗、模糊，弹窗保持正常亮度。两项实机目视通过，解除上一段的新构建复验限制。未修改业务代码、账户或工具配置。

## 2026-10-19 弹窗文字发虚跟进

用户明确问题为字形发虚而非颜色。本轮仅账户弹窗改为inset/margin自动居中、height:fit-content，移除自身transform与动画，避免平移/缩放合成层影响字形；未改变颜色、字号、遮罩和业务行为。客户端代码 `04b44c4f083e8eb4481384ffa9e7d122e796d28d`，API仍为 `6341a800263460c2a29f065a252b0145d7ac7e7c`。两仓B分支和契约不变。

CSS格式与diff检查、macOS预览构建通过（日志 `/tmp/tuzi-modal-text-build.log`）；纯CSS改动未新增镜像测试。正常重启预览后账户恢复，打开原测试Key配置弹窗，确认居中、工具项和关闭入口正常。截图不足以证明屏幕细微锐度差异，根因仍属渲染假设，待用户对当前新预览确认。未读取完整密钥、保存工具配置或执行模型调用；原有无关测试修改保留。

## 2026-10-19 配置工具白屏修复

本地只读模型接口确认存在supported_endpoint_types为null的模型。选择工具触发兼容筛选时直接调用.some导致渲染异常。客户端代码 `59c9400` 为协议/分组数组增加类型检查，缺失元数据按不兼容排除，不放宽配置资格。API HEAD仍为 `6341a800263460c2a29f065a252b0145d7ac7e7c`，未修改API或渠道，契约不变。

扩展既有组件回归：混合正常模型、null协议、null分组，点击Codex仍可选择合法模型并继续；缺失元数据模型不显示。account-improvements与tuzi-tool-compatibility两文件11项通过，typecheck、diff和macOS预览构建通过。日志 `/tmp/tuzi-config-null-tests.log`、`/tmp/tuzi-config-null-types.log`、`/tmp/tuzi-config-null-build.log`。重启新预览后实机点击原测试Key配置→Codex，页面正常显示搜索/模型选择及无匹配提示，未再白屏；未揭示密钥、保存配置或调用模型。原有无关修改保留，仅本地提交。

## 2026-10-19 合并模型选择器

客户端 `7a5fdb0` 将独立搜索输入和select合并为Popover/Command可搜索选择器，保留服务端搜索、分页和兼容筛选。按用户要求不在界面解释渠道/协议原因，仅显示简短空态。8项相关测试、typecheck和macOS预览构建通过，日志 `/tmp/tuzi-picker-test.log`、`/tmp/tuzi-picker-types.log`、`/tmp/tuzi-picker-build.log`。新预览实机确认单一入口、下拉搜索、简短空态及Esc只关闭下拉。未保存工具配置或调用模型。API未修改，仍配对6341a8002。

## 2026-10-19 标准 Responses 端点兼容

用户确认 `gpt-5.6-sol` 上游支持 `/v1/responses`。客户端提交 `27e364c9` 将 API 标准标识 `openai-response` 加入 TypeScript 兼容筛选、Rust 原生资格校验及回归测试，同时保留历史别名。前端 12 项账户测试、TypeScript 类型检查、Rust 原生定向测试和 macOS 本地预览构建通过。原有未提交 `tests/config/opencodeProviderPresets.test.ts` 保持未修改。

本地合成 API 数据已保留原模型可见状态；尝试直接写入模型端点对象会使定价列表过滤该模型，已恢复，未伪造端点元数据。要让模型实际出现在 Codex 列表，API 管理端仍需为该模型建立包含 `/v1/responses` 的端点组并绑定模型，同时保留原 Chat 端点；客户端代码已可识别该标准标识。未进行模型调用、生产配置或远程操作。


## 2026-10-19 Codex 创建草稿 Key 回填修复（本地未提交）

用户报告从账户 Key 配置进入 Codex 表单后 Key 为空。账户草稿已含模型 Key 和新独立 env_key，但 useCodexConfigState 按存量配置读取尚不存在的环境变量，返回 null 后显示 missing。ProviderForm 现在明确传递新建预填标记；仅无 providerId 的显式新建草稿直接使用已有 auth.OPENAI_API_KEY，普通新建和已有供应商的凭证读取语义保持不变。完整模型 Key 仍只在表单内存中，不写日志或额外持久存储。

本地分支 codex/tuzi-assistant-system-token，客户端 HEAD 69bc262744ace2026a841782d1543ed54e394bb1 + 未提交修复；API HEAD 6341a800263460c2a29f065a252b0145d7ac7e7c，未改，B4/system-token-v1。此前 local-preview 模型夹具和用户无关测试修改均保持未提交，未 push、PR、部署或生产操作。

定向验证共 20 项通过：useCodexConfigState 5、ProviderForm 3、账户改进 8、工具兼容 4（ProviderForm 新增回归单独复跑 3 项）。新增回归覆盖预填 Key 不读取未知环境变量、保留用户编辑、编辑已有供应商仍读取绑定凭证；真实 ProviderForm 使用 tuziCreationPrefill 的合成 Key 自动回填、密码输入、提交携带原 Key/独立 env_key/所选模型且不提前调用 save_codex_route。类型检查、diff检查、macOS debug 预览构建通过。日志 /tmp/tuzi-key-prefill-*.log。

新预览正常重启，实机从 sss/default → 配置 → Codex → gpt-5.6-sol → 下一步，API Key 密码字段已填充并出现“显示API Key”按钮；没有点击揭示或保存，没有发起模型调用。界面停留在已填充的新增配置表单供用户继续测试。
