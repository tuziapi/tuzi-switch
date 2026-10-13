# T01契约核对、合成样例与后续验证矩阵

2026-10-13；基线 `TA-AC-1.5-B2` / `desktop-v1.0`。本文件的HTTP、数据库和平台场景是**预期断言，未执行**；本轮仅源码与文档检查，不能把合成样例算真实联调。C/S的固定SHA见[契约](api-contract.md)；路径前C/S对应两仓库，符号比易变行号优先。

## T01补充证据与适配结论

| 固定版本源码位置 | 已核实事实 | 冻结后实施影响 |
|---|---|---|
| S model/oauth_provider.go::CreateOAuthProviderAuthorizationCode、ValidateOAuthProviderAccessToken；model/oauth_provider_config.go | 旧表哈希/CAS可参考，创建code带同步历史删除，验证依赖singleton secret | 新桌面表不受旧cleaner影响，独立public登记，旧函数不能直接无条件复用 |
| S model/main.go::InitDBWithoutSchemaMutation、MigrateOAuthProviderDB；cmd/db-migrate/main.go | 无schema mutation入口存在；原OAuth迁移只建缺表，CLI --apply原用于taskrecover | 新desktop规划/执行模式和小表结构校验；不运行原全量迁移补漏 |
| S model/user_settings.go::updateUserFieldsWithSettingsTx/PatchUserSettings；model/user.go::UpdateProfile、ResetUserPasswordByEmail | 行锁/未知setting保留/损坏拒绝；邮件重置直接写密码 | 五字段原子patch与统一撤销事务，不能漏掉重置入口 |
| S controller/user.go::UpdateSelf/UpdateUser/DeleteUser/Manage；controller/misc.go::ResetPassword；model/user.go::HardDeleteUserById/DeleteUserById | 自助/管理员/邮件/软硬删除多入口 | T07把用户安全变更与桌面撤销放同事务；所有路径单独反例 |
| S controller/token.go::UpdateToken/GetToken/CreateToken；controller/token_group.go；model/token.go | 非PATCH高级字段可被清空，TokenResponse嵌全Token，名称按字节限制 | 新窄DTO与服务器合并；旧wire兼容；无批量能力 |
| S model/log.go::formatUserLogs/BuildUserLogsStatQuery/GetLogAdvancedStat；model/consumption_stats.go；model/usedata.go | 普通日志id改页序号，用户ID查询基础可复用；LOG_DB消费与quota_data导出不是同链 | 新投影稳定DB ID；有界type2聚合；延迟不能猜 |
| S model/pricing.go::Pricing；controller/pricing.go::GetPricingModels/buildPagedGroupModelPricing；types/price_data.go::UserModelPricingEntry | 复杂计价/覆盖价/default组/账户快照，all_level等管理字段 | 普通业务builder后再白名单；保留复杂价结构，不推统一倍率 |
| S common/endpoint_defaults.go::EndpointInfo；pkg/perf_metrics/types.go；controller/perf_metrics.go::parsePerfMetricIntervalSeconds | Endpoint含任意模板/参数；性能旧wire支持half_hourly或30min，不支持30m文字；历史值仅成功率/延迟/TTFT；样本级别none/low/medium/high | 新30m参数在facade映射1800秒，不能原样丢旧controller；endpoint拒任意模板；性能历史TPS为空，逐桶样本证据需从内部计数构建 |
| C src/config/opencodeProviderPresets.ts、claudeDesktopProviderPresets.ts；src-tauri/src/services/provider/{mod,live}.rs、各工具config | 两个预设列表空；保存可首次激活/additive写配置；各工具协议不一致 | 补主站创建选项，T15备份早于任何写；OpenClaw保持completions、Hermes保持codex_responses |

上表是B1 source-audit的T01补证，不改写历史审计结论；“七工具都有现成主站预设”不成立。

## 复杂DTO精确投影

这些是新DTO允许的闭合集合，源DTO未来增字段不自动透传。空可选scalar统一null；普通string空串、数组[]、map{}；其他contract必需字段不能因omitempty消失。Pricing核心model_ratio/model_price/completion_ratio为有限number，quota_type为int（0按量/1按次/2按秒，沿用实际源码），vendor_id为十进制字符串；时间为Unix秒。description_i18n为原JSON编码字符串，UI只按已支持语言读，不注入HTML；tags原字符串、aliases/enable_groups/supported_endpoint_types为字符串数组；pricing_unavailable bool。复杂字段下面的价格数值有限number，缺optional值null；不把缺价视为0。

| 新字段 | 固定源结构 / 允许嵌套字段及类型 |
|---|---|
| conditional_task_pricing | model.ConditionalTaskPricing：no_video_price/video_price:number；对应_currency:string |
| conditional_task_pricing_details | rule_identifier/reference_markdown:string；price_variants数组：has_video_input/has_audio_input:bool、unit_price:number、unit_price_currency/estimate_mode:string；variants数组：resolution/ratio:string、width/height/fps:int、has_floor:bool、floor_durations:int[] |
| task_per_second_pricing | unit:string、default_duration_sec/max_duration_sec:int或null；variants数组resolution:string、unit_price:number、unit_price_currency:string |
| per_call_variants | label/tags/currency:string、price:number、extra_ratio:number或null |
| endpoints及supported_endpoint | map端点类型→{path,method,label,description,docs,scenario,transport:string；highlights:string[]；async:bool}，没有parameters/request_template任意对象；docs仅可信HTTPS外链，path不是凭证发送origin |
| vendors | [{id:string,name:string,description:string,icon:string}] |
| usable_group | map组ID→标签string |
| group_ratio/base_group_ratio/system_group_ratio/user_group_multiplier/group_discount_ratio | map组ID→有限number，仅可见集合 |
| group_discount_source | map组ID→来源string，沿用普通builder结果，不返回等级后台表 |
| user_model_discount_ratio | map组ID→map模型名→有限number；保留显式0折扣，不默认为1 |
| user_model_pricing | map组ID→map模型名→闭合Entry：billing_mode/billing_expr:string；model_price/completion_price/second_price/multiplier/cache_price/create_cache_price/create_cache_price_5m/create_cache_price_1h/image_price/image_cache_price/image_output_price/audio_price/audio_cache_price/audio_completion_price/web_search_price:number或null |
| group_model_pricing | map可见组→map价格属性→map当前页/关联模型→值；属性number：model_price/model_ratio/model_multiplier/model_second_price/model_completion_ratio/model_cache_ratio/model_create_cache_ratio/model_create_cache_ratio_5m/model_create_cache_ratio_1h/model_web_search_price/model_audio_ratio/model_audio_cache_ratio/model_audio_completion_ratio/model_image_ratio/model_image_cache_ratio/model_image_output_ratio/quota_type；属性string：billing_expr/pricing_source；其它属性禁止 |
| pricing_reference_group/default_effective_group | string |
| default_resolution | map模型→{requested_group,effective_group,discount_group,reason:string} |
| historical_values | {success_rate,avg_latency_ms,avg_ttft_ms,avg_tps}，各为{value:number,ts:int}或null；当前源未提供历史TPS，固定null，不能从别的时间窗冒造 |
| 性能样本 | sample_level/ttft_sample_level枚举none/low/medium/high；none无样本，TTFT none→null；PointDTO的has_samples需用内部bucket计数（不输出计数），不得以所有指标0猜无样本 |

相关模型计费：新DesktopPricing增加 `related_pricing:DesktopPricing[]`，最多一层，使用同一白名单/可见组过滤；子项related_pricing=[]。与原复杂builder相同的关联模型用于group_model_pricing裁剪，不能移除价格引用后让客户端错误显示。该关联是价格解释，不提供额外不可见模型调用资格。

## 合成fixture（非真实身份或凭证）

以下共用请求头 `X-Tuzi-Contract: desktop-v1.0`；鉴权由后续测试fixture注入，不在文档造可误用的真实Bearer。样例时间为合成Unix秒。OAuth令牌由测试时随机生成，下面只展示寿命/身份期望，不把占位值作为有效响应。

```json
{
  "fixture": "authorization-lifetime",
  "approved_at": 1800000000,
  "grant_expires_at": 1802592000,
  "code_expires_at": 1800000120,
  "first_exchange_at": 1800000060,
  "first_access_expires_at": 1800001860,
  "first_refresh_expires_at": 1800604860,
  "near_end_refresh_at": 1802591990,
  "near_end_expires_in": 10,
  "near_end_refresh_expires_in": 10,
  "user_id": "9007199254740993",
  "scope_version": "desktop-v1"
}
```

GET /api/desktop/account →200：

```json
{
  "success": true,
  "message": "",
  "data": {
    "user_id": "9007199254740993",
    "username": "fixture-a",
    "display_name": "合成用户A",
    "status": "enabled",
    "group": "fixture-group-a",
    "quota": "9007199254740993",
    "used_quota": "500000",
    "request_count": "2",
    "money": {
      "quota_per_unit": "500000",
      "base_currency": "USD",
      "display_type": "USD",
      "usd_exchange_rate": "7",
      "custom_currency_symbol": "TEST",
      "custom_currency_exchange_rate": "2"
    }
  },
  "meta": {"contract_version": "desktop-v1.0", "request_id": "fixture-account", "generated_at": 1800000060}
}
```

PATCH /api/desktop/profile请求显式false →200回读false；夹带password则400且所有原字段不变：

```json
{"display_name":"合成A","high_concurrency_enabled":false,"record_ip_log":false}
```

缺logs:read，GET /api/desktop/logs →403，不刷新、不空列表：

```json
{
  "success": false,
  "message": "缺少调用日志权限",
  "error": {"code":"insufficient_scope","field":null,"required_scope":"logs:read"},
  "meta": {"contract_version":"desktop-v1.0","request_id":"fixture-denied","generated_at":1800000060}
}
```

Key与日志字段fixture（分别嵌入接口data.items；仅masked_key，非明文）：

```json
{
  "key": {"id":"42","name":"fixture-key","masked_key":"****fixture","status":1,"group":"fixture-group-a","created_time":1800000000,"accessed_time":0,"expired_time":-1,"remain_quota":"500000","unlimited_quota":false,"used_quota":"0","model_limits_enabled":true,"model_limits":"fixture-model","allow_ips":null,"exclude_ips":null,"is_expired":false},
  "log": {"id":"84","type":6,"created_at":1800000000,"model_name":"fixture-model","token_name":"fixture-key","group":"fixture-group-a","request_id":"fixture-request","result":"error","billing_status":"unknown","quota":"0","prompt_tokens":"3","completion_tokens":"0","duration_ms":2000,"is_stream":true,"error_code":"timeout","error_message":"请求超时"}
}
```

其余DTO数据样例均按通用meta包络，以下fixture只存请求/期望data，验证器应据契约补完整包络：

```json
[
  {"if":"IF-06","request":{"method":"GET","path":"/api/desktop/key-groups"},"data":[{"id":"fixture-group-a","label":"合成分组A"}]},
  {"if":"IF-07","request":{"method":"PATCH","path":"/api/desktop/keys/42","body":{"name":"fixture-new"}},"expect":{"name":"fixture-new","advanced_fields_unchanged":true}},
  {"if":"IF-08","request":{"method":"POST","path":"/api/desktop/keys/42/reveal"},"expect":{"key":"测试时生成并在结束后清理"}},
  {"if":"IF-09","request":{"method":"GET","path":"/api/desktop/logs/requests/fixture-request"},"expect":{"request_id":"fixture-request","items_count":1,"has_more":false},"note":"成功用例需注入一条本人记录；不存在请求应404"},
  {"if":"IF-10","request":{"method":"GET","path":"/api/desktop/logs/summary?start_timestamp=1800000000&end_timestamp=1800003600"},"data":{"record_count":"2","error_count":"1","quota":"500000","prompt_tokens":"100","completion_tokens":"20","start_timestamp":1800000000,"end_timestamp":1800003600}},
  {"if":"IF-11","request":{"method":"GET","path":"/api/desktop/usage?start_time=1800000000&end_time=1800003600&timezone=Etc%2FUTC"},"data":{"source":"usage","timezone":"Etc/UTC","start_time":1800000000,"end_time":1800003600,"data_as_of":null,"estimated_delay_seconds":null,"chart":[{"bucket_start":1800000000,"bucket_end":1800003600,"call_count":"1","quota":"500000","prompt_tokens":"97","completion_tokens":"20"}],"table":[{"model_name":"fixture-model","call_count":"1","quota":"500000","prompt_tokens":"97","completion_tokens":"20"}]}},
  {"if":"IF-12","request":{"method":"GET","path":"/api/desktop/models?page=1&page_size=20&group=fixture-group-a"},"expect":{"snapshot_id":"fixture-snapshot-a","account_price_source":"user_override","admin_fields_absent":true}},
  {"if":"IF-13","request":{"method":"POST","path":"/api/desktop/model-performance/batch","body":{"models":["fixture-model"],"hours":6}},"expect":{"success_rate":75,"avg_latency_ms":2000,"avg_ttft_ms":null,"ttft_sample_level":"none","request_count_absent":true}},
  {"if":"IF-14","request":{"method":"GET","path":"/api/desktop/profile"},"data":{"user_id":"9007199254740993","username":"fixture-a","email":"a@example.invalid","display_name":"合成A","language":"zh-CN","accept_unset_model_ratio_model":false,"high_concurrency_enabled":false,"record_ip_log":true}},
  {"if":"IF-16","request":{"method":"GET","path":"/api/desktop/capabilities"},"data":{"scope_version":"desktop-v1","required_scopes":["account:read","token:read","token:write","token:reveal","logs:read","usage:read","models:read","profile:read","profile:write","offline_access"],"native":{"account":true,"keys":true,"logs":true,"usage":true,"models":true,"performance":true,"profile_read":true,"profile_write":true},"web":{"topup":true,"redemption":false,"personal":true}}}
]
```

金额算例：quota500000/单位500000=1USD；合成汇率7→7CNY，CUSTOM倍率2→2TEST；quota1→0.000002USD（总览 `<0.01`）；边界quota2500→0.005USD，half-up显示0.01。大整数9007199254740993不得变9007199254740992。

## IF正/负验收矩阵（实现任务执行）

每个N接口通用必测：完整scope200/创建201；缺对应scope403；匿名/过期/撤销401；旧session/系统token/模型Key/旧OAuth拒绝；A/B隔离；管理员仅本人字段；契约错误409；未知/null/重复字段400；429退避；依赖失败503与空[]区分。敏感response no-store，日志/trace无秘密。

| IF | 正例 / 请求响应断言 | 负例与恢复 | 任务 / AC |
|---|---|---|---|
| 01 | context只读、POST批准固定回跳；登录/2FA返回原参数，一次显示全集 | 错redirect/state/PKCE、额外scope、非会话/跨站拒绝；取消/浏览器拦截恢复 | T02/03/05；AC-02/05/14 |
| 02 | public无secret换码、code一次、轮换寿命fixture | 错verifier/client、重复/120s边界code、RT重放撤family、并发只有一次、刷新后旧AT401；绝对30d再连 | T02/06/07；AC-02/03/05 |
| 03 | 换码ID/sub/user_id一致、旧userinfo不变 | 不一致不能连接；5xx不误判身份失效；无scope403 | T05/08；AC-02/06/16 |
| 04 | RT退出当前、第二连接/旧OAuth保留；网站本人列表删除 | A删B404，AT单撤不当family；改密/重置/禁用/删号与刷新竞争；离线退出提示未远撤 | T06/07；AC-03/04/05/16 |
| 05 | 大整数/配置币种、本人余额，无管理字段 | 隐藏字段/无效元数据不可误显示，账户切换迟到响应弃 | T08/13；AC-05/06/15 |
| 06 | Key分页/筛选/分组/掩码/详情，total字符串 | A读B404、完整Key URL查询拒绝、不可分配组不展示 | T08/14；AC-05/07/15 |
| 07 | POST一次明文、PATCH保留高级字段、启停/删除回读 | 超时不重提创建；过期/额度/组业务规则；unknown/null/user字段400无部分写 | T08/14；AC-05/07/15 |
| 08 | 主动单条reveal独立scope/no-store，预填现有创建表单 | 缺reveal停止、取消/切号清秘密；秘密不进cache/日志/备份导出 | T08/14/15；AC-07/08/09/16 |
| 09 | 普通筛选/分页、真实DB ID、本人请求摘要，调用/计费分开 | 同request_id跨账号隔离；错误未收费不推断；原始body/IP/channel禁止 | T09/16；AC-05/10/15 |
| 10 | summary与同筛选fixture一致，截断桶 | username复用历史不混账；90d超限400；rpm/tpm不代总量 | T09/13/16；AC-06/10 |
| 11 | type2口径、30d/时区/DST/末桶、延迟未知、迟到更新 | export关闭不假零；日志库不可用503、他人/source/channel拒绝 | T09/13；AC-05/06/15 |
| 12 | A/B不同组价、用户显式0折扣、条件/按秒/表达式关联价，snapshot换代 | 匿名无效AT不降级、不可见组403、admin字段禁、换号清快照 | T10/17；AC-05/12/15 |
| 13 | 1/6/24h、毫秒/75%/空TTFT、历史各自时间 | 51模型400；不可见模型组403；no samples非0；每桶用真实内部样本标记，无计数 | T10/17；AC-05/11/15 |
| 14 | 五字段读写、显式false、语言回退不写回、损坏setting拒覆盖 | PATCH缺任一profile读/写scope均403且不写；password/通知secret等全请求400；管理员不能越权；显示名字符与字节区别 | T11/18；AC-05/13 |
| 15 | 固定浏览器URL、不拼Key、兑换按开关、返回按桌面身份回读 | 浏览器B/桌面A不换号；取消不报成功；不用注入WebView | T03/18；AC-14/16 |
| 16 | 返回版本/全集/实际能力，功能未支持false | 缺schema/开关关不可假true；局部灰度不能签完整首版验收 | T08/19；AC-05/15 |

AC-08/09还须逐工具执行technical-design矩阵：真实write-set写前备份、无文件标记、权限/并发哈希冲突、多文件失败补偿；保存/启用/模型测试分开。AC-16还须T04系统安全存储锁定/落盘失败、无明文降级、导出/同步/IPC/崩溃秘密排除。AC-15还须T06同时401仅一次刷新、换号取消旧请求、已发送写结果待核实、迟到回包不污染新账号。

## 旧行为与版本兼容矩阵

| 组合 / 场景 | 预期 | 执行门禁 |
|---|---|---|
| 旧服务+新增schema | 旧singleton/表配置不变，不触碰新表，原网站/旧OAuth/模型/支付可用 | T02迁移合成测试；T21实际三库/版本演练 |
| 新服务desktop关闭+旧客户端/原接入方 | 原客户端secret、scope、TTL、响应类型和限流桶不变 | T02/07定向；T19旧接入方隔离联调 |
| 新服务+新客户端desktop-v1.0 | 全scope、全native及本人权限通过，不只余额/Key | T19/20所有AC场景 |
| 旧服务+新客户端 | 能力路径404/协议不可用→明确提示、不循环登录，工具保留 | T06/20故障验证 |
| 新服务+旧客户端包 | 原工具与旧认证行为不变，不自动迁入desktop授权 | T20七工具回归 |
| 桌面专用表/限流故障 | 桌面fail-closed；网站撤销能独立提示依赖错误，旧模型/支付不共用新桶 | T07/21注入/压测 |
| 关desktop或应用回滚 | 新批准/换码/刷新/业务按独立开关停，revoke/清理保留；schema/撤销证据不删不复活 | T21配对应用回退演练；T22另行发布授权 |

## 本轮验证记录

设计核对由本聊天执行者在两端固定源码上完成，未虚构第二位独立reviewer。文档链接/编号、AC/IF/T覆盖、JSON样例解析、寿命/金额算式、保护输入哈希和Git边界检查结果登记在progress；这些不是可执行服务端测试。后续实现任务必须把预期转为自动化/真实隔离证据；真实联调与发布全部仍未完成。
