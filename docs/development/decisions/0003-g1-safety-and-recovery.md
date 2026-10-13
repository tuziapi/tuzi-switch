# ADR-003：G1统计语义、安装状态、兼容回退与安全存储

2026-10-13；技术已采纳，待实现验证。基线 `TA-AC-1.5-B3`，契约 `desktop-v1.1`，scope `desktop-v1` 不变。用户本轮授权G1本地编码、隔离测试、子智能体、本地提交与集成；不授权push/PR/部署/生产登记或迁移。替代历史文档阶段限制，不改变产品范围和30m/7d/30d寿命。

## 统计与调用结果

源码依据：API `model/log.go` 的 BuildConsumeLog/recordConsumeLog 将 violation_fee 标为 error_charged，但仍写type2；MarkConsumeLogRefundedInTx给原消费记录添加refunded；网站 UsageLogTypeCell 展示消费/退款标签。`model/consumption_stats.go::loadConsumptionSourceRowsBatch` usage来源筛选type2；账户累计字段沿用原用户更新链。

因此type2不能当调用成功。调用结果按可信call_status，历史缺失unknown（type6为error）；收费按明确billing_status，退款单独refunded优先。不从quota或错误推断免费。IF-10保留原日志查询/聚合语义；IF-11同原usage来源，仅已记录type2消费，不是成功次数或扣退款净消费。账户累计、窗口日志、usage来源是不同指标。日志关闭、历史清理/缺失、退款、异步迟到使它们不可强行对等；不建立第二套账务。契约增加refunded枚举并修正语义，故升desktop-v1.1；G1 OAuth wire及scope未变，G2消费者必须用新契约。历史T01记录保留v1.0以示来源。

## 安装状态与安全事件

在四个桌面业务小表之外增加独立 `desktop_schema_installations` 安装标记，迁移版本仍为首个尚未发布的 `desktop-oauth-1`。迁移开始持久写installing，逐步建立/校验四表列及索引，全部成功后installed；中断可由显式迁移重新校验续跑，不能自动删除已有数据或盲目改变不兼容列。

只有成功确认标记/四表全无、部署未声明required、进程从未观测安装，才能判never-installed并让旧站安全操作保持原行为。任何部分存在、标记版本不符、installed后缺表/列/索引、数据库探测失败都属异常，桌面fail closed；改密/重置/禁用/删号必须在用户行锁事务内撤销，撤销失败回滚安全变更，不能忽略后留下有效连接。

进程observed-installed单向锁存，发布配置还必须在安装后持久设置desktop schema required；这是全部桌面表和标记被误删且进程重启时仍能区分从未安装的外部证据。required不能因关功能开关/回退而关闭。不可能仅靠全部已消失的数据库表证明曾安装，因此该部署条件是硬门禁。未安装旧站不被强迫迁移，旧模型/支付不使用桌面schema健康检查。明确错误可用性损失优于悄悄忽略安全撤销。

## 可兼容回退

允许回退目标必须是保留桌面安全事件用户事务钩子、revoke、本人连接管理、清理器、安装标记和required检查的兼容基线构建；桌面authorize/refresh/business关闭。目标版本不能仅凭“旧代码不碰新表”称为兼容。G1交付记录可选稳定SHA，T21在实际版本数据库副本验证停止签发、改密与撤销、重放失效、清理和旧站回归。

不认识新表的历史二进制不能直接作为安装后的应用回退目标；若事故必须使用，需另行制定并验证全撤销、路由封锁、清理运维方案，不能假设旧程序有撤销能力。本轮不执行该生产方案。保留schema与撤销证据，不恢复旧RT，不以git revert代替数据库/运行版本回退。

## T04安全存储和受信HTTP

选择Rust `keyring` 3.6系列：macOS apple-native，Windows windows-native，Linux sync-secret-service + crypto-rust（DBus DH加密会话）；禁用linux keyutils回退。macOS仓库最低版本12.0、Rust最低1.85沿用；Windows凭据与Linux Secret Service运行依赖须按实际库编译和设备验证。cargo info keyring@3.6.3确认MSRV1.75；Windows凭据blob有限，超限失败fail closed。库选型不是三平台通过证明。Linux会话总线/Secret Service缺失或锁定明确失败，不保存普通文件。

认证使用独立reqwest Client：no_proxy、禁止所有HTTP redirect、固定受信HTTPS origin、限定超时；不继承工具代理或调用者URL。仅显式测试构建可用loopback HTTP及test client，正式构建不接受任意环境/深链接改变凭证目标。操作系统浏览器只打开构造的受信授权URL。

安全存储单记录含pending、active和refresh journal；命名空间绑定auth/api origin、client、record_version，记录校验user/connection。原生保管state/verifier/AT/RT，无秘密IPC DTO。刷新发送前持久in-flight，响应安全存储后才放行；超时/崩溃不盲重放旧RT，提示重连并尽力撤销。写入失败不宣称connected，无明文降级；清理失败明确不可确认本地清除，不能误报退出成功。测试系统存储用唯一测试条目并清理；Mock故障注入和真实OS验证分开。

## 验证与影响

T02/T07验证never-installed、installing、installed后各表缺失、标记缺失/required重启、DB错误、安全变更回滚、兼容回退；T04验证平台feature、安全存储故障/重启、秘密排除、HTTP redirect拒绝。T09/G2验证收费失败、退款、历史字段缺失与日志关闭语义。新增验证矩阵见g1-verification。三库、Windows/Linux、真实已安装包回跳仍分别登记限制，不能替代T19～T21。
