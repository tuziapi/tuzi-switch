# 接口与权限契约

有效基线 `TA-AC-1.5-B4`；契约 `system-token-v1`（2026-10-18）。适用于本轮配对本地版本；不证明生产已支持。原站接口返回继续兼容网站及其他接入方；Rust 适配为现有页面 DTO，不能将旧 `/api/desktop` 改名后重建网络 facade。历史 A 契约见 [归档](history/b3-oauth-a/api-contract.md)。

## 凭证、身份及兼容

- 可信生产 origin 固定 `https://api.tu-zi.com`，原生发送 `Authorization: Bearer <账户系统令牌>`；后续受保护原站请求附 `New-Api-User: <服务端确认的用户 ID>`。不依赖/携带网站 Cookie，不跟随重定向，不接受前端自选 origin、Header、user_id 或管理角色。
- 首次仅 `GET /api/user/self/bootstrap` 新增系统令牌专用引导认证：Cookie 不参与，系统令牌独立验证；可省略 ID，若携带则须有效且匹配。返回原 `GetSelf` envelope/身份。该窄例外不全局取消后续 Header 校验。
- 后续原站已有系统认证规则保留：Header 缺失、格式错误和身份不匹配拒绝；角色和用户启用状态照常检查。可选认证的模型/性能路由支持系统令牌而无需 Cookie；无效 Bearer 不能降级匿名数据。
- 系统令牌保存在 `users.access_token`，没有独立有效期/刷新令牌字段或 OAuth scope。网站生成/轮换替换该字段，旧值立即无法匹配；账户禁用不可用。本地断开只清本机，不远程撤销。未有源码/测试证据证明改密码必然撤销系统令牌，禁止照搬 A 安全事件承诺。
- 系统令牌具有账户角色真实权限（管理员亦如此），助手仅调用本人业务并做字段投影。`X-Tuzi-Client`、UI 隐藏、原生白名单均不是服务端权限边界；不宣称 scope 最小权限。不发送 AT/RT，不实现 OAuth 续期/自动轮换/SSO。
- 网络路径只取下表的现有路由。React 的 `/account/*` 是受控 IPC 逻辑操作 ID，Rust 将其映射到原站，不作为新服务端端点。

## 功能—接口—归属—验收映射

| ID | 保留能力 | 原站网络方法/路径 | 约束及 AC |
|---|---|---|---|
| IF-01 | 网站取令牌/登录返回 | `/console/personal?source=tuzi-assistant#system-token` | 非敏感引导；可信站内 return_to；AC-02/03 |
| IF-02 | 首次验证/重启回读 | GET `/api/user/self/bootstrap` | 令牌独立身份，不依赖 Cookie；AC-04/05/16 |
| IF-03 | 身份/余额/累计/资料读取 | GET `/api/user/self`；公开 GET `/api/status`（显示元数据） | 身份确认后 matching ID；最小原生投影，AC-06/13 |
| IF-04 | 本地断开/切号 | 原生本地操作，无服务端 revoke | 清本机秘密及缓存，不使共享令牌失效；AC-04 |
| IF-05 | 总览四概要 | self + 下述全量 summary | 账户累计与窗口日志不同；AC-06 |
| IF-06 | Key 列表/搜索/详情/分组 | GET `/api/token/`、`/api/token/search`、`/api/token/:id`、`/api/token/group` | 原认证上下文本人；网站原 DTO 兼容；AC-07 |
| IF-07 | Key 创建/部分编辑/启停/删除 | POST `/api/token/`；新增 PATCH `/api/token/:id`；DELETE `/api/token/:id` | 原子字段白名单，旧 PUT 保留；AC-07 |
| IF-08 | 完整模型 Key | POST `/api/token/:id/key` | 主动单条本人；模型 Key 不是系统令牌；AC-07/08/16 |
| IF-09 | 日志/请求摘要 | GET `/api/log/self`、`/api/log/self/search`、`/api/log/self/request/:request_id` | 本人/普通视图，受控筛选与原生脱敏；AC-10 |
| IF-10 | 完整消费汇总/统计 | GET `/api/log/self/stat?summary=true`；加 `statistics=true` 取全量趋势/模型/错误分布；既有 `/api/log/self/advanced_stat` 保留 | 可信当前 ID，管理员也只本人；AC-06/10 |
| IF-11 | 原用量图表 | GET `/api/data/consumption_stats?self=true`、`/api/data/self` | self=true 强制当前身份，不能被管理员参数扩大；今日四概要不用有上限模型表求和；AC-06 |
| IF-12 | 模型及价格 | GET `/api/pricing`、`/api/pricing/models` | 按当前资格，optional auth 接受系统令牌；原生维持普通业务投影；AC-12 |
| IF-13 | 模型性能 | GET `/api/perf-metrics`、POST `/api/perf-metrics/batch` | 当前可见资格，无样本/TTFT 空值；AC-11 |
| IF-14 | 五字段资料编辑 | 新增 PATCH `/api/user/self` | 锁内白名单 settings 合并；旧 PUT 行为保留；AC-13 |
| IF-15 | 固定网站入口 | 钱包/兑换/资料/Coding/GACCode（PRD 固定地址） | 无秘密 URL/自动提交，不推断浏览器身份；AC-14 |
| IF-16 | 能力/发布配置 | 原生本地投影，非网络 `/api/desktop/capabilities` | 区分实现/接口/可见性；Phase 1 维持；AC-01/18 |

## 原站 wire、错误及字段投影

原站 envelope 为 `{success:boolean,message:string,data?:...}`，部分列表 data 为 `PageInfo`，价格有自带分页字段；Rust 分路由适配，不假设统一桌面 envelope。HTTP 2xx 且 `success:false` 仍是业务失败（包括部分无效令牌），不能只看状态码。HTTP401/业务认证失败、禁用、403 资格/权限、429、5xx、网络超时分别映射；错误内容不包含秘密。只读临时失败有界退避、尊重 Retry-After，写失败不盲重放，结果未知要求回读。网络失败不删除有效凭证。错误映射和实际 fixture 证据见 progress。

原站 ID/额度有 JSON number；原生必须验证整数安全范围并转换现有页面十进制字符串，不静默舍入、溢出或用浮点累计。保留原 quota 和站点 money 配置：`quota_per_unit`、币种显示类型、USD/CNY/CUSTOM/TOKENS、汇率/符号；不得硬编码站点当前值。额度除 quota_per_unit 得基础金额，再按实际配置换算；精确十进制、half-up 两位，非零不足 0.01 显示 `<0.01`，详情最多八位，不累加已舍入显示值。账户 `used_quota`/`request_count` 是累计，日志范围不是净账务。

原生读取 self 只向页面投影身份、group、余额/累计及已允许资料，不透传 role、绑定、安全设置、access_token 或未知 settings；Key/日志/价格/性能亦只投影原页面必需字段。管理员连接也不启用管理诊断。分页映射原站 p/size（按各路由真实返回校验，默认 20、最大 100）；价格快照/snapshot 换代回第一页，不拼不同快照。时间使用 Unix 秒，duration/latency 明确毫秒。

## Key 原子部分更新

B17（2026-10-19）：`GET /api/token/:id` 查询本人 Key 不存在（含已删除及不属于本人）时，保留 HTTP 200、`success:false` 和原 `message`，仅增加 `error.code="not_found"`。数据库故障、参数错误不得返回该码。原生保留此符号码；DELETE 结果未知后的回读接受明确 `not_found`（兼容原 404），展示不存在的结果后仍需用户确认才解除写入门禁。不得从错误文案或任意 HTTP200 失败推断删除成功。旧网站和 OAuth 调用方继续按原 envelope 处理；本项恢复能力需要先更新 API，再更新客户端。

新增 PATCH `/api/token/:id` 仅接受至少一项：`name,status,expired_time,remain_quota,unlimited_quota,model_limits_enabled,model_limits,allow_ips,exclude_ips,group`。未知字段/null 拒绝且不部分提交；JSON 类型严格校验。缺项保持，显式 `0`/`false`/空字符串作为有效值交给既有校验（例如空 IP 清除）；名称/分组、额度、模型、IP、到期和状态复用网站业务限制。身份/归属、已用量和高级路由字段不可写。

服务端事务锁定本人行，校验后只写实际提供的列，保留网站并发修改的未提供高级字段；不得客户端 GET 合并全量 PUT。状态修改同一 PATCH `{status:1|2}`，仍遵守过期/耗尽等原校验。旧 GET/POST/PUT/DELETE 调用方兼容。创建后按返回 ID 受控揭示新模型 Key；原生统一为单个 `sk-` 前缀的可调用格式，DB 裸值和原 relay 查找不变。完整值不进查询缓存、搜索 URL、日志或系统令牌存储。

列表首期四筛选 name keyword/短 token 片段/group/status；不把完整模型 Key 用作 URL 搜索。创建/编辑原页面已有高级条件全部保留。Key 可分配组与价格参考组不同，不能混用。来源关联继续 `{api_origin,user_id,token_id,app_id,provider_id}`，不能猜历史关联。

## 资料原子白名单

资料读取沿用网站设置语义：`record_ip_log` 缺省或 `null` 时为 `true`，显式 `true`/`false` 保留；另外两个布尔资料设置缺省仍为 `false`。页面按回读值计算变化字段，不能把旧账户缺省值误认为已关闭。

PATCH `/api/user/self` 仅接受 `display_name,language,accept_unset_model_ratio_model,high_concurrency_enabled,record_ip_log`，至少一项，未知/null/错误类型拒绝。显示名、语言枚举和价格资格沿用网站校验/限制，不顺带放开 username、role、余额、密码、绑定或通知凭证。事务锁用户，合并实际提供的 settings 项并更新显示名，保留并发/未知项；损坏 JSON 报错，不用空对象覆盖。成功后当前账户回读确认。

## 全量汇总与时间/覆盖语义

`GET /api/log/self/stat?summary=true` 扩展只在明确参数时启用，旧 rpm/tpm 返回兼容。`start_timestamp/end_timestamp` 同时提供，Unix 秒 `[start,end)`、跨度大于零且不超过 90 天；客户端按实际 IANA 时区计算今日/图表边界，DST 不能按固定 86400 秒代替。归属从可信上下文取得，忽略/拒绝覆盖身份参数；管理员同样本人。

汇总在 SQL 对全体满足条件的本人记录聚合，不受模型列表或分页上限影响。type2 为已记录消费：quota、request_count、prompt_tokens、completion_tokens；可能包含收费失败，不能叫成功调用。type6 为独立错误日志数，type7 为独立 refund_quota/退款记录，可能对应更早消费；不重复减除已标退款记录、不把它伪称净账务。`statistics=true` 另返回完整 trend/by_model/by_error，无模型数量截断；原生适配现有图表 DTO。

日志关闭、DB 不可用/缺失时 `logs_available:false, coverage:"unavailable"`，总量 null，UI 不显示确定零。成功查询 `coverage:"recorded_logs_only"`，只说明现存日志；空结果可为已记录值零，仍不能证明实际零消费或历史未清理。没有可靠水位则 data_as_of/estimated_delay_seconds 为 null，显示延迟/完整性未知。测试包括超过旧模型上限、边界/退款/错误、管理员与另一用户隔离、关闭和缺日志。

日志页面保留原站本人筛选/分页及请求摘要，原生移除 content/other/IP/channel/上游原文。调用结果只取可信明确状态，缺失为 unknown；失败不推断免费，type2 不推断成功。原生不新增完整请求内容或管理渠道视图。

## 模型与性能兼容

B17：工具保存前精确查询遵守原站 `models` 每请求最多 3 个不同名称的限制；客户端既有最多 50 个选中模型的界限不变。超过 3 个时串行分批，后续请求携带首批的 `snapshot_id`；缺失快照、快照变化或 `snapshot_refreshed=true` 拒绝本次保存。每批分别检查完整选中模型、协议、分组及 Key 资格，全部通过后才能进入原来源证明和本地事务。任一批失败或账户代次变化均中止，不使用部分成功结果。不修改 API 查询上限、空分组处理及其他资格规则。

原站 pricing/models 的分组、个人覆盖价、折扣、快照、复杂/表达式价格和协议元数据照常；客户端不执行计费表达式、不把缺价当免费、不套统一倍率。请求有效系统令牌可得到账户价；匿名公开参考须标注来源，带无效 Bearer 不可静默匿名降级。切号清 pricing snapshot/缓存，受控 IPC 禁止指定别人的用户/渠道。

性能沿用原接口 query/body 规则，客户端仅选已有 1/6/24 小时并适配现有 resolution；服务端补充 `has_samples/has_ttft`，无样本/TTFT 映射 null，历史样本带自身时间戳。success_rate 源为 0～100，不再乘 100；延迟/TTFT 毫秒、吞吐 Token/秒。管理员原响应若更宽，原生删除诊断/请求数，不能扩大助手原功能。

## 网站令牌读取与轮换

GET `/api/user/token/current` 只读当前已有系统令牌（data 字符串），不创建不轮换；GET `/api/user/token` 保留原站主动生成/轮换语义。两者禁止缓存；卡片仅在安全区域活跃时读取，秘密仅 React 临时内存。正常复制复用已读值，剪贴板失败展示可选字段；读取失败与空值区分。轮换独立确认共享接入影响。引导态改变标签页/定位，成功复制先提示、等待1.5秒再尝试打开固定导航深链；重复复制重置延迟，手动打开、离开引导/安全区、卸载或开始轮换取消待执行唤起；普通个人设置只复制。return_to 受可信站内路径约束，不能形成 OAuth 或把令牌送回客户端。

## B09 导航及展示约定（2026-10-19）

HTTP 路由、认证和 DTO 不变，契约仍为 `system-token-v1`。唯一账户导航 URI 为 `tuziswitch://account/connect`，拒绝 query、fragment、userinfo、port 和其他路径，不接受令牌、账户 ID 或任意目标。只唤起并定位账户页，用户仍手动粘贴和连接；原生事件加一次性 pending IPC 覆盖热/冷启动，旧账户 OAuth 回调继续丢弃。

人民币默认、USD 可切换，当前项有明确激活样式；仅非敏感币种偏好可持久保存。额度显示和高级金额输入按服务器 `quota_per_unit`、`usd_exchange_rate` 精确十进制换算，不硬编码汇率，不改变已有 quota；永久到期值仍为 -1。创建和详情状态独立，删除仅明确确认才发送 DELETE，写入结果未知时保持回读门禁。

配置来源仍使用既有站点/用户/token/app/provider 证明；投影只返回当前仍存在且 app 匹配的供应商，保留历史关联记录用于备份恢复。此投影不新增远程接口，不推断未知来源，不扫描工具 Key。

## B11 客户端预填补充（2026-10-19）

HTTP 契约仍为 `system-token-v1`。网站回跳地址严格保持无参数 `tuziswitch://account/connect`，不传令牌或用户身份。经用户确认，新客户端可在自身点击获取令牌后5分钟内，按 [ADR-010](decisions/0010-token-prefill-and-provider-drafts.md) 单次读取剪贴板并填入空连接表单，仍需用户确认连接。不是网站传回凭证，也不证明剪贴板来源。现站生成的系统令牌29～32位 Base62是自动预填候选限制，不改变原服务端令牌认证；其他合法旧格式可手动粘贴。旧客户端/旧网站继续兼容。

## B13本地凭证存储兼容

HTTP路由、认证、DTO及system-token-v1不变。账户原生后端改用独立本地JSON，不调用钥匙串；已有IPC错误码secure_storage_unavailable/secure_storage_failed继续兼容，界面含义更新为本地账户文件访问/保存失败，storage_invalid提供损坏后重连提示。普通IPC仍不返回保存的令牌。详见ADR-011。
