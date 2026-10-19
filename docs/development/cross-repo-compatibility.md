# B4 功能迁移与跨仓库兼容记录

基线 `TA-AC-1.5-B4`，契约 `system-token-v1`。此表覆盖已实现功能，**实现适配、接口可用及发布可见性不是同一状态**。分层验证和限制见 [B4验证报告](system-token-verification.md)。

## 最新代码配对：B10品牌与视觉

2026-10-19，客户端 `d60182c8eb0255b9822b72722914d7cd44f9bc6e` + API/网站 `26abbcdd2e7386cf1cc3c29e7fde80171380a102`，两仓 `codex/tuzi-assistant-system-token`，契约 `system-token-v1`。名称/图标/高亮/返回提示修改，内部身份和数据保持兼容；固定旧 MSI UpgradeCode。工作树含原有未提交修复，分层证据及局限见 [B10验证](brand-ui-verification.md)。局部本地UI通过，用户验收及发布未完成。两端可独立revert，无数据迁移或令牌轮换。

## 历史代码配对：B09三项体验跟进

2026-10-19，客户端 `58e152c96aef293cfc17fde888a79b6bd462a24e` + API/网站 `1dc35a9e15f5f716f202539b3b54e05f91bcff83`，两仓分支 `codex/tuzi-assistant-system-token`；契约仍为 `system-token-v1`。只增加引导复制提示与1.5秒延迟、币种选中样式和工具选项右侧已有图标，无HTTP/schema/资格校验变更。49客户端/45网站测试、类型检查、网站及macOS预览构建通过。实机和本地模型协议核查的具体证据与限制见 [B09验证](account-improvements-verification.md) 文末；后续文档提交不改变被测代码。分别revert相应代码及文档即可回退，不清库或恢复A；未发布。

## 历史代码配对：B09账户体验

2026-10-19，两仓均为 `codex/tuzi-assistant-system-token`：客户端 `1bfb98bb76eaacfd03b467cf3232406cbc7149de` + API/网站 `924cd70711daf852c18ff513394300808ac1c668`；HTTP 契约仍为 `system-token-v1`。后续文档提交不改变被测代码。72项客户端、38项网站、49项原生（另2忽略）、类型与两端构建通过；局部真实UI通过。固定导航唤起受浏览器工具安全策略阻挡，未实测完整工具UI保存；详见 [B09验证](account-improvements-verification.md)。

## 历史代码配对：B08本地主分支同步

2026-10-18，两仓 `codex/tuzi-assistant-system-token`：客户端 `8bcb34a82a15d9f92594b1c8212605eb485cb506` + API `eb6816259289ddc0c0f8a0bd8d0914a06709ee02`；契约 `system-token-v1` 不变。客户端纳入 `origin/main` 的 `01546a835a33fd8c1da75f4b67b0816f204e752b`，API纳入 `origin/dev` 的 `a770d4511eb1b9ac7d0707f85a8e3c03e39b5102`。后续仅文档提交不改被测代码；下文迁移/P2/P3配对为此前时点。验证有3项合并前既有失败，未新做真实原生/UI联调或发布；详见 [同步验证与回退](mainline-sync-verification.md)。

## 功能迁移矩阵

| 当前实现/能力 | B 对应原站接口/适配 | 测试方式 | 当前发布可见性 |
|---|---|---|---|
| AccountPage/原生连接 | bootstrap + self；连接先持久空 v2 再验证保存；断开覆盖空 v2 tombstone；generation/取消信号隔离，A 提示重连，无 OAuth | 合成令牌正常/无效/轮换/禁用/网络/存储故障/重启/切号迟到；真实 OS/UI 分层 | 连接区公开 |
| 网站个人设置/安全卡片 | token/current 只读；token 主动生成/轮换；可信来源/return_to/锚点 | 登录/已登录/过期恢复、复制不轮换、剪贴板/读取失败、普通模式及开放重定向 | API 网站正常可用，助手引导新增 |
| AccountMetrics/Overview | self + log/self/stat?summary=true，全量 SQL，时区边界和日志 coverage | >150 模型完整汇总、type2/6/7、空/关闭/缺日志、普通/管理员仅本人 | 顶部四项公开；完整总览隐藏 |
| Keys 列表/四筛选/分页/组 | token/、token/search、token/group，原站分页适配 | 名称/短片段/组/状态、分页/金额/身份隔离 | 公开 |
| Key CRUD/启停/高级条件 | POST token/；PATCH token/:id 只写提供列；DELETE | 零/false/清空/缺省/null/未知字段、归属、并发网站高级字段不丢 | 公开 |
| Key reveal/copy | POST token/:id/key；统一单个 sk- 模型 Key；短期内存 | 完整可调用格式、复制/失败、无长期 cache/日志/URL | 公开 |
| ConfigureTool/现有表单与 Rust 事务 | 仅模型 Key，原站 groups/pricing/模型资格 + 既有来源证明 | 七工具临时写集/备份/失败补偿/未知来源/切号清草稿，禁止真实模型调用 | B09 单 Key 入口公开，其他页面仍隐藏 |
| Logs/请求摘要 | log/self、search、request/:id，脱敏普通投影 | 筛选/范围/分页/跨账号/错误与计费分离，无原始 body/渠道 | 隐藏，开发可验 |
| UsageChart/统计 | full summary/statistics + data/consumption_stats?self=true/data/self | 全量趋势/分布无截断、退款/延迟/时区/管理员 self=true | 隐藏，顶部仅 summary |
| ModelsPage/PricingDetails | pricing、pricing/models，系统令牌 optional auth/快照适配 | 个人价/分组/复杂计价、snapshot/切号、无效令牌不降匿名 | 隐藏 |
| 模型服务状态 | perf-metrics、batch，has_samples/has_ttft，原生去诊断 | 1/6/24h、0 样本/TTFT、单位/成功率/历史时间、Cookie 独立 | 隐藏 |
| ProfilePage | self + PATCH self 五字段，锁内 settings 合并 | 字段白名单/false/未知/null/权限注入、并发保留、回读 | 隐藏 |
| topup/redemption/personal 网站入口 | 固定钱包/资料地址，无令牌 URL，核对网站账号 | 来源地址/站点开关/返回不推断成功 | 保留实现，Phase 1 隐藏 |
| Coding/GACCode 独立用量入口 | coding reseller / gaccode subscriptions | 固定 opener、不注入 Key，不改变独立供应商/工具 OAuth | 按原工具条件可见 |
| 七工具/深链/导出/WebDAV | 原模块保留，只退出账户 A；秘密不落业务库 | 现有工具回归及导出/日志脱敏检查，v1/import 深链仍在 | 原有可见性不变 |

七工具具体协议、端点和备份写集见 [技术方案](technical-design.md)；不把“保留源码/可配置”当真实付费调用或三平台通过。

## 起点及最终配对

2026-10-18 P2/P3 后续修复配对：两仓继续使用 `codex/tuzi-assistant-system-token` / `system-token-v1`。客户端 P2 精确 SHA 由本条与 `profile_record_ip_defaults_match_website_and_preserve_explicit_values` 同一提交定位；配对网站 P3 `9f0bdbb1388334cd176c97460adb7e68bbcaaec1`。下表保留首次迁移交付时点，不代表包含本次修复。两处修复独立、无新增接口/数据库依赖；将来发布沿用原发布门禁，各仓可独立 revert 对应修复，不恢复 A、不触发令牌轮换。

| 仓库 | 核查起点 | B 最终集成分支 | 最终 SHA/状态 |
|---|---|---|---|
| 客户端 | codex/tuzi-assistant-dev / c3902fe7c4fc847e769b23d7712092a30aa67c57 | codex/tuzi-assistant-system-token | 代码 `05419d66f48066fee78a9adf95590484cb78c639`；后续仅文档提交 |
| API 最新网站 | codex/unified-currency-display / dded57caedc376c4399f778ebb2147748bc24743 | codex/tuzi-assistant-system-token | 代码 `382e22e4c6a66adf9397b1ccc93c8852011045b1`；后续仅文档提交 |
| A API（仅审计） | codex/tuzi-assistant-dev / 111497e6f | 不作为 B 起点 | /api/desktop、独立 OAuth/required/hooks/cleanup 不集成；不清表 |

网站领域提交 b84552a156120307e0d24c8d091a008c884391f7（引导）及 1f66fc7ac1725492528f52aa08e32c2b895538d0（严格隔离代理）；集成 cherry-pick 后 SHA 可不同，应登记最终 HEAD。预存用户 Word/产品附件仅原工作区留存，不提交。

## 兼容组合及后续顺序

| 组合/处理 | 预期及限制 |
|---|---|
| B 客户端 + 配对 B API | system-token-v1；完整业务适配但默认仍 Phase 1；须用最终证据核验 |
| B 客户端 + 尚无扩展的旧 API | bootstrap/PATCH/summary 可能缺失；明确不兼容，不退回 A、不靠前端 GET+PUT 覆盖 |
| 原网站/其他 OAuth + B API | 原路由、DTO、鉴权保留，扩展参数明确启用；定向回归不能代替全部网站验收 |
| A 客户端/旧 OS 记录 + B API | A 专属能力不承诺；B 检出旧记录提示重连，不解释为系统令牌 |
| B v2 记录 + A 回退 | 不互认，不自动恢复 A；回退必须显式重连并复核 A schema/hooks/撤销状态 |
| 本地 A DB 表/标记 | 只读核查后保留，不自动 DROP/清空/更改，B 不引用缺失 A 表 |

后续上线（未执行）：先另获授权，部署并验证 API/网站向后兼容扩展，再 B 客户端，保持 Phase 1，完成平台/数据库/性能及用户验收。回退优先客户端/引导、再兼容 API；保留数据/schema。若先回 API，新客户端报不兼容不自动切认证。疑似泄露由用户主动网站轮换，提醒共享失效；本地断开不能当远端撤销。push/PR/部署/生产迁移均未授权。

## 首次 B4 迁移验证证据与限制（历史时点）

最终集成复跑：前端66、账户Rust24（含真实Go及macOS安全存储）、七工具事务12、五Go包均通过；网站37+103和build通过。真实网站过期登录回跳与定位、最终B桌面连接/重启/断开/错误/切号/本人隔离通过。隐藏业务经真实原生路由配对及组件测试通过，保持隐藏；未逐页UI验收。MySQL/PG、三平台发行安装包、完整旧站OAuth/支付及用户验收未完成。详细命令、DB只读结果与脱敏截图见 [验证报告](system-token-verification.md)。两仓只本地提交，未推送或发布。
