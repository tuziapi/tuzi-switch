# ADR-002：桌面首版接口与认证隔离

状态：技术已采纳，尚未实现；2026-10-13；基线 `TA-AC-1.5-B2`、契约 `desktop-v1.0`。关联T01、Q05/Q06/Q08/Q10、IF-01～16、AC-02～16。产品范围不变，用户已确认的部分见[ADR-001](0001-baseline.md)。审计C `8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98`、S `72af0d4de3487033e800adcc38e42e320a993f75`。

## 决策及理由

| 技术决策 | 源码与取舍 | 两端影响 |
|---|---|---|
| 全部桌面业务走独立 `/api/desktop` facade，旧混合路由不接桌面AT | 旧Key PUT会清未呈现字段，Log投影改写id，pricing/perf管理员分支与错误包络不统一；窄路由能保证owner/scope/字段 | S复用原model/service验证但返回新DTO；C只接冻结路径；旧网站/OAuth wire不改 |
| public client与旧singleton及code/token表物理隔离；精确client_id/callback、S256、code120秒 | 旧Validate依赖singleton secret，原cleaner可能处理所有code；原300秒寿命保持 | S新增小表/增量迁移；C固定受信origin/记录版本，旧client记录不迁入 |
| 批准时创建pending连接与code，所有安全写使用用户行→连接→code/token锁序 | 安全事件与批准/换码/刷新并发不能留下新有效连接；无需给大users表增安全epoch列 | 密码变更/重置/禁用/删号事务失败则原操作失败；T07覆盖所有入口 |
| desktop AT/RT使用批准时间绝对30天、刷新闲置7天、AT30分钟，RT重放撤family，无宽限重试 | 响应丢失不可安全猜是否已轮换；原confidential无这套绝对期限 | C持久化in-flight journal，结果不明重连；S同事务撤旧AT，保留轮换RT hash至family终态+7天 |
| 完整scope十项、scope版本desktop-v1、契约desktop-v1.0；N统一包络/字符串int64 | 防止半权限首版与JS整数失真；旧协议仍保持 | C/S共享契约，变更须查两端、测试和API指针 |
| 用量直接查LOG_DB type2消费日志；不以quota_data导出或未证明完整的bucket替代 | 当前统计与日志并非同链；缺可靠watermark | S有界查询/索引/限流；C显示延迟未知；T21按实际MySQL副本验证成本 |
| 价格仍由原可见组/个人价builder计算，只投影允许字段；性能保持普通视图 | 不重写计费/虚拟default；防管理员诊断外泄 | 复杂价fixture与A/B账号缓存隔离；无统一前端倍率 |
| profile只五字段事务PATCH且同时要求读写scope，Key编辑服务器合并未展示字段 | 旧setting与Key包含隐藏配置，整对象写会造成误删 | 服务端严格拒未知/null，前端发送差异；网站原设置仍按旧接口 |
| N请求、错误、时间/金额/超时和缓存初值按契约冻结 | 这些是可调整的技术选择，不代表已测容量 | T19核对网站显示，T21用实际环境修订阈值；修订须增契约号 |
| 客户端七工具使用现有表单和各自协议/备份能力，空预设的OpenCode/Claude Desktop须新增主站创建选项并测试 | 源码中这两项预设数组为空，不能假设已有按钮；工具保存可能激活配置 | T15按单工具文件清单备份与回滚，主站Key不流入coding/GACCode；未验证平台不得标支持 |

未选方案：把桌面AT全局放入UserAuth或旧Key路由（越权和字段风险）；修改旧OAuth singleton为public（破坏旧接入方）；刷新宽限重放（安全歧义）；直接在users/日志大表加新列/索引（部署成本未知）；前端按公开目录推算用户价（语义错误）。

配置登记与迁移由T02实现，不能因ADR存在就视为数据库已升级。新的独立表允许旧服务在未使用新功能时继续运行；回退先关桌面签发/业务，保留revoke与清理，旧schema不删。T19做双方真实隔离联调，T21做MySQL/容量/多实例演练，T22获另行授权才发布。当前运行SHA、实例数、Redis、日志库拓扑、迁移编排和容量仍未知。
