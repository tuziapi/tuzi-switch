# G2 两项验收问题修复（2026-10-14）

范围仅 R1/P1（T08/T14、AC-07）与 R2/P2（T14、AC-07/15），不进入 G3。基线 TA-AC-1.5-B3 / desktop-v1.1 / desktop-v1 不变。两仓均在 codex/tuzi-assistant-dev 本地提交；客户端 `29437625f85fcb8680386c5264670b6b0d498c97`，API `931b9bb12831c91a52c615ac031cedd56645fbcc`。用户既有验收记录、进度及 API 指针修改保留，不夹带提交。

## 修复

- R1：仅桌面 Key POST/PATCH 边界，将校验过的逗号/空白分隔 IP/CIDR 保存成换行格式。支持 IPv4/IPv6/CIDR、CRLF/tab；空白清空，非法项整笔拒绝。旧模型鉴权和旧 API 未修改，禁止列表优先级保持。无数据库迁移；此前已经保存的非规范桌面 IP 列表需要重新保存对应字段才能规范化，本轮未访问或修改生产记录。
- R2：未核实写入独立于揭示错误；创建/详情/取消不能清除待核实状态。核实使用原操作的目标 ID，创建按原名称跨页读取，不受当前列表筛选影响；失败或部分结果不解锁，重复点击不重复读取。删除仅明确详情 404 作为当前不存在。成功读取展示原操作与当前记录，由用户核对后关闭原操作并清空表单，不把成功回读等同原写入已成功，也不自动重试。保留普通请求中取消、关闭揭示和迟到明文清除。会话变更清理草稿并拒绝旧核实结果。

## 验证结果

- API：`go test ./controller -run 'TestDesktopKeyIPRulesReachModelAuth|TestDesktopBusinessAuthAndKeys' -count=1 -timeout=120s` 通过。新用例经过真实桌面 HTTP 创建/PATCH、数据库与现有 TokenAuth 中间件，验证五种分隔形式、IPv4/IPv6/CIDR、允许/禁止及禁止优先、非法项原子拒绝、清空限制；只用合成 IP，无模型请求。
- API：`go test ./controller ./middleware ./router ./model -run 'Desktop|TokenAuth|IpLimits' -count=1 -timeout=120s` 四包通过。
- 客户端：`pnpm exec vitest run tests/account tests/components/AccountPage.test.tsx` 四文件 41 项通过；最终核实分页/展示增量后 `pnpm exec vitest run tests/account/desktop-business.test.tsx` 22 项通过，`pnpm typecheck` 通过。新增 create/edit/status/delete 四例覆盖失败回读、核实期间及重复点击、创建/详情/取消旁路、揭示隔离、明确核对关闭与不重复写入；既有取消及迟到秘密清除回归通过。
- 两仓 `git diff --check` 通过。此次未重跑 Rust、完整 Go→Rust 配对或安装包构建：原生 IPC、OAuth、工具写入及契约无变化；上述证据不冒充全阶段重新独立验收。

结论：两项缺陷已修复并通过定向回归。此前独立验收发现的失败不能由原 G2 “已通过”记录覆盖；修复后供重新验收。本轮不启动 G3、不 push/PR/部署或访问生产；MySQL/PG、多实例、跨平台和完整浏览器门槛仍按 G2 验证记录执行。回退使用各仓本地修复提交的 git revert；无 schema 回退，回退会重新引入本次缺陷，不作为推荐运行版本。

## R3/P2：总览当日消费刷新窗口（2026-10-14）

本轮仅修复 T13 / AC-06、AC-15 原有当日消费与跨午夜要求。客户端代码提交 `8462c0012a8fd91a6678ba03a7c25e340ab1f89d`，分支 codex/tuzi-assistant-dev；API、原生 IPC、接口契约及依赖未改变。用户独立复验记录保持原样，不以作者修复记录代替重新独立验收。

根因是 Overview 在首次挂载时固定起止时间。现将当天本地零点、当前时刻及系统 IANA 时区的计算移到每次实际读取中；趋势与汇总作为一个逻辑查询发起，共用同一窗口、同一取消信号，全部成功后一起更新。读取失败保留已有错误/旧数据语义，旧数据显示自己的范围，不混用不同批次汇总和趋势。抽出 useAccountRead 复用原查询的账户/连接/代次隔离、隐藏取消、显示恢复、focus/失效重读、只读重试策略；原 useDesktop 调用方式保持不变，无新增轮询或定时器。

验证：

- `TZ=Asia/Shanghai pnpm exec vitest run tests/account/desktop-business.test.tsx`：26 项通过。
- `TZ=America/New_York pnpm exec vitest run tests/account/desktop-business.test.tsx -t 'overview time window'`：5 项通过，21 项按过滤跳过。含 2026-03-08 夏令时跳时当天本地零点/当前时刻和发送的时区断言。
- `pnpm exec vitest run tests/account tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx`：6 文件、53 项通过。
- `pnpm typecheck`、`git diff --check` 通过。

新增回归使用真实 Overview/QueryClient，仅 mock 原生传输及 Date：同日10:00→12:30失效重读、23:50→次日00:10隐藏后恢复、夏令时日、旧日请求取消后迟到；均断言实际请求起止范围，趋势/汇总同窗口，隐藏不发新读请求，普通组件重渲染不增加请求，旧结果不覆盖新日结果。未改系统时间或调用生产服务。

结论：R3 已实现修复并通过上述定向回归，交付供独立复验；不据此代为宣布完整 G2 产品验收或 G3 通过。未重跑 Go/Rust 配对或构建安装包（本次无该层修改），未 push/PR/上线。回退使用本次代码提交的 git revert，会恢复旧窗口缺陷，不推荐作为运行状态。
