# 接口与权限契约

基线 `TA-AC-1.5-B3`；契约 `desktop-v1.1`、scope版本 `desktop-v1`；2026-10-13 G1修订 **技术冻结，实施中**。产品范围沿用Word v1.5与ADR-001；见[ADR-002](decisions/0002-desktop-contract.md)、[验证清单](t01-verification.md)。源码基准C `8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98`、S `72af0d4de3487033e800adcc38e42e320a993f75`；冻结不是生产支持证明。

## 协议与兼容

- E=源码已有；A=既有路径新增桌面分支；N=冻结的新增接口，尚未实现。
- 独立public client `tuzi-switch-desktop`，名称“兔子助手”，无secret；精确回调 `tuziswitch://auth/callback`。auth/API origin均为 `https://api.tu-zi.com`。隔离环境使用独立 `tuzi-switch-desktop-test` 和构建时受信origin；不由深链接/页面指定凭证发送地址。T02登记前检查ID冲突，不覆盖旧配置。
- 首版完整scope集合：`account:read token:read token:write token:reveal logs:read usage:read models:read profile:read profile:write offline_access`。顺序无关；桌面请求恰为全集，一次授权。不能缩减权限冒充完整首版。旧四scope、singleton/confidential认证与TTL不变。
- 所有桌面业务用 `/api/desktop` facade，复用现有model/service验证与计费语义。旧混合Key/日志/统计/价格/资料路由不接受桌面凭证，防止白名单绕过；旧网站、系统token、旧OAuth已有允许路径保持原行为。不全局放宽UserAuth/TryUserAuth。
- N仅接受桌面AT，身份由user/client/connection验证得到；管理员也是本人普通业务视图。Cookie、模型Key、旧系统token、旧confidential AT不替代。桌面省略New-Api-User；若携带不匹配则拒绝。禁止user_id/username/channel_id归属覆盖。

## 功能—scope—接口—归属—验收

| CID | 功能 / scope | E：审计版本现状 | A/N：冻结方法与路径 | 归属 / 验收 |
|---|---|---|---|---|
| IF-01 | 浏览器授权 / 网站会话 | 授权页与context/authorize已有 | A GET /oauth/authorize；GET /api/oauth-provider/authorize-context；POST /api/oauth-provider/authorize | 纯网站会话、来源/CSRF；AC-02、05 |
| IF-02 | 换码/刷新 / offline_access | token强制secret | A POST /api/oauth-provider/token | public/confidential分流，code/RT绑定用户/连接；AC-02、03 |
| IF-03 | 身份 / token:read | userinfo已有；account仅额度 | A GET /api/oauth-provider/userinfo；旧 /api/oauth-provider/account仅旧协议 | 当前token用户；AC-02、06 |
| IF-04 | 撤销 / 持有RT；网站管理 | revoke强制secret | A POST /api/oauth-provider/revoke；N GET /api/user/self/desktop-connections；DELETE /api/user/self/desktop-connections/:id | 匹配client；网站本人纯会话；AC-04 |
| IF-05 | 账户 / account:read | user/self字段过宽 | N GET /api/desktop/account | 本人；AC-05、06 |
| IF-06 | Key读取/分组 / token:read | token单条读取/group已有 | N GET /api/desktop/keys；GET /api/desktop/keys/:id；GET /api/desktop/key-groups | 本人Key/可分配组；AC-07 |
| IF-07 | Key写 / token:write | token POST/PUT/DELETE，PUT清未展示字段 | N POST /api/desktop/keys；PATCH /api/desktop/keys/:id；PATCH /api/desktop/keys/:id/status；DELETE /api/desktop/keys/:id | 单条本人，事务合并；AC-07 |
| IF-08 | 明文Key / token:reveal | POST token/:id/key已有 | N POST /api/desktop/keys/:id/reveal | 主动单条本人；AC-07、08、16 |
| IF-09 | 日志/摘要 / logs:read | log/self及request摘要已有 | N GET /api/desktop/logs；GET /api/desktop/logs/requests/:request_id | 可信user_id；AC-10 |
| IF-10 | 日志汇总 / logs:read | self/stat及advanced_stat已有 | N GET /api/desktop/logs/summary；GET /api/desktop/logs/statistics | 同筛选集本人；AC-06、10 |
| IF-11 | 用量 / usage:read | consumption_stats与data/self采集链不同 | N GET /api/desktop/usage；GET /api/desktop/usage/summary | LOG_DB持久化消费type2；AC-06 |
| IF-12 | 模型/价格 / models:read | pricing/models已有 | N GET /api/desktop/models | 账户可见组/个人价；AC-12 |
| IF-13 | 模型质量 / models:read | perf-metrics与batch已有 | N GET /api/desktop/model-performance；POST /api/desktop/model-performance/batch | 可见模型/组共享质量；AC-11 |
| IF-14 | 资料 / GET profile:read；PATCH profile:read + profile:write | self/setting混合安全字段 | N GET /api/desktop/profile；PATCH /api/desktop/profile | 五字段白名单；AC-13 |
| IF-15 | 网站操作 / 无新写scope | 钱包/资料等网页 | E 固定HTTPS默认浏览器入口；无桌面支付/安全写接口 | 网站当前账号；AC-14 |
| IF-16 | 能力 / account:read | 无桌面能力接口 | N GET /api/desktop/capabilities | 实际能力及版本；AC-05 |

## OAuth与连接

IF-01浏览器参数：`response_type=code,client_id,redirect_uri,state,scope,code_challenge,code_challenge_method=S256`。Rust分别生成32随机字节base64url无填充的state/verifier（43字符）；服务器接受state/verifier43～128个协议安全ASCII字符，challenge恰43字符；redirect精确匹配无通配符。桌面code120秒（技术选择，旧300秒不改），pending600秒；GET不得签发。取消/过期使事务失效。

context沿用 `{success,message,data:{client:{id,name},account:{id,username,display_name},request:{response_type,client_id,redirect_uri,state,scope,code_challenge,code_challenge_method},scopes:[{name,label,description}]}}`；桌面account.id十进制字符串，显示名读真实字段，旧类型不变。桌面 request 另含服务端签名 `context_token`（账户+完整请求+600秒），POST 必须原样携带；当前网站会话与签名账户不一致、过期/篡改/缺失返回409 `authorization_context_changed`，网页重载上下文后要求重新确认。旧 OAuth 不增加此要求。POST为同一request加 `approve:boolean`；成功 `data:{redirect_uri}`；取消callback `error=access_denied&state=...`。名称/权限说明来自服务端登记。纯网站会话拒绝旧系统token；保留Origin/CSRF保护、原登录/2FA。

callback严格scheme=tuziswitch、host=auth、path=/callback，无port/userinfo/fragment；成功code+state，失败error+state（可带脱敏error_description）；重复键、成功失败混合、非pending、错state、过期/旧generation拒绝。一次消费，全deep-link入口统一分流，兼容v1/import；不得传AT/RT/Key或输出原回跳URL。

IF-02 Content-Type form。换码 `grant_type=authorization_code,client_id,code,redirect_uri,code_verifier`；刷新 `grant_type=refresh_token,client_id,refresh_token`。桌面禁止secret/Basic，旧confidential保留原认证。code与token不透明字符串，≥32随机字节，服务器仅SHA256。桌面成功裸对象必需字段：`access_token:string,token_type:"Bearer",expires_in:int,scope:string,user_id:string,refresh_token:string,refresh_expires_in:int,connection_id:UUID,grant_expires_at:int,scope_version:"desktop-v1"`。AT≤1800秒，RT闲置≤604800秒，均取min(自身TTL,批准时间+2592000秒绝对截止)；now≥expires_at即失效。刷新不得改scope/user/client/绝对起点。

IF-03桌面userinfo裸对象 `{sub:string,user_id:string,preferred_username:string,name:string}`；两ID与换码ID一致，无OIDC issuer/id_token声明。旧userinfo数字user_id不变。完整scope/身份/安全落盘都通过才已连接。刷新成功时同一事务撤销旧AT并签发新AT/RT；旧RT保留hash用于识别重放。

OAuth错误沿用裸 `{error,error_description}`：400 invalid_request/invalid_grant/invalid_scope/unsupported_grant_type；401 invalid_client（userinfo为invalid_token）；403 insufficient_scope；429/503 temporarily_unavailable，429附Retry-After；鉴权错误WWW-Authenticate含安全原因，不回显凭证/内部错误。token/userinfo/revoke/context均no-store。安全修订r1：仅桌面刷新消费前明确拒绝的429/503附 `OAuth-Refresh-Outcome: not-consumed`；原生同时验证完整temporarily_unavailable错误体后才可持久清journal并退避重试旧RT。事务错误/不确定响应不附此标记，不重放。详见[ADR-004](decisions/0004-g1-auth-corrections.md)。

IF-04 form `client_id,token,token_type_hint?`（access_token/refresh_token）；未知/已撤销幂等200 `{success:true}`。RT撤整个connection/family、AT仅自身，退出用RT。网站列表旧网站包络data为数组 `{id:UUID,client_id:string,client_name:string,device_label:null,created_at:int,last_refresh_at:int|null,absolute_expires_at:int,status:"pending"|"active"|"revoked"|"expired"}`；active必须还存在当前未旋转/未撤销且未过期的RT，否则expired；历史RT不决定当前状态，revoked优先。pending表示已批准但尚未换码，不采集机器名/硬件/IP，不返回token/hash。DELETE本人200 success；他人同不存在404。改密/重置/禁用/删号撤全部该用户桌面连接及未消费code；启用不复活；事务见技术方案。

## N统一传输规则

- `Authorization: Bearer <AT>`、`X-Tuzi-Contract: desktop-v1.1`，版本不匹配409。JSON写Content-Type application/json，尺寸64KiB（性能batch16KiB）。重复JSON键、未知字段/参数、错误类型、request null拒绝；PATCH至少一项。重复单值query拒绝，明确数组除外。认证先于业务验证。凭证不跨origin重定向。
- 成功 `{success:true,message:"",data:T,meta:{contract_version:"desktop-v1.1",request_id:string,generated_at:int}}`；Key创建201，其余200，DELETE data=null。失败按HTTP状态 `{success:false,message:string,error:{code:string,field:string|null,required_scope:string|null},meta:{...}}`，无data。所有私有响应no-store，不用HTTP200伪成功（旧协议不全局改变）。
- ID、额度、计数、tokens、total为十进制**字符串**，不经JS number；Unix秒为安全整数，耗时字段ms，ratio有限number；换算元数据为十进制字符串。数据库int64上界仍适用。response可空字段显式null，数组空[]，bool显式false。
- 分页page默认1且≥1，page_size默认20、1～100；`data:{page:int,page_size:int,total:string,has_more:bool,items:T[]}`。稳定排序用DB ID破并列；实时Key/日志非快照，新记录可改变分页。
- 400 invalid_request/invalid_filter/invalid_timezone；401 invalid_token；403 insufficient_scope/account_restricted；404 not_found（他人资源同不存在）；409 contract_mismatch/snapshot_changed/conflict；429 rate_limited + Retry-After整数秒；503 feature_unavailable/dependency_unavailable；500 internal_error。写错误field不含原秘密值。
- 401集中刷新一次；403不刷新；429尊重Retry-After；离线/5xx与空数据分开，内存概要标时间，失效清缓存。写/token不自动重试，超时“结果待核实”+回读。只读最多2次重试，1s/2s+抖动；连接10s、业务30s、OAuth20s。内存stale：账户/资料60s、Key/log/usage30s、模型300s、性能60s；gc5min；换号/退出全部清。隐藏暂停，可见性能页60s可刷新，日志不自动轮询。均为技术初值，非容量保证。

## 账户、金额与能力

账户quota、used_quota、request_count直接复用主站用户累计字段及其更新规则，不是选定时间范围日志统计，也不承诺与日志求和相等。退款、日志关闭/清理/缺失、异步记录均会导致差异；不得反向用日志重建账户资产。

IF-05 data恰 `user_id,username,display_name,status:"enabled",group,quota,used_quota,request_count,money`；身份/group字符串（历史display_name可空），额度/计数字符串。禁用用户鉴权失败。email只在profile；无role/admin权限/支付ID/绑定/全setting。

money恰 `{quota_per_unit:string,base_currency:"USD",display_type:"USD"|"CNY"|"CUSTOM"|"TOKENS",usd_exchange_rate:string,custom_currency_symbol:string,custom_currency_exchange_rate:string}`，有效正数元数据来自实际配置；原TOKEN映射TOKENS。quota/单位=美元，CNY乘usd_exchange_rate，CUSTOM乘custom_currency_exchange_rate，TOKENS显示额度；精确十进制，half-up两位，正数不足0.01显示 `<0.01`，详情最多8位，不能累计已舍入金额。与网站helper差异T19并排核对，不改真实资产/计费引擎；不硬编码500000或公开站汇率。

IF-16 data恰 `{scope_version,required_scopes:string[],native:{account,keys,logs,usage,models,performance,profile_read,profile_write},web:{topup,redemption,personal}}`，native/web均bool，required_scopes为完整集合；反映实际schema/依赖/开关，缺列不得假true。局部false显示不可用，全部首版native及完整权限验收通过才能发布。

## Key

IF-06 items/detail白名单恰 `id,name,masked_key,status,group,created_time,accessed_time,expired_time,remain_quota,unlimited_quota,used_quota,model_limits_enabled,model_limits,allow_ips,exclude_ips,is_expired`。id/额度字符串；status整数1启用/2禁用/3过期/4耗尽；created/accessed秒（0未使用），expired=-1永不过期；name/group/model_limits string，IP string|null，bool必需。mask沿用安全掩码；无原key/user_id/高级路由。

列表query：page/page_size、keyword≤100字符（非秘密名称/掩码）、group≤191字节、status1～4、expired_only/negative_quota_only bool、last_used_before Unix秒、sort_by=id/remain_quota/accessed_time/expired_time默认id、sort_order=asc/desc默认desc；禁止完整Key URL搜索。key-groups返回 `[{id:string,label:string}]`，复用可分配组资格、auto排除，不混价格参考组。

IF-07 POST必需name/group/expired_time/remain_quota/unlimited_quota/model_limits_enabled/model_limits，allow_ips/exclude_ips可缺默认空；PATCH仅这些九项，缺项保留，IP空串清除不收null。name≤50 UTF-8字节（沿用允许空名）；group逗号分隔逐组验证；model_limits≤16KiB，IP各≤4KiB且现有格式验证；quota≥0且≤min(int64上界,10^9×quota_per_unit)，到期-1或未来秒；禁写used_quota/status/user_id/高级路由。服务器事务读合并保留未展示字段，不能前端全量回传。创建data `{id:string,key:string}`，token:write一次受控明文；编辑回detail；status PATCH恰 `{status:1|2}`且遵守现有过期/耗尽检查；删除null。IF-08无body，data `{key:string}`，独立scope/限流，不进query cache/日志，取消/换号清内存。

2026-10-14 G2 实施事实补充：IF-07 创建和 IF-08 揭示的 `key` 是带单个 `sk-` 前缀的可调用模型 Key，与网站显式复制动作一致。数据库继续保存原有裸 Key，旧 API 的返回及 relay 查找规则不变；仅桌面 DTO 做格式转换。不得将其与账户 OAuth 混用。两端真实配对及旧存储/查找兼容测试通过，见 [G2 验证记录](g2-verification.md)；不改变 desktop-v1.1 或 scope。

本地非秘密关联 `{api_origin,user_id,token_id,app_id,provider_id}`，退出不删工具配置；不能从名称/掩码猜历史归属。batch/delete批量/导出不是首版。

## 日志与消费

IF-09/10共用query：start_timestamp/end_timestamp秒、`[start,end)`；缺两者最近7天，单边缺失拒绝，跨度>0且≤90天。type默认0、允许0～7（UI普通选项0/1/2/3/4/6/7，历史5可读）；token_name/model_name≤256字节，group≤191字节，request_id/upstream_request_id/request_path/error_keyword≤256字节。无user/username/channel/fast_count管理参数。默认20/最大100，created_at desc+实际DB id desc，LOG_DB不可用503。

LogDTO恰 `{id:string,type:int,created_at:int,model_name:string,token_name:string,group:string,request_id:string,result:"success"|"error"|"unknown",billing_status:"charged"|"not_charged"|"refunded"|"unknown",quota:string,prompt_tokens:string,completion_tokens:string,duration_ms:int,is_stream:bool,error_code:string|null,error_message:string|null}`。原use_time秒转ms；调用结果优先取可信other.call_status：success→success，error/error_charged→error；缺失时仅type6→error，其余unknown，type2不能推断成功。计费状态优先退款证据（type7或other.refunded=true）→refunded，再读取明确charged/not_charged，否则unknown；quota正负、日志类型或调用失败都不能单独推断是否收费。历史损坏/缺字段返回unknown；退款状态不推断调用成败。不返回content/other/IP/channel/上游原文。错误分类只允许upstream_error/rate_limited/timeout/validation_error/policy_denied/unknown_error，消息用通用本地化文本。

摘要request_id≤256字节，单段URL编码，不收路径分隔符；可信user_id+request_id查询，data `{request_id:string,items:LogDTO[],has_more:bool}`，时间/id升序，最多100；不存在404，同request_id他人不能混入。无完整请求/响应。

summary恰 `{record_count:string,error_count:string,quota:string,prompt_tokens:string,completion_tokens:string,start_timestamp:int,end_timestamp:int}`，同筛选总记录，不把rpm/tpm称总量。error_count沿原网站GetLogAdvancedStat语义，仅type6错误日志记录数，不含type2的error_charged；UI称“错误日志数”，不能称全部失败调用次数。statistics另收interval_seconds3600/86400默认86400，data `{summary:SummaryDTO,trend:[{start_timestamp,end_timestamp,record_count,error_count,quota,prompt_tokens,completion_tokens}],by_model:[{model_name,record_count,error_count,quota}],by_error:[{error_code,record_count}]}`，桶从start起末桶截断，无渠道分布。

IF-10复用BuildUserLogsStatQuery/GetLogAdvancedStat对应的本人查询/过滤与求和语义，不直接透传原UTC整点/自动bucketSize；桌面按冻结start与interval_seconds显式分桶，保留各type记录和退款符号，不重复扣除已标退款的原消费记录；它是日志范围汇总，不是账户净账务。

IF-11 source固定usage，**直接聚合LOG_DB持久化消费type2**，复用消费口径，不用独立quota_data导出或不完整异步统计桶猜数。query start_time/end_time `[start,end)`跨度≤30天，timezone必需有效IANA（客户端默认系统时区但必须发送）；缺范围按该时区今日00:00至now，DST按IANA换算；interval_seconds3600/86400默认3600，model_name可选≤256字节，无source/user/channel参数。

usage data `{source:"usage",timezone,start_time,end_time,data_as_of:int|null,estimated_delay_seconds:int|null,chart:[UsageBucket],table:[UsageModel]}`；summary同元数据加call_count/quota/prompt_tokens/completion_tokens字符串。UsageBucket恰bucket_start/bucket_end整数秒及call_count/quota/prompt_tokens/completion_tokens字符串；UsageModel恰model_name及同四数值字符串。桶从start起末桶截断，仅成功查询范围补零桶；table无项[]。暂无可靠watermark与延迟证明，两字段null，UI显示延迟未知；generated_at不冒充新鲜度。查询失败503，不假零。迟到日志后回读可变，不承诺实时无延迟；T21验证成本。call_count是type2消费记录数（包含收费失败），不是成功调用数；quota为该来源记录额度汇总，type7退款不在usage源内，不显示为净消费。对齐原消费统计usage来源，不重建账务。日志关闭/历史缺失/清理不能从空结果证明零实际消费；UI固定标注“已记录消费，非完整账务”，延迟/完整性未知，不展示成账户累计值。

## 模型/价格/性能

IF-12 query page/page_size、search≤256字节、group≤191字节、snapshot_id≤128字节；quota_type0/1/2、endpoint_type/vendor/tag/models允许重复数组，各≤50项、单项≤256字节。data `{items:DesktopPricing[],pagination:{page,page_size,total,has_more},snapshot_id:string,snapshot_refreshed:bool,api_version:int,schema_version:string,algorithm_version:string,pricing_meta:DesktopPricingMeta}`。沿用快照排序与用户权限cache，换代重新页1，不拼页；不可见组403。

DesktopPricing白名单：model_name,aliases,description,description_i18n,icon,tags,vendor_id,created_time,updated_time,publish_time,quota_type,model_ratio,model_price,pricing_unavailable,owner_by,completion_ratio,cache_ratio,create_cache_ratio,create_cache_ratio_5m,create_cache_ratio_1h,web_search_price,image_ratio,image_cache_ratio,image_output_ratio,audio_ratio,audio_cache_ratio,audio_completion_ratio,conditional_task_pricing,conditional_task_pricing_details,task_per_second_pricing,per_call_variants,enable_groups,supported_endpoint_types,endpoints,billing_mode,billing_expr,pricing_version。另含related_pricing同DTO数组（最多一层，子项空数组）；精确类型/嵌套投影见[验证清单](t01-verification.md)，无无界related递归/hot计数；可选缺价null不当免费。

DesktopPricingMeta仅usable_group,group_ratio,base_group_ratio,system_group_ratio,user_group_multiplier,group_discount_ratio,group_discount_source,user_model_discount_ratio,user_model_pricing,vendors,supported_endpoint,group_model_pricing,pricing_reference_group,default_effective_group,default_resolution；group/model map按可见集合裁剪，无all_level/admin诊断。源码固定结构及嵌套白名单见验证清单。价格参考组不等于可分配Key组；复用用户覆盖价/折扣/虚拟default/表达式语义，前端不得套统一倍率，也不运行表达式。

IF-13 GET model必需≤256字节、hours1/6/24默认24、group单值或groups重复最多20互斥，resolution固定30m。POST `{models:string[1..50],groups?:string[1..20],hours?:1|6|24}`，去重后按可见集合查，一项无资格全请求403。data单个/数组 PerformanceDTO：`{model_name:string,aggregate:MetricDTO,groups:GroupMetricDTO[],series_schema:string}`。MetricDTO：avg_latency_ms/avg_ttft_ms/avg_tps/success_rate（number|null）、has_samples:bool、sample_level/ttft_sample_level（源枚举，见验证清单）、latest_sample_ts:int|null、historical_values（四指标及各自Unix秒timestamp，无值null）、half_hour_series:PointDTO[]；PointDTO恰ts:int、四指标number|null、has_samples:bool；GroupMetricDTO恰group:string及同MetricDTO字段。无样本/无TTFT转null，历史值用自身时间；success_rate0～100不再×100，毫秒/token每秒不混。无request_count/渠道诊断。

## 资料与网页

IF-14 GET需要profile:read；PATCH同时需要profile:read与profile:write，避免写操作响应泄露未授权读取字段。GET恰 `user_id:string,username:string,email:string,display_name:string,language:string,accept_unset_model_ratio_model:bool,high_concurrency_enabled:bool,record_ip_log:bool`；email可空字符串，无外部绑定ID。PATCH仅最后五项、至少一项，未知/null全请求400无部分写。显示名1～20 Unicode字符，历史空名读取可空；language仅zh-CN/zh-TW/en/fr/ru/ja/vi，旧空/未知读取回退zh-CN不写回；价格默认false，IP旧nil有效true。保持网站说明/账号阈值，主动保存才改变。事务合并settings、保留旧未知字段，显示名+settings原子更新；损坏JSON500，缺setting列503/capability false，不覆盖空对象。成功回完整ProfileDTO。

IF-15固定钱包 `https://api.tu-zi.com/console/topup`（兑换同页无虚构锚点）、资料 `/console/personal`、Coding `https://coding.tu-zi.com/reseller/`、GACCode `https://gaccode.com/subscriptions`。默认浏览器、不传凭证、不自动提交；网页账号可不同，回来仅刷新桌面当前账号。通知/边栏/签到/全部安全操作网站完成。

## 2026-10-15 Phase 1 桌面开放面

本轮用户确认首期仅开放总览摘要和 API 密钥。`GET /api/desktop/capabilities` 在 `data.release` 返回当前桌面开放面：`{profile:"phase1", overview:boolean, keys:boolean}`；`native` 仍表示底层技术能力，不代表当前公开。当前阶段对 `/api/desktop/logs`、`/api/desktop/models`、`/api/desktop/model-performance`、`/api/desktop/profile` 及其子路径统一返回 `403 desktop_feature_unavailable`。充值/兑换/个人资料网站入口在 Phase 1 客户端不提供；API 站原有网站路由不受影响。

API 密钥列表首期允许 `keyword`（名称）、`token`（密钥片段）、`group`、`status` 四类筛选；客户端仅发送短密钥片段，不发送完整密钥。总览摘要继续使用 `account:read` 与 `usage:read`，不因隐藏调用明细而关闭 usage 汇总。
