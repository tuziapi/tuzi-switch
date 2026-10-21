# R01 v1.4.1 正式安装包已发布（2026-10-21）

用户本轮授权的合并核查、版本更新、构建及 GitHub Release 发布完成。客户端 PR #48 已合入 main（`25b76e9be74c63ccc131be91ae3faa48811faf65`），API PR #277 已合入 dev（`70e5f2b2f624c7b721064cedc9994238973a8875`）。本次客户端发行代码/标签 `v1.4.1` 指向 `9b4e702b2ae973571221c9aa877f8fec0498c045`，契约仍为 `system-token-v1`；API 工作区未修改、未执行服务端部署或迁移。

- [Build & Release 39569723161](https://github.com/tuziapi/tuzi-switch/actions/runs/39569723161) 全部成功，Windows MSI/NSIS、macOS Apple Silicon、Linux x86_64 安装包均生成并上传。
- [兔子switch v1.4.1](https://github.com/tuziapi/tuzi-switch/releases/tag/v1.4.1) 于北京时间 2026-10-21 16:51 发布；非草稿、非预发布，GitHub latest 指向该版本。12 个附件涵盖安装包、三平台更新签名、安装脚本及 latest.json。
- 已下载核对 Release latest.json 与 release-manifest 分支清单完全一致；版本 1.4.1，darwin-aarch64/windows-x86_64/linux-x86_64 三平台均具非空签名且下载 URL 对应实际附件。此处是清单/附件核查，未另做安装包签名密码学复验。
- 发布前 typecheck、账户前端112项、更新器2项、图片回退脚本3项、Rust账户40项（另1项默认忽略）、供应商14项及 renderer build 通过。Windows 打包元数据修正后的三平台正式构建通过；未替用户安装覆盖应用，也未完成三平台安装/运行人工验收或完整产品验收。
- v1.4.0 首次构建 Windows MSI 失败、未公开 Release，其标签保留；v1.4.1 恢复正式旧版英文发行产品名对应的 MSI 升级标识及参数化 WiX 路径，详见 ADR-009。旧账户 OAuth/钥匙串预览用户升级后需重新粘贴系统令牌，不自动迁移或删除旧钥匙串。

# B13 本地账户配置文件与隐藏环境变量（2026-10-19）

按用户明确要求，账户系统令牌改用原生独立本地JSON，不再访问钥匙串；旧用户首次需重新粘贴。Codex新增/编辑移除环境变量输入与说明，新增自动避重、编辑保留原名、旧缺失兼容。代码 `d7b41dcdbae715d9ece2762753ae339c16e8a8ff` 配对未修改API `21cd7acd51349407cdc5d332a763907d065f9a86`，两仓指定B分支、契约system-token-v1。47前端、35账户原生（1默认忽略）、29供应商原生、七工具隔离回归、类型和macOS构建通过；实际新包启动无账户钥匙串框、新增字段移除及最终重启恢复本地合成账户已核验，其他平台和用户验收未完成。保留先前未提交补丁；详见 [B13验证](local-account-file-verification.md) / [ADR-011](decisions/0011-local-account-file-and-hidden-codex-env.md)。未推送或发布。

# B12 账户配置直接保存（2026-10-19）

用户确认后移除账户密钥配置的额外确认框，表单“添加”直接执行后台校验、备份和保存。失败保留输入并可重试，来源/资格/并发/恢复保护继续保留。客户端代码 `1ba0376a34ef7e4ff6e391a3af7c9622ef1cedf8` 配对未修改的 API HEAD `21cd7acd51349407cdc5d332a763907d065f9a86`，两仓均为 `codex/tuzi-assistant-system-token`。28前端测试、七工具原生隔离保存恢复、类型检查及macOS构建通过；合成浏览器一次添加通过，最新预览已重启并恢复账户页。未实际写入用户工具配置或发布，详见 [B12验证](provider-direct-save-verification.md)。原有未提交修改保留，测试基于工作树。

# B11 标题、令牌预填与供应商保存（2026-10-19）

三项用户确认需求本地实现：标题完整行高；5分钟/单次/空输入的原生回跳剪贴板预填，仍手动连接；兔子线路表单预填所选Key，修复分类丢失导致的保存拒绝、附加工具标识缺失与确认框操作问题。代码客户端 `b61f39a2b7c318ffa1b9ba12f1286664ca66c45d` / 网站 `68b5b3bf6b8768b932c2b0bc247223644272c258`，两仓 `codex/tuzi-assistant-system-token`，契约不变。56前端、48网站、54原生+3预览测试及类型/构建通过；合成真实组件UI、隔离七工具文件保存恢复通过。真实OS回跳/剪贴板、Windows/Linux及用户验收未完成，当前原生未保存表单未被关闭。原有未提交修复保留且未混入提交，验证基于工作树，详见 [B11验证](token-prefill-provider-verification.md) / [ADR-010](decisions/0010-token-prefill-and-provider-drafts.md)。未推送或发布。

# B10 品牌与账户视觉（2026-10-19）

四项用户确认需求本地完成：名称统一“兔子助手”、账户蓝青多边形兔子、网站2秒柔和高亮后淡出、移除工具页返回提示并保留配置定位。代码配对客户端 `d60182c8eb0255b9822b72722914d7cd44f9bc6e` / API `26abbcdd2e7386cf1cc3c29e7fde80171380a102`，两仓 `codex/tuzi-assistant-system-token`，契约 `system-token-v1`。客户端29项、网站48项、原生6项定向测试，类型检查与两端构建通过；局部UI已验证，完整平台升级/启动项/用户验收/发布未完成。既有未提交修复保留，详情见 [B10验证](brand-ui-verification.md)。

---

# B09 CNY标签与遮罩修正（2026-10-19）

账户切换标签改为CNY；账户弹窗使用既有alert层级60，高于工具栏50，遮罩覆盖顶部工具栏。仅两处展示修改。客户端代码 `ad0fcb1074c1550811639654bbc358b6756e9d48`，配对未修改的API HEAD `6341a800263460c2a29f065a252b0145d7ac7e7c`，两仓均为 `codex/tuzi-assistant-system-token`。19项测试、类型、格式检查和macOS预览构建通过；实机复验限制见B09验证文末。用户第3项为空，未推断新需求。

---

# B4 当前三项体验跟进（2026-10-19）

B09后续三项微调代码完成：助手引导复制先提示“已复制，正在准备跳转 tuzi-switch…”，1.5秒后尝试固定导航；普通复制不唤起。币种当前项蓝底白字；配置工具选项右侧复用现有图标。HTTP/schema/权限、工具配置资格与写入逻辑不变。

- 最新代码配对：客户端 `58e152c96aef293cfc17fde888a79b6bd462a24e`，API/网站 `1dc35a9e15f5f716f202539b3b54e05f91bcff83`；两仓均为 `codex/tuzi-assistant-system-token`，契约 `system-token-v1`。
- 客户端4文件49测试、网站5文件45测试、类型检查和两端构建通过。UI验收及本地模型协议核查见 [B09验证记录](account-improvements-verification.md) 文末；构建和Mock测试不代替实际深链唤起或模型调用。
- 补充实机验收：用户处理钥匙串提示、重启本地合成API后账户恢复；人民币/USD激活与金额切换、七工具右侧图标已目视确认。未执行工具保存或模型调用，实际深链唤起限制保留。
- 只本地提交，未push/PR/部署/生产操作；既有OpenCode预设测试修改保持未提交。

---

# B4 当前账户体验改进（2026-10-19）

`B09-account-improvements` 九项需求代码完成，定向测试和两端构建通过；局部真实 UI 核验通过，用户验收及发布未完成。两仓继续在 `codex/tuzi-assistant-system-token`，契约 `system-token-v1` 不变。

- 代码配对：客户端 `1bfb98bb76eaacfd03b467cf3232406cbc7149de`；API/网站 `924cd70711daf852c18ff513394300808ac1c668`。后续文档提交不改变被测代码。起点分别为 `9a6a0af6606dd5c2c336b1d8940408895b3970ba` / `11e14cb511607c91f9af9bf9e97ba1c785f93bd1`。
- 网站改为用户指定短文案；仅助手引导复制尝试固定导航回账户页，普通复制仍只复制。客户端连接布局、短暂提示、空态、独立创建/详情/编辑/查看弹窗、明确确认删除、人民币/USD 和永久到期显示完成；单 Key 配置入口复用七工具原表单/事务，已配置可定位，保存后可返回账户。其他隐藏页面维持隐藏。
- 客户端9文件72测试，最后空态写入屏障修正后相关2文件35测试再次通过；原生49通过、2默认忽略；网站5文件38测试、类型与两端构建通过。未宣称全仓测试全绿。命令、既有失败和分层证据见 [B09验证记录](account-improvements-verification.md)。
- 最终实际 app 已核验居中连接页/短暂提示并重新连接本地合成管理员，两条原有测试 Key 保留。前轮 UI 已核验删除取消保留、独立表单、币种切换及工具选项。浏览器工具安全策略阻止自定义协议导航，完整冷/暖唤起未手工证明；合成模型不满足 Claude/Codex 协议条件，未执行完整工具 UI 保存，不降低兼容校验。
- 原有 `tests/config/opencodeProviderPresets.test.ts` 修改完整保留且不提交。只本地提交，无 push/PR/部署/生产操作；历史 A 记录保留。

---

> 当前有效基线为 `TA-AC-1.5-B4` / `system-token-v1`（2026-10-18）。下方 B1～B3、desktop-v1.x、G1/G2/T01～T23 是历史记录，不再作为 B 认证/权限/表迁移或授权边界要求。业务保留和当前 Phase 1 可见性继续有效；以本节、README、ADR-008 和 B 迁移矩阵为准。

# B4 当前主分支同步（2026-10-18）

`B08-local-mainline-sync` 本地完成：C merge `8bcb34a82a15d9f92594b1c8212605eb485cb506` 配对 S merge `eb6816259289ddc0c0f8a0bd8d0914a06709ee02`，两仓分支仍为 `codex/tuzi-assistant-system-token`。分别纳入远程 `main` / `dev`，无冲突；C业务树不变，S保留B扩展。16Go包、Rust47（另2忽略）/52、类型及两端构建通过；前端84通过/1既有失败，网站独立进程361通过/2既有失败，不能标全绿。未复跑原生/UI真实联调、未发布。完整来源、命令、基线复现及限制见 [同步验证](mainline-sync-verification.md)。

# B4 当前本地迁移（2026-10-18）

目标及授权来自本轮 goal-objective.md：A→B 全业务本地迁移，保持 Phase 1。本地代码、文档、定向测试和隔离联调完成；用户验收、完整平台/实库门禁及发布未完成。两仓分支均 `codex/tuzi-assistant-system-token`。

- 客户端代码 `05419d66f48066fee78a9adf95590484cb78c639`；API/网站代码 `382e22e4c6a66adf9397b1ccc93c8852011045b1`。随后仅文档提交不改变被测代码；精确配对见 [兼容记录](cross-repo-compatibility.md)。
- 最终集成复跑：typecheck通过，前端9文件66测试，账户Rust24/24（含真实Go+macOS安全存储），七工具事务12/12，五Go包全部通过；网站37+103测试/build通过，本地debug app构建通过。
- 网站真实已登录定位、复制成功反馈、过期401→登录→安全卡片返回通过；读取复制不轮换已由current/DB一致性验证。UI复制剪贴板字节未获证明，故不虚报。
- 最终B实际app已验证普通账户连接、重启恢复、本地断开后重启、无效令牌、普通/管理员切号与管理员仅本人。用户允许系统钥匙串访问后完成，无安全绕过。完整隐藏功能经真实Rust→Go与组件测试覆盖，默认仍隐藏，未逐页面点击验收。
- A实际本地数据库/安装标记仅只读核查并保留，B独立库无A表/钩子/清理；原工作区未改，Word/产品附件保留。B4文档/ADR008/迁移矩阵齐全，B3历史快照和下方A记录保留。
- 详细命令、证据、预览与用户验收步骤、权限/失效及上线/回退计划见 [B4验证报告](system-token-verification.md)。未使用真实凭证、生产数据、支付或付费模型调用；未push/PR/部署/迁移/发布。
- MySQL/PG、三平台发行安全存储/安装包、完整旧网站OAuth/支付、生产容量和用户验收仍未验证，不由本地通过代替。

- 2026-10-18 P2/P3 复查修复完成：资料 IP 记录 missing/null→true，显式布尔值保留；网站改用真实 Semi Input 的 `readonly`。新增四情况原生回归及真实组件只读/聚焦全选回归，旧代码均已复现失败。原生23通过/2按默认忽略、资料等组件27通过、网站37通过；详见验证报告末尾。此轮未重建预览或新增人工验收，未发布。

---

# 以下为历史 A 进度（保留证据）

# 当前阶段与跨仓库进度

## R01 Windows 打包修正，版本改为 v1.4.1（2026-10-21）

v1.4.0 工作流 `39566508003`：macOS/Linux 构建和产物上传成功；Windows release 程序编译通过，MSI light.exe 打包失败，publish-release 因依赖失败跳过，未创建公开 Release。对比 v1.3.1 发现 B10 WiX 模板硬编码中文安装目录/键名，且固定 UpgradeCode 与实际发行脚本的英文产品名不符。恢复 product_name 参数化、固定真实旧版正式 MSI UpgradeCode，并为 Windows 构建启用 verbose 日志；见 ADR-009 最新核正。v1.4.0 标签不重写，应用版本改为 v1.4.1 后重建。此前通过的业务测试继续适用，新增变更只涉及版本与安装打包元数据，真实打包结果以新工作流为准。

基线 `TA-AC-1.5-B3`，更新2026-10-13。阶段：**G1本地开发检查点已交付（desktop-v1.1），本次独立验收发现两项待修复缺陷，暂不通过进入G2的检查；完整平台/环境验收受限，未发布。**

## 最新验收复查（2026-10-13，优先于下方历史通过记录）

固定C `74aa8ed5de159e7ea2c7150e47e449fc660387eb` / S `7c131f18eaf4dff64dd6b501e324b989e4331552`，当前执行者复查并重跑类型、24项UI、23项Rust（2默认忽略）、五Go包和8项网站测试，均通过。新增隔离HTTP探针复现：R1共享授权入口使旧client合法系统令牌请求由200变401；R2限流预解析使token控制器64 KiB上限失效，71,914字节合法换码由应有400变200。详见 [G1独立验收报告](g1-acceptance-review.md)。

T02/T03对应修复及验证重新打开；现有提交不回滚，其他历史测试通过事实保留。先修复、正式回归和独立复查再评估G2。本轮只审查、隔离测试及文档记录，未改业务代码/依赖，未commit/push/PR/部署或访问生产；原平台/实库限制仍保留。

## B1历史事实（非当前G1状态）

- 完整读取Word v1.5正文/表格，核查两个仓库规则、HEAD/历史、相关实现和测试能力。
- 建立PRD、源码审计、接口草案、技术方案、T01～T22任务、未决问题和ADR；客户端新AGENTS，API原AGENTS保留后追加。
- 用户已确认资料五字段及价格两开关、MySQL、desktop安全事件撤销和30m/7d/30d寿命。详见ADR-001。
- 没有业务代码/依赖修改，没有创建分支、worktree、聊天或并行实现，没有commit/push/PR，没有执行数据库迁移、部署、访问生产或无关安装/构建/测试。
- 原有21个未跟踪方案/预览/附件保持；原Word哈希见README。文档验证结果见末尾。
- 公开运行时核验（2026-10-12）：`https://api.tu-zi.com/` 响应头返回 `x-new-api-version: dev-20261012-72af0d4de348`，首页 PWA 标识同样含 `dev-20261012-72af0d4de348`；这与本地 API 审计 SHA 的前 12 位一致，但只能证明该公开入口返回的版本标识，不能证明所有实例或镜像均一致。公开 `/api/status` 显示站点名称“兔子API”、服务地址、文档入口、额度显示为 USD、`quota_per_unit=500000`、`usd_exchange_rate=0.7`、自定义货币为 `¥`、数据导出开启、签到关闭；这些是公开站点配置线索，不等同于桌面接口契约或数据库事实。
- 公开 GitHub 组织 `tuziapi` 当前可见 9 个公开仓库，未列出 `tuzi-api`；对 `tuziapi/tuzi-api` 的公开 API 查询返回 404。因此服务端仓库可见性、部署流水线和发布记录仍需仓库权限或运维资料确认，不能把 GitHub 组织列表当成完整仓库清单。

## 2026-10-13开发流程补充记录

- 来源：用户本轮明确补充“先本地开发，再推到远程仓库进行上线”“API上线版数据库MySQL”“API开发分支codex/tuzi-assistant-dev”。
- API开发集成分支已指定为 `codex/tuzi-assistant-dev`；后续并行实现使用从其建立的独立任务分支/worktree，本地核验后集成。客户端当前同名分支只属Git现状，本轮未指定其为开发集成分支。历史部署分支dev与本地开发分支不是同一用途，分支名不证明上线状态。
- 本轮核查：客户端HEAD `8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98`、API HEAD `72af0d4de3487033e800adcc38e42e320a993f75`，两端当前分支均 `codex/tuzi-assistant-dev`；保护已有未提交文档，仅追加/修订相关流程记录，未fetch或访问生产。
- 已更新两仓库AGENTS、统一README、本进度、open-questions和API基线指针；属于事实/流程补充，不修改产品范围或接口契约，B2/desktop-v1.0不变。本轮不含业务编码、分支/worktree创建、commit、push、PR、合并、迁移或部署授权；T02～T22状态不变。
- 后续执行：获新编码授权后本地开发、测试、分任务commit；push及上线分别遵守另行授权和发布门禁。MySQL精确版本、运行实例/拓扑、隔离环境与容量仍按Q02/Q04/Q09处理。
- 文档验证：本地Python标准库检查与修改前快照对比，六个目标文件的本地链接/围栏/行尾检查通过，其余既存文件哈希不变；两仓库 `git diff --check` 退出0，HEAD/分支/暂存区不变。没有运行业务测试、构建、安装或环境探测；不构成数据库或线上验证。

## 任务看板

| 任务 | 当前状态 | 代码 | 测试 | 联调 | 发布 | 主要门禁 |
|---|---|---|---|---|---|---|
| 基线文档（B1） | 已交付历史基线 | 不适用 | 文档检查 | 不适用 | 不适用 | 不构成编码授权 |
| T01 | 文档设计完成（2026-10-13） | 不适用 | 文档核对通过；HTTP/DB未执行 | 不适用 | 不适用 | 运行事实/联调/容量转后续门禁 |
| T02/T03/T07 | 代码集成、审查完成；实库/浏览器验收受限 | S 615f501207b1c6d02be765fad97c469e6c213bc6 | 五Go包、6网站测试、网站构建通过 | Go＋Rust局部真实loopback通过；完整登录未测 | 未发布 | MySQL/PG、共享Redis、完整浏览器登录/2FA |
| T04/T05/T06 | 代码集成、审查完成；跨平台受限 | C ec78f883dc536a35fbbd72ae88305227d0a1ef4c | Rust18通过/2默认忽略；显式Keychain配对通过 | macOS真实Keychain＋Go；安装包回跳未测 | 未发布 | Windows/Linux、默认浏览器/冷暖OS回跳 |
| T12 | G1状态壳代码/本地检查完成 | C ec78f883dc536a35fbbd72ae88305227d0a1ef4c | TS、24定向UI、renderer构建通过 | 原生状态接线；组件测试含Mock | 未发布 | G2业务面板未实现，未冒称占位业务完成 |
| T08～T11/T13～T18 | 未开始（G2） | 未开始 | 未执行 | 未开始 | 未发布 | 本轮不扩大范围 |
| T19 | 未开始 | 未开始 | 未执行 | 未开始 | 未发布 | 隔离环境与两端实现 |
| T20 | 未开始 | 不适用 | 未执行 | 未开始 | 未发布 | 三平台已安装包/设备 |
| T21 | 未开始 | 不适用 | 未执行 | 未开始 | 未发布 | MySQL版本/规模/拓扑/容量等 |
| T22 | 未开始 | 不适用 | 未执行 | 未开始 | 未发布 | 全部AC及另行发布授权 |

仅原生认证生命周期的真实本地Go＋macOS Keychain配对通过；不是完整网站登录/2FA、已安装包或T19～T21验收。历史快照中的“未集成/进行中”由末尾交付记录取代。

## T01历史下一步与开工条件

T01已完成：十项scope、固定client/origin/callback/code寿命、IF-01～16路径/DTO/错误/单位/白名单、独立表/索引/锁序/迁移入口、限流/清理/开关、七工具支持设计及合成fixture/兼容矩阵已形成desktop-v1.0，ADR-002记录理由，API指针同步。核对由同一执行者对两端源码完成，没有虚构独立第二位reviewer；这些接口尚未实现。

下一轮编码授权后建议T02、T04、T12可独立起步，后续T03/T05/T06/T07按依赖接线。T02注册与迁移代码开发不是实际生产登记/迁移授权。Q07安全存储库/最低OS版本在T04内选型验证，未做明文fallback。MySQL精确版本/拓扑、隔离站/账户/平台、容量与灰度阈值分别是Q02/Q04/Q09，影响T19～T22；不需要重新回答产品方向问题才开始基础实现，但不能保证后续环境验证不会要求技术调整。需要产品范围变更时再向用户确认。

## 责任与跨仓库记录

角色尚未指派具体执行者。建议由本聊天后续被授权的执行者承担“接口契约/集成负责人”，维护权威文档；客户端与API执行者只负责各自任务/worktree与验证；产品范围及最终产品验收由用户，环境/发布由用户指定负责人。此安排只是工作方案，未创建执行者。

每个跨仓库任务使用以下记录，单仓任务另一端填“不适用（理由）”，不能只写分支名：

| 字段 | 填写格式 |
|---|---|
| 任务/验收 | T编号；AC/IF编号；基线ID/契约修订 |
| 客户端 | 仓库身份；独立worktree路径；codex/分支；起点SHA；交付SHA；工作区残留说明 |
| API | 同上；兼容的dev起点；迁移版本；client配置版本（不含secret） |
| 代码完成 | 日期、review范围、未完成项；不能替代测试 |
| 测试通过 | 命令、运行环境/数据库版本、退出码、证据路径、Mock与真实HTTP区分、限制 |
| 联调通过 | 两端实际运行SHA/包、隔离站点、合成账号矩阵、平台/浏览器、完整scope与AC结果、凭证已清理/撤销证据 |
| 发布完成 | 另行授权来源、API镜像/客户端包/迁移、开关、灰度与观察结果；没有就写未发布 |
| 兼容/顺序 | 可配对版本；S迁移→S应用/网页→C→灰度；不兼容组合的明确行为 |
| 回退 | 开关停desktop/保留revoke→配对应用回退；保留增量schema与撤销证据；revert提交及验证 |
| 风险/阻塞 | Q编号、责任人、下一步；不明项不标完成 |

## 验收结果模板

`AC编号 | T任务 | 客户端SHA | API SHA | 环境/平台/数据库 | 测试层级（单元/Mock/真实隔离联调/灰度） | 结果 | 证据 | 未验证限制 | 验收人/日期`。

每个AC至少包含正常、错误/权限、跨账号、恢复场景中相关的项。正式验收表全部18项填结果，不能仅勾任务“完成”。

## B1与T01验证记录

B1于2026-10-12已完成文档基础核验；T01于2026-10-13更新权威文件、追加ADR-002及t01-verification，不改原Word/source-audit/ADR-001。以下仅设计和文档验证，不是业务API测试。

- T01静态核对：两端固定SHA下OAuth/client/安全事件/Key/日志/统计/价格/性能/资料结构、迁移入口及七工具协议；IF-01～16对应AC-02～16正常/负例/恢复，全部18项AC仍由T01～T22覆盖。
- 文档一致性：`python3 /tmp/validate-tuzi-baseline.py`退出0；14个Markdown文件的本地链接、围栏、表格、常见凭证模式检查通过，18个AC、16个IF、22个T编号及全部AC任务覆盖、依赖DAG检查通过；两端B2版本指针同步。临时检查器不作为业务交付物。
- 合成fixture：Python JSON/Decimal断言退出0；6个JSON围栏解析通过，120s授权码及30m/7d/30d寿命裁剪、10s临近绝对截止、无损大整数、金额half-up舍入/单位、十项scope与八项native能力核对通过。样例不含真实凭证，不算真实HTTP/联调结果。
- 边界：上述检查器确认原有21输入逐文件SHA256不变、原API AGENTS前缀保留、两仓库HEAD/分支不变、暂存区为空且仅允许文档修改；双方`git diff --check`退出0。未运行构建/安装/业务测试/迁移/部署，没有创建分支/worktree/commit/push/PR或并行执行者。
- 限制：仅本地源码与先前公开入口非敏感证据，无法证明MySQL版本/拓扑/Redis/容量/所有实例版本。未执行网站浏览器、真实OAuth、系统安全存储、模型/支付/平台/负载验证；所有编码/单端测试/真实联调/发布仍未开始。

T01记录：C/S起点为source-audit的两个SHA；当前既有分支均codex/tuzi-assistant-dev，未新建，交付SHA不适用（文档未提交）；契约desktop-v1.0、迁移设计desktop-oauth-1；产品范围不变；相关问题见open-questions。后续实现必须登记两端独立交付SHA及实际验证，不能用本记录替代。

## 当前G1执行（优先于上方历史文档任务记录）

- 用户/goal正式授权G1本地编码、依赖、隔离测试、子智能体、worktree、本地commit及集成；不push/PR/部署，不进入G2。
- 两端集成分支codex/tuzi-assistant-dev。客户端已有分支符合本任务故继续使用，起点8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98；API依指定分支，起点72af0d4de3487033e800adcc38e42e320a993f75。
- 开工时C的AGENTS/docs/development/product-plan-v1.5/Word未跟踪，S的AGENTS已修改、指针未跟踪；均读取核对并保留，快照/tmp/tuzi-g1-baseline。只定向提交本任务相关基线文档/代码，不夹带附件预览。
- 主智能体负责公共契约/进度/指针和集成；server负责T02/T03/T07，worktree /Users/syd08/Documents/tuzi/tuzi-api-g1-server，codex/g1-server；native负责T04/T05/T06与lib.rs，/Users/syd08/Documents/tuzi-switch-g1-native，codex/g1-native；navigation负责T12/App.tsx/UI/i18n，/Users/syd08/Documents/tuzi-switch-g1-navigation，codex/g1-navigation。各自从对应集成起点建立，不共享可写目录。
- ADR-003闭合日志/退款/累计与窗口统计、安装标记/required、兼容回退和keyring3.6/固定HTTP；B3/desktop-v1.1保持scope/OAuth wire/寿命，G2日志增加refunded语义。设计闭合不等于代码通过。
- T02/T04/T12实施中，后续T03/T05/T06/T07按依赖；作者定向测试→稳定SHA非作者审查→修复复验→本地集成。代码/测试/真实联调/发布尚未完成。实际证据登记g1-verification.md。

### G1阶段提交与审查（进行中）

文档配对C `4aa2343` / S `196aef035`，均集成codex/tuzi-assistant-dev。navigation非作者稳定文档审查无剩余阻断。server首T02提交 `bd28e0fbb` 尚未集成：主智能体非作者审查要求修复schema/独立开关、显式迁移不兼容拒绝/已装缺失、清理锁围栏等；定向测试通过但不能标T02完成。原生与导航接线/测试继续。所有业务交付SHA与最终测试待登记，不建议此刻进入G2。

### G1原生与导航审查快照

- native稳定 `94fa489`：T04/T05安全存储与认证基础；作者报告Rust账户单测9通过/1忽略，显式macOS Keychain唯一合成条目测试1通过且删除后NoEntry。navigation正在非作者审查稳定提交。Windows/Linux和已安装包回跳未验证。
- navigation稳定 `216d7ba`：T12八入口/原工具导航；作者报告TS类型检查、renderer构建、17项定向测试通过。主审确认invalid状态保留令牌但页面不提供logout，clear失败也缺重试清除路径；已退回修复，并要求补回归测试。
- 主审另要求native将refresh journal恢复的localCleared修正为false，避免误报已清除；T06请求/cache及故障测试继续。上述均未集成，不能以作者测试代替最终复验。

### G1第二次审查快照

当前API任务分支稳定到 `1d5ddd76a`，原生任务分支到 `81a145a`，导航到 `4864283`；均未正式集成。主审定向Go测试通过但新marker版本探针失败；hard-delete-with-data撤销漏口已确认。navigation非作者发现插件把auth URL广播到WebView，native正在修复。T06真正并发401运输、T03网站、T07限流/清理/安全入口测试继续，G1保持未完成。详情见g1-verification。

### G1第三次稳定审查快照

API `8c0f887f1` 在独立review worktree的五包定向测试与未知marker版本探针均通过；删除/恢复不复活、token归属及scope绑定已补回归。剩余：冻结限流分桶尚未按规格实现，HTTP测试暴露custom scheme回跳构建错误正在修正，跨连接/并发及全部安全入口测试需补足。原生 `ff93465` 修复raw回调广播、存储读取失败的清除状态及退出后内存凭证保留；navigation非作者结构复查通过，实际运输故障测试继续。Rust→Go首次fixture试跑遇到测试服务Redis默认值错误，已停止并修复中，不能计联调通过。

## G1最终本地交付检查点（2026-10-13）

必要规范修订已闭合：B3 / desktop-v1.1 / scope desktop-v1，ADR-003。不改产品范围和令牌寿命，不进入G2/G4；所有发现的阻断代码问题已修复并复验。主智能体核查作者证据并在独立worktree审查API，navigation非作者审查native；主智能体审查T12，详见[g1-verification.md](g1-verification.md)。

| 仓库/任务 | 起点 | 已审稳定任务提交 | 本地集成代码检查点 |
|---|---|---|---|
| C T04/T05/T06 | 8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98 | codex/g1-native 34f4274de126b25d06745e7364b78167d2de712f | codex/tuzi-assistant-dev ec78f883dc536a35fbbd72ae88305227d0a1ef4c |
| C T12 | 同上 | codex/g1-navigation 4864283e3c73a6d8b037c7a398e0c68f666b9cff | 同上；native合并后导航合并，追加非作者已审MSW测试补丁 |
| S T02/T03/T07 | 72af0d4de3487033e800adcc38e42e320a993f75 | codex/g1-server 9abd1fa3eb64a3a5faa22e87f93526f4a0d6e276 | codex/tuzi-assistant-dev 615f501207b1c6d02be765fad97c469e6c213bc6 |

阶段提交保留独立任务历史；文档阶段C 4aa2343/5b21cc0/ee20c06/a8cad8b/81f419e，S 196aef035/be599deec。最终文档提交在上述代码检查点之后，可由本地git log定位；它们不改变运行代码配对。原Word/product-plan预览附件未提交、未改动；API主工作区无业务残留。子任务/审查worktree保留供复查，不无差别清理。

实际本地验证：Darwin arm64，临时SQLite文件/合成用户、独立macOS Keychain测试条目；集成C类型检查、24个UI/query/App测试、renderer构建通过；S五包定向Go测试、6网站组件测试/22断言、Vite网站构建通过。非作者native稳定34f4274测试18通过/2默认忽略，旧import定向30项此前通过且最终增量未改插件。显式真实Keychain＋Go认证/刷新/退出配对1项通过、条目删除确认NoEntry、fixture停止和临时DB清理；不是Mock，也不是完整网站浏览器验收。

兼容组合：上述C/S代码检查点，desktop-oauth-1 schema。未来另授权部署顺序仍为S显式迁移→S应用/网页（默认关桌面）→独立client登记→C→受控验证；本轮没有生产迁移/登记。兼容回退候选S 615f501须保持用户安全事务钩子/revoke/连接管理/cleanup/schema检测，关闭签发/刷新/业务并永久保留DESKTOP_SCHEMA_REQUIRED；保留schema/撤销证据，不回退未知桌面表的历史二进制。隔离SQLite开关/撤销/清理测试通过不替代实际MySQL副本回退演练。已提交代码变更通常git revert，不能用应用revert删除数据库证据。

仍受限：MySQL精确版本/主日志库拓扑、PG实库、多实例Redis与DDL/负载/回退实测；Windows/Linux安全存储及安装包；macOS实际默认浏览器、完整网站登录/2FA、OS冷暖回跳。G1代码交付完成不等于这些任务完整验收通过；T19～T22未开始、发布未完成。未使用生产端点/不明DSN，无push/PR/部署。

建议可进入G2本地开发，须新任务授权；不建议上线。最少后续环境信息是脱敏MySQL版本及拓扑、可用隔离DB/Redis测试环境、Windows/Linux/macOS安装包测试设备。缺少这些不阻塞冻结契约下的G2普通实现，但阻塞相应实库/平台/首版验收。本轮停在G1检查点。

最终补验：native34f4274（与集成原生代码一致）＋API集成5abbe82f6在真实macOS Keychain/Go loopback再次1项通过，消除早期API配对版本限制；服务和唯一条目清理完成。精确命令及证据见g1-verification末尾，未扩大浏览器/平台/数据库通过范围。

## G1 用户反馈修复（进行中，2026-10-13）

四项反馈经源码确认成立：text/plain绕过桌面专用授权限流、展示账户未绑定批准账户、临时刷新错误直接终止连接、连接列表遗漏RT闲置过期。按ADR-004冻结desktop-v1.1安全修订r1。起点C 1504b05250e47c0c5bb536674f6261d9cbcd8b66 / S 5abbe82f69ffb9fa754a2a4533b1a5b6a1cfbd28，均codex/tuzi-assistant-dev；原未跟踪Word及预览保留。server/native分别在独立codex/g1-auth-followup-server与codex/g1-auth-followup-native实施；主智能体负责公共文档和服务端非作者审查，navigation负责原生非作者审查。此次新增回归尚未通过，不把此前交付视为已修复。

### G1 r1 修复交付（2026-10-13）

上述四项已修复、非作者审查和当前本地验证通过，并集成回两端 codex/tuzi-assistant-dev。规范仍B3 / desktop-v1.1安全修订r1，scope/寿命/schema不变。T02/T03/T06/T07本次缺陷重新关闭；T12不变，不扩大G2，完整跨环境验收仍受限。

| 配对 | 已审任务提交 | 本地集成代码提交 |
|---|---|---|
| C 原生刷新/恢复 | 1ddb9b69164e0cbde583630ebf948232d2e6e09f | b85673968c4679db3878ac231ad6aebc82d58c3b |
| S 限流/授权页绑定/连接列表/刷新结果 | 155efcaf3e8ab7174d47bcbd3b9d6a3657c9ce62 | 6eca23f5a97828a91a2eb337acefd08a16c6013f |

作者server_finish/native_finish接续中断前独立worktree；review_finish在独立worktree审查原生稳定SHA，主智能体在新的API审查worktree审查服务端稳定SHA。无剩余已知阻断；原生23项通过/2默认忽略、Go五包通过、网站8项/28断言通过、网站构建通过。真实Go+macOS Keychain配对1项通过（含服务端503拒绝、RT保留及安全落盘、恢复轮换）；唯一条目删除后NoEntry，fixture停止PASS。集成后比对两端运行代码与已审/实测提交无差异，无冲突。详细命令、失败修复及限制见g1-verification。

代码完成、本地测试通过、上述限定真实配对通过；发布未执行。尚未验证MySQL/PG、共享Redis多实例、完整网站登录/2FA与安装包回跳、Windows/Linux及T19～T22。新增部署核验为共享SESSION_SECRET和代理结果头约束；旧网页与API须配对升级，无数据库迁移，不回退到本次缺陷版本。后续可在新授权下进入G2，但本轮停止在G1修复检查点。没有push/PR/生产访问；原Word/预览附件保留且未提交。

## R1/R2 修复后 G1 检查点（2026-10-13）

R1 旧 OAuth 授权兼容与 R2 token 请求体上限已修复，正式回归通过，非作者独立只读审查通过，无新阻断。R1 采用严格有界 `client_id` 分流：旧 client 保留 `UserAuth`，桌面 client 仅精确匹配后进入 `PureWebsiteSession`；R2 在任何表单读取前施加 64 KiB `MaxBytesReader`，middleware 与 controller 共享解析结果和解析错误，超限不消费 code/RT、不签发凭证。

| 配对 | 独立修复提交 | API 集成提交 |
|---|---|---|
| R1 | `8ffbf5d027f7ed824f5a7da3f65c3b9619b54c82` | `20f797d33a93642fedb666110d47837b9706fec0` |
| R2 | `0a319f14fa687b741a3f663d46208218b33f8fd8` | `1ff07d190fbb75d957b87ed906fc89a9daecb172` |

API 当前 HEAD 为 `20f797d33`，客户端继续为 `74aa8ed5de159e7ea2c7150e47e449fc660387eb`；客户端未改业务代码。五包定向回归及 middleware/controller/router 全量相关包测试通过。未执行 push、PR、部署、生产迁移。保留未验证的 race、实 MySQL/PG/Redis、多平台、完整浏览器/2FA 限制。

结论：修复后的 G1 检查点通过，**具备在新任务授权下进入 G2 本地开发的条件**；本轮停在 G1，不自动进入 G2，也不宣称可以上线。

## G1 独立复验与下一阶段（2026-10-14）

用户请求复验后，当前执行者核查 C `8e8ff2a974ebfd4565b7936dc02d5f3f06b8d897` / S `1cc7027863a2229fb5ffbc7f866c9cbc70a2e112` 及 R1/R2 修复增量，重跑五包定向 Go、三个相关 Go 包和网站授权测试，全部通过；上次独立探针在实际修复链复测亦通过。结论：G1 本地研发门禁通过，未发现当前检查范围内进入 G2 的阻断。证据与限制见 [g1-acceptance-review.md](g1-acceptance-review.md) 最新章节；不宣称全平台、实库、完整浏览器或正式产品验收通过。

建议下一目标为 G2 服务端 T08～T11 / 客户端 T13～T18 的业务实现、本地隔离验证和独立审查。目标提示词只在聊天中提供，不存入项目；它是基于现有 PRD 的执行入口建议，不是新增产品要求，也不代表用户已授权本轮执行 G2。本轮仅验收及文档记录，无业务修改、提交、推送、上线；原 Word/预览文件保留。T19～T22 及 Q02/Q04/Q09 对应实库/平台/发布门禁继续待办。

## G2 本地研发检查点（2026-10-14，最终）

本目标已授权 G2 本地编码、隔离验证、非作者审查、阶段提交和本地集成。T08—T11、T13—T18 全部完成范围内实现和 G2 本地验收，无剩余阻塞；TA-AC-1.5-B3 / desktop-v1.1 / desktop-v1 不变。上方 G1/未开始记录属于历史，不代表本轮状态。

| 仓库 | 本地集成分支 | 最终配对代码 SHA |
|---|---|---|
| 客户端 | `codex/tuzi-assistant-dev` | `49ea2584c2a6f8f9699ef62eb210aa63e778d268` |
| API | `codex/tuzi-assistant-dev` | `665f318466afce017a8db89c349eeedefcf7f3ea` |

- 代码：真实原生账户/Key/日志用量/模型性能/五字段资料/固定网页入口接入；七工具账户来源保存、完整备份、失败补偿、并发检查恢复已实现；不自动付费调用。
- 验证：客户端 typecheck、12 文件 113 项 React/查询/兼容测试、renderer 构建通过；Rust account 31 项、事务 12 项通过（默认忽略的配对测试另显式执行）；API 五包定向回归及独立性能引擎测试通过。固定提交非作者审查、修复复验及本地集成完成。
- 实际配对：最终上述 SHA 在隔离 Go HTTP/合成 SQLite → Rust 业务链路通过完整账户、Key、日志用量、模型性能、资料回读和鉴权错误验证，包含实时工具资格与一次性揭示来源证明。临时服务、DB、origin/stop 文件及 UUID 专用 Keychain 条目已清理。
- 兼容：桌面 create/reveal 输出网站复制动作一致的 `sk-` 模型 Key；存储、旧 API、relay 不变，无 G2 生产 schema 迁移。账户 OAuth 仍仅系统安全存储；本机来源关联排除导出/WebDAV。保留 G1/R1/R2 修复。

完整任务—AC—接口—实现—证据、命令、逐工具测试、固定 SHA 审查、复现与配对回退顺序见 [g2-verification.md](g2-verification.md) 和 [ADR-005](decisions/0005-g2-local-tool-transactions.md)。后续纯文档提交不改变上述代码配对。

发布与验收：未 push、PR、部署、生产访问/登记/迁移或付费测试；用户产品验收未代确认。T19—T22、真实 MySQL 版本/主库及 LOG_DB 拓扑、Redis 多实例、Windows/Linux 实机、三平台安装包和完整浏览器/2FA 尚待后续授权验证。G2 检查点通过，本目标停止，不进入 G3。

## G2 用户请求的独立验收（2026-10-14，最新结论）

本轮按用户“G2开发完成，请验收”的授权复核两仓库，结论为 **G2 暂不通过**，覆盖上方作者交付记录中“无剩余阻塞/检查点通过”的状态判断，历史验证证据保留。审查 HEAD 为 C `b78743fdcc352b3fb9d3b54cb53a04284db04eb1` / S `38ce291b661a4ff08ba73223c2cc750383f53b69`，运行代码仍为上方最终配对 SHA，基线不变。

- R1（P1，T08/T14、AC-07）：桌面 Key 写入接受逗号/空格分隔的多个 IP，但实际模型鉴权只按换行解析；禁止 IP 列表可能失效，允许 IP 列表会误拦。独立 HTTP 写入→数据库→实际模型解析/成员判断已复现。
- R2（P2，T14、AC-07/15）：Key 写入结果未知时，核实回读失败仍 clear 并解锁保存，可能重复创建。真实 React/QueryClient 隔离探针已复现；应同时检查创建/详情/取消/reveal 清除同一错误状态的旁路。
- 本轮 typecheck、113 项前端、renderer 构建、31 项账户 Rust、12 项工具事务、五 Go 包定向和性能全包测试通过；显式真实 Go HTTP/合成 SQLite → Rust 业务配对 1 通过，fixture正常停止，系统安全存储专用条目删除断言通过。现有回归未覆盖 R1/R2，不能据此关闭缺陷。

完整证据、修复验收要求与后续环境限制见 [g2-acceptance-review.md](g2-acceptance-review.md)。先修复两项并重新验收 G2，再决定进入 G3；两项均属既有需求，不需要新增产品范围确认。本轮只验收/隔离测试/文档记录，不修业务、不 commit/push/PR/上线、不自动进入 G3；原有未提交文档和附件保留，目标提示词未写入项目。

## G2 R1/R2 修复（2026-10-14）

按本轮修复授权，R1 IP 规范化与 R2 未知写入核实保护已实现并通过定向回归。C `29437625f85fcb8680386c5264670b6b0d498c97` / S `931b9bb12831c91a52c615ac031cedd56645fbcc`，均本地集成于 codex/tuzi-assistant-dev；范围、命令、结果和限制见 [g2-fixes.md](g2-fixes.md)。保留独立验收历史，修复交付供复验；不自动进入 G3，未推送或发布。

## G2 修复后独立复验（2026-10-14，最新状态）

核查 C HEAD `f9f153f19ca6413da9e17656b05e1175fa4d407d` / S HEAD `8ecf6c84ae5e97a95c7b42e56edd6ed658b4fa05`，两仓仍为 codex/tuzi-assistant-dev，基线不变。**R1/R2 独立复验通过并关闭；新发现 R3（P2，T13、AC-06/15），G2仍暂不通过，先修复再进入G3执行。**

R3：Overview 首次挂载后固定当日 start/end；跨午夜隐藏再显示触发重新读取时仍请求昨日窗口，同日重新读取也遗漏首次打开后的消费。独立真实组件/QueryClient/visibilitychange 探针在 10-14 23:50→10-15 00:10 的起止时间断言均失败。该场景已在T13原任务验证要求中，不是新增范围。

本轮 typecheck、12文件117项前端、renderer构建、五Go包定向、性能全包、原IP六场景及原Key失败回读探针均通过；当前HEAD真实Go HTTP/合成SQLite→Rust业务配对1通过，专用Keychain条目/临时服务/DB/标记清理。未改动的Rust账户和七工具事务复用前次通过证据，不声称本轮重跑全部Rust用例。完整任务覆盖复核、R3复现及修复标准见 [g2-acceptance-review.md](g2-acceptance-review.md) 最新章节。

G3的T19/T20/T21与Q02/Q04/Q09环境门槛保持待办；不把本地通过等同全平台、实库或发布验收。本轮仅复验及记录，未修改业务、提交、推送或上线；原有文档/附件保留。

## G2 R3 总览时间窗口修复（2026-10-14）

按用户本轮授权，仅修复 T13 当日消费刷新/跨午夜问题，客户端 `8462c0012a8fd91a6678ba03a7c25e340ab1f89d` 已本地提交于 codex/tuzi-assistant-dev。每次实际读取重算本地当日窗口，汇总与趋势共用范围并成对更新；保留隐藏取消、账户隔离，不增加轮询。6 文件 53 项前端回归、类型检查通过；上海与纽约（含 DST）总览时间测试通过。完整命令与限制见 [g2-fixes.md](g2-fixes.md) 的 R3 章节。修复供独立复验，保留此前验收发现，不进入 G3，未推送或发布；API/原生/契约无修改。

## G2 最终独立复验（2026-10-14，最新结论）

**R1/R2/R3均关闭，G2本地研发门禁通过，具备进入G3验证阶段的条件。** C HEAD `43ac2941036042453b0753f6df47d0048117448f`（R3代码 `8462c0012a8fd91a6678ba03a7c25e340ab1f89d`）/ S HEAD `8ecf6c84ae5e97a95c7b42e56edd6ed658b4fa05`（代码 `931b9bb12831c91a52c615ac031cedd56645fbcc`），均 codex/tuzi-assistant-dev，基线不变。

原独立R3跨午夜探针及R2失败回读探针通过；本轮typecheck、12文件121项前端、纽约时区含DST的5项窗口测试、renderer构建通过。增量审查确认每次实际读取重算当日窗口，汇总/趋势同参数、成对更新；隐藏取消、迟到结果丢弃、账号隔离与原页面回归通过。API/Rust无增量，复用前两轮Go/Rust/真实业务配对证据，未在本轮重跑或声称完整浏览器/安装包联调。

当前检查范围内无剩余已确认G2阻断；完整证据和限制见 [g2-acceptance-review.md](g2-acceptance-review.md) 最新章节。下一阶段T19先行，T20/T21按依赖推进；Q02/Q04/Q09实际环境/设备/容量事实仍待落实，缺条件的验证保持阻塞。G2通过不等于G3或正式产品/发布验收通过。本轮仅复验与文档记录，无业务修改、commit/push/PR/生产操作，不自动执行G3；原有未提交内容保留。

## T19 本地功能预览子集（2026-10-14）

用户授权补齐本地环境并体验功能。新增 debug-only 固定 localhost origin/test client、独立预览 bundle 和数据目录、隔离合成 SQLite/Login/OAuth/desktop 服务与严格 Vite 代理启动方式，契约 B3 / desktop-v1.1 / desktop-v1 不变。实际 Chrome 登录→完整权限授权→macOS 协议回调→原生系统安全存储→桌面已连接及总览/模型页展示通过。debug .app 构建、原账户回归 31 项和新增 pending 隔离重启回归 1 项通过。详见 [本地预览记录](local-preview.md)、[ADR-006](decisions/0006-local-preview.md)。两仓基于 C 43ac294 / S 8ecf6c8 的本地增量，未提交、推送或部署；既有脏文档保留。当前服务留给用户体验，重启脚本使用后续环境清理改进。不是 T19 全项或 G3/发布验收。

### 本地完整网站准备（2026-10-14，最新）

后续用户本地添加渠道并发送模型请求，暴露 fixture 漏挂 `/v1` relay 路由的 404。已挂载原 `SetRelayRouter`、初始化渠道缓存并重启保留用户数据；3180/5180 无凭证 POST 均由原鉴权返回标准 401。未代发上游请求，实际模型响应/扣费/日志待用户测试；不再将此启动模式描述为不支持 relay。

按用户补充授权，保留原网站名称与支付行为，改为完整 API/Dashboard 路由及独立持久 SQLite，共用账户、密钥、日志和资料。此前仅桌面 fixture 的路由/账户 DTO 不完整导致原网站显示异常，临时数据库也不适合连续体验。首次合成数据包括余额、密钥及 27 条日志；启动脚本严格绑定独立端口并保留数据，助手本地充值/兑换/资料入口跳转原本地网站页面。未配置真实支付商户或模型上游，不模拟付款成功。

全新目录初始化、重启不重复播种、原网站真实登录与主要接口、桌面账户/密钥/分组/资料/模型/能力及资料写入后网站回读均通过；SQLite 保留字迁移执行测试、Rust 固定网页入口测试、debug .app 构建和脚本语法检查通过。最终服务已启动在 5180/3180，助手已运行，用户交互验收待完成。当前版本原生浏览器登录链路尚未重新完成，不复用历史 UI 验证冒充本轮结果。记录见 [local-preview.md](local-preview.md)。本轮未提交、推送或上线，既有修改保留。

## V01 兔子账户前端视觉优化（2026-10-14）

按用户本轮授权，在 `codex/account-visual-v01` 基于客户端 `43ac2941036042453b0753f6df47d0048117448f` 完成八个账户页面、表单和配置面板的视觉优化。仅展示结构、账户专用样式、现有数据可视化及展示文案；App/工具管理/请求逻辑/后端未因本任务修改，B3 / desktop-v1.1 不变。已有未提交文档、原生本地预览改动和附件保留，未混合提交。

类型检查、改动文件格式与 diff 检查通过；8 文件 61 项账户/工具兼容回归通过；最终 renderer 与 macOS debug 本地预览构建通过。浏览器实际逐页验证全部八页及深浅主题、600/900/1280 窗口、加载/空/错误/离线/未连接状态；macOS 最终构建补查本地账户数据及工具管理。原生资料表单读取与完整写入链路不作通过声明，完整资料展示使用隔离真实组件预览验证。截图、参考差异、具体命令及限制见 [V01 验证与预览](account-visual-v01/README.md)。未提交、推送、发布或执行 G3 全项/支付/生产操作。

## 2026-10-15 本地提交与原开发分支恢复

用户明确授权整理既有改动为本地提交，并切回原分支且保留全部提交。此次仅整理 G1/G2 验收记录、T19 本地预览子集及 V01 视觉优化，不新增产品范围；基线 TA-AC-1.5-B3 / desktop-v1.1 / desktop-v1 不变。上文各轮“未提交”保留为历史，本节为当前状态。

客户端已从 codex/account-visual-v01 切回 codex/tuzi-assistant-dev 并完成 fast-forward；原分支包含全部新提交，无冲突或历史重写。API 仍为 codex/tuzi-assistant-dev。

| 内容 | 本地提交 |
|---|---|
| 客户端 G1/G2 验收记录 | d6913bc |
| 客户端 T19 预览隔离及授权 pending 命名空间修复 | 6d792f8 |
| 客户端 V01 页面、测试与视觉证据（当前配对代码） | 493cd81509460c0bbd8c3fe9ead52bb3a93133b5 |
| API 持久化预览 fixture、严格代理与说明（当前配对代码） | 575800f9bbeda3692266c9f8b70f63677c362812 |

本轮验证（macOS 本机，未重启既有预览服务）：

- `pnpm typecheck`、`pnpm build:renderer` 通过；既有包体积、动态导入和浏览器数据提示保留。
- `pnpm test:unit --run tests/components/AccountPage.test.tsx tests/account tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx`：8 文件 61 项通过。
- `pnpm exec prettier --check src/components/account/*.tsx src/components/account/account.css src/i18n/locales/{zh,en,ja}.json tests/account/desktop-business.test.tsx tests/visual/*` 通过。
- src-tauri 中 `cargo test --lib tuzi_account`：沙箱内因本机 TCP bind 权限失败；获工具权限后重跑 32 通过、3 忽略。忽略真实安全存储及真实 Go 配对用例，本轮未代替执行。
- src-tauri 中 `cargo test --lib --features local-preview business_allowlist_and_web_urls`：1 通过。
- API `go test ./router -run '^(TestPreviewSQLiteReservedColumn|TestDesktopLocalPreview)$' -count=1` 通过；SQLite 保留字测试执行，服务 fixture 因无 opt-in 环境变量跳过。
- 两仓 `git diff --check`、客户端 `bash -n scripts/build-local-preview.sh`、API `bash -n scripts/desktop-local-preview.sh` 通过。

代码已提交，以上定向验证通过；本轮未重新执行完整浏览器/原生写入联调或三平台验收，不将历史截图和组件测试作为新增功能验收。G3 T19—T21 全项、G4 T22 和用户产品验收仍未完成。未 push、PR、部署、生产访问或迁移；本轮代码配对不是部署证明。原 Word 与 docs/product-plan-v1.5 附件继续保留未跟踪状态，没有纳入提交；本地数据库、日志、会话密钥及构建产物不提交。

回退：视觉优化可独立 revert 493cd81；若撤回配套本地预览，先停止使用预览客户端/服务，再 revert 客户端 6d792f8，最后 revert API 575800f9b。保留本地独立数据及原有用户配置，不用 Git 清理数据。后续真正发布仍按 T22 另行授权并核查版本和部署顺序，本轮不执行发布。

## T12-N01 账户与工具平级导航（2026-10-15）

用户确认预览的导航层级并授权“开始改吧”。客户端在 `codex/account-peer-navigation` 基于 `960daa887b18d9f9e2b1701783e7c08086e0c8c9` 实施；沿用真实应用原有样式。移除独立的“兔子账户 / 工具管理”栏，将账户放到七工具切换栏最左侧，账户页保留兔子switch品牌、设置入口和账户内部导航。账户与工具分别显示当前选中状态，从账户可直接返回此前所选工具；账户不写入最近工具偏好。

宽度充足时显示图标和完整名称，空间不足时统一收为图标并保留名称提示。真实窗口验证发现工具栏宽度缓存会使账户页保持收起，已在页面或工具切换时重测，并增加该场景回归。仅修改 React 展示和布局逻辑，无 API、原生业务、凭证或接口契约变更；基线 B3 / desktop-v1.1 / desktop-v1 不变。

验证环境为本机 macOS，结果如下：

- `pnpm typecheck` 通过。
- `pnpm test:unit --run tests/hooks/useAutoCompact.test.tsx tests/components/AccountPage.test.tsx tests/account tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx`：9 文件 63 项通过，覆盖账户/工具切换、七工具兼容、原工具回归与布局宽度缓存。
- `bash scripts/build-local-preview.sh` 通过，生成最终 macOS debug 预览应用；现有浏览器数据、动态导入和 Rust dead_code 警告保留。
- 真实原生窗口检查账户首位、原品牌顶栏、账户与 Claude 往返、宽窗口完整名称、约 904px 窄窗口图标以及从较长工具栏切回账户时重新展开。最终应用已打开；只核对导航和布局，不认定本轮已完成 OAuth 或账户写入联调。
- 修改的 TS/TSX 文件 `pnpm exec prettier --check` 通过，`git diff --check` 通过。

代码与上述定向验证完成，用户视觉验收待完成。未推送、创建 PR、合并或发布，不替代 G3 全项/跨平台验收；既有未跟踪产品文档和 Word 附件保持原状。本任务可通过独立本地提交 revert 回退。

### T12-N01 后续修复：切换溢出与侧栏去重（2026-10-15）

根据用户截图和本轮明确要求，在同一任务分支 `codex/account-peer-navigation`、基于 `539b843` 修复两项前端问题。此前只观察工具栏外层宽度，Hermes → OpenClaw 的 `AnimatePresence` 退出动画完成后，新增操作按钮改变内容宽度却不会触发重测；现同时观察内层内容，并在展开动画锁到期时执行被延后的检查，定时器随 effect 清理。账户侧边栏移除顶部重复品牌标题块及无用 CSS，保留内部导航和底部连接状态。无 API/Rust/凭证/契约改动，基线不变。

本机 macOS 验证：`pnpm typecheck` 通过；上节同组定向测试 9 文件 **64 项通过**，新增内容延迟变宽、展开锁期变化与卸载定时器清理回归；`bash scripts/build-local-preview.sh` 通过（既有构建警告保留）。最终原生应用实测约 1247/1304px 下图标布局及右侧完整操作，约 1338px 下 Hermes 完整名称 → OpenClaw 自动收起、五个操作按钮与添加按钮完整显示；切到账户确认侧栏直接从总览开始、连接信息保留，顶栏名称正常展开。应用已重启为最终构建并留在账户总览供用户验收。

改动文件格式检查和 `git diff --check` 通过；仅本地实现/定向验证，不代表账户业务联调、G3 全项或跨平台验收。未推送、PR、合并或发布，既有未跟踪文档/附件保持原状。

## 2026-10-15 Phase 1 首期开放面与密钥工作区

用户确认先实现简单合理的分阶段隐藏，并明确 API 站原有网站不改，只隐藏提供给兔子助手的能力。客户端已在本地任务分支完成并 fast-forward 同步到用户指定的 `codex/tuzi-assistant-dev`；API 仓库也在该分支。客户端提交为 `de3b579`，API 提交为 `111497e6f`。实现范围：API `/api/desktop` 增加 Phase 1 闸门并在 capabilities 返回 release；客户端移除账户侧栏，固定 API 密钥页，将总览四项摘要放到密钥区上方，筛选压缩为名称/密钥片段/分组/状态，暂不显示配置到工具入口。未 push、PR、部署或生产操作。

2026-10-19 CNY/遮罩补充验收：已正常退出旧预览并启动最新构建，实机确认CNY标签、配置弹窗遮罩覆盖顶部工具栏；此前“实机复验待完成”状态已解除。代码仍为ad0fcb1，API未修改。

2026-10-19 文字发虚跟进：客户端 `04b44c4` 移除账户弹窗translate/缩放动画，以布局居中；颜色字号不变。格式、构建通过，新预览已重启并核验弹窗布局，实际字形锐度待用户确认，详见B09验证文末。

2026-10-19 配置白屏修复：客户端 `59c9400` 安全排除协议或分组元数据为空的模型，避免.some渲染异常。11测试、类型和构建通过，新预览配置→Codex实机无白屏；API未修改，配对和证据见B09验证文末。

2026-10-19 模型选择器优化：客户端7a5fdb0合并搜索与选择，技术原因只在对话解释；8测试、类型与构建通过，已重启并实机验收下拉空态和Esc交互。API未修改。

2026-10-19 Codex 新建配置 Key 回填修复：显式账户创建草稿直接使用所选模型 Key，保留已有供应商读取凭证逻辑。20 项定向测试、类型和构建通过，新预览实机已确认密码字段填充；未保存配置/调用模型。本轮修复与临时夹具均未提交，详见 B09 验证文末。

## B16 模型端点兼容（2026-10-19）

代码 `f64ebcc8c2b6a625cb6a6528b32657e9817d75b0` 配对 API `21cd7acd51349407cdc5d332a763907d065f9a86`，两仓 B 分支、system-token-v1 不变。前端/原生共享端点映射，兼容 claude code、gemini generateContent 和 OpenAI-Chat 大小写，保持 Key 校验及工具保存语义。公开 662 模型协议识别核查无原可识别项减少；61 前端、3 原生资格、14 保存回归、类型及 macOS 构建通过。未推送/发布，临时夹具未提交；见 [B16验证](model-endpoint-compatibility-verification.md)。

### B16 本地夹具默认关闭（2026-10-19）

按用户要求，注释 `business.rs` 中临时模型夹具的调用入口，保留实现和测试，补充重新开启/关闭及重建说明；`local-preview`、固定本地 origin、禁止 release 使用预览 feature 的隔离仍保留。仅此本地测试适配，未改变正式模型兼容规则或 API。两仓仍为 B 分支，客户端 HEAD `44a809125bf1f42de1b06ff5ecbce81b531c9ce3` / API HEAD `21cd7acd51349407cdc5d332a763907d065f9a86`，契约不变。

`CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib --features local-preview tuzi_account::business::`：4 项通过（包含保留夹具的范围/Key 限制回归），日志 `/tmp/tuzi-fixture-disabled-tests.log`；`rustfmt --check --edition 2021 src-tauri/src/tuzi_account/business.rs`、`git diff --check` 和本地备份补丁反向适用性检查通过。源码入口已关闭，本轮未重建或重启应用，旧预览不自动变化。说明及更新后的补丁保存在仓库外 `~/Library/Application Support/com.tuziswitch.desktop.preview/local-responses-fixture/`。本轮全部改动未暂存、未提交、未推送，原有工作树修改保留。

## B17 提交前审查修复（2026-10-19）

按用户要求，仅修复第 1 项删除成功但响应丢失后的确认恢复、第 3 项超过3个模型时工具配置校验失败；第 2 项空分组不修改。API 为本人 Key 的不存在响应补充 `error.code=not_found`，保留 HTTP200/success/message；客户端据明确不存在语义回读并仍需手动确认。原生模型资格查询按3个一批、固定快照串行校验，全部通过才继续原保存事务。

两仓仍为 `codex/tuzi-assistant-system-token`，客户端 HEAD `44a809125bf1f42de1b06ff5ecbce81b531c9ce3`、API HEAD `21cd7acd51349407cdc5d332a763907d065f9a86` 加本轮未提交增量；已有工作树修改保留，默认关闭的夹具入口未变。API 3包回归、前端112项、原生账户40项（1既有忽略）、工具保存14项、类型及格式检查通过。仅本地分层验证，未重建预览或新增完整真实联调，未提交/推送/部署；上线须先 API 再客户端。完整证据及回退见 [B17验证](prepush-fixes-verification.md)。

## B18 提交与 PR 交付（2026-10-19）

用户在 B17 修复后明确授权：提交并推送两个 `codex/tuzi-assistant-system-token` 分支的全部现有修改，API 创建目标为 `dev` 的 PR，客户端创建目标为 `main` 的 PR；不包含合并、部署或生产操作。本节取代此前阶段“保持未提交/不推送”的当前状态，历史验证记录按原时点保留。

本次代码配对：客户端 `7e8b2085845b56fbbf3147ffa8510c1982bc10ba`，API `407c9c9287fcf8bccd0fa9601c83dc82ed11e61b`；后续配对说明提交仅改文档。契约仍为 `TA-AC-1.5-B4` / `system-token-v1`。客户端纳入既有 Codex Key 回填、OpenCode 预设回归、默认关闭的本地夹具及兔子图标源文件；B17 第 1、3 项已修复，第 2 项空分组按用户要求保留。

沿用 B17 分层回归结果；本次补跑 ProviderForm/useCodexConfigState/OpenCode 预设 3 文件 10 项测试通过，两仓 diff 检查通过。未扩大声称真实联调/三平台/生产数据库验证。部署仍须先 API 后客户端，回退反向，无迁移、清表或令牌轮换。PR 中记录最终分支 SHA 及配对链接；远程成功状态以实际 GitHub PR 为准。

### B18 API 最新 dev 合并后的配对

用户追加要求 API 在推送前同步最新远程 dev，已将 `680ddc3c446c66a8294c302245233ea7196f5d21` 合并为 API `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425`；客户端业务代码仍为 `7e8b2085845b56fbbf3147ffa8510c1982bc10ba`，之后仅文档变更。两仓 `codex/tuzi-assistant-system-token` / B4 / system-token-v1。

唯一冲突是7份语言文件顶部双方新增翻译，已同时保留助手2条和dev19条内容，JSON/重复键/三方语义检查通过。合并后API17个相关Go包、网站48项引导及95项utils测试、网站构建全部通过；命令与日志见API `docs/tuzi-assistant-development.md` 的 B18 同步记录。此前“本地未提交/未授权推送”是历史阶段状态，本次已获明确提交、推送和创建PR授权；未合并PR或部署。最终远程分支SHA及关联PR以GitHub记录为准，API优先部署及反向回退顺序不变。

### B18 保留原发布文案

用户明确要求撤回工作流中3处名称修改：两处Release标题及一处更新清单notes继续使用“兔子switch”，`.github/workflows/build.yml` 与目标main保持一致。客户端窗口/图标/账户品牌及其他已提交实现均保留；此次仅恢复发布文案，无运行逻辑改动。完成精确3处差异及diff检查后提交，再推送并创建目标main的PR。


## R01 v1.4.0 安装包发布准备（2026-10-21）

用户本轮明确授权检查已合并 PR、更新版本、构建安装包并发布 GitHub Release。客户端 PR #48 已于北京时间 2026-10-21 15:04 合入 main，合并 SHA `25b76e9be74c63ccc131be91ae3faa48811faf65`。本次从该 main 建立 `codex/release-1.4.0`，仅将 package.json、Tauri 配置、Cargo.toml 和 Cargo.lock 的应用版本由 1.3.1 同步更新至 1.4.0；使用显式 Git 操作，不执行带自动 push 的 npm version/postversion。基线 B4 / system-token-v1 不变。

API PR #277 已合入 dev；公开入口响应头 `x-new-api-version: dev-20261020-09db95bd7440`，GitHub compare 确认该 SHA 包含 #277 合并提交 `70e5f2b2f624c7b721064cedc9994238973a8875`。这只核实公开入口版本标识，不替代所有实例或生产数据库验收。API 本地目录未修改。

发布前本机 macOS 验证：`pnpm typecheck`、账户与工具配置 6 文件112项测试、updater 2项测试、`pnpm build:renderer`、内置图片兼容脚本3项Python测试通过；`cargo test --locked --lib tuzi_account` 40通过/1既有真实配对测试忽略，`cargo test --locked --lib services::tuzi_provider` 14通过，均使用合成数据。四份版本一致，`git diff --check` 通过。保留既有 React DOM 嵌套、浏览器数据和打包体积警告；不宣称完成三平台安装运行或新的真实账户联调。

计划通过 v1.4.0 标签触发现有 Build & Release，生成 macOS Apple Silicon、Windows x86_64 和 Linux x86_64 安装包及已配置签名的更新清单；此条记录时远程构建/Release 尚未完成，以 GitHub 工作流和 Release 附件为准。历史未授权发布文字属于各阶段时点状态。旧 A 预览用户需重新粘贴系统令牌，原钥匙串不自动迁移或删除。回退保留旧 Release 和用户数据，客户端优先于 API，不重写标签、不清表或轮换令牌。

## R02 v1.4.1 本地缺陷修复（2026-10-21）

用户授权在 `codex/tuzi-assistant-system-token` 修复 Key 模型列表、下拉滚动和 Codex TOML 编辑/保存，并打开本地构建测试。客户端实现与145项前端、41项账户测试通过；全库原生1405通过、1项历史恢复测试失败、1忽略，明确保留限制。独立测试应用已构建并打开，API未改动，未推送/发布，实际Key及用户验收待完成。详见 [R02验证](r02-model-editor-verification.md) 和 [ADR-012](decisions/0012-key-model-list-and-toml-drafts.md)。

## R03 Codex 模型列表实际验收纠正（2026-10-21）

R02 用户实际验收未通过：额外协议过滤导致模型仍缺失。R03 将 Codex 展示/选择与手动获取列表统一，保存保持 Key 权限及成员检查，其他工具不变。前端96项、原生账户42项通过（1真实配对忽略），API未改，详见 [R03验证](r03-codex-model-list-verification.md)。实际账户验收仍待完成。

## R04 Codex 首次添加保留自定义名称（2026-10-21）

用户批准统一修复Codex各线路首次添加、再次编辑及落盘命名。仅凭证索引仍受程序管理，不再自动重命名用户provider；增加冲突提示及初始账户草稿独立标识。110项前端、29项供应商、67项Codex、14项账户工具和3项真实文件回归通过；独立R04测试包构建完成。API未改、未推送/发布，实际验收待完成。详见 [R04记录](r04-codex-provider-identity.md)。

## R05 密钥搜索交互（2026-10-21）

客户端修复筛选栏跳动、搜索输入期间报错及后4位精确匹配错误；固定反馈区域、300ms防抖、同账户保留列表及失败重试。类型检查、100项前端及43项原生账户测试通过（1项既有忽略），合成UI确认筛选栏位置稳定。API未改，实际用户验收待完成，见 [R05验证](r05-key-search-verification.md)。

## R06 模型选择器三项修复（2026-10-21）

按用户授权完成第1、2、4项：统一“已获取 N 个模型”、隐藏未知协议禁用项并补空态、修复模型接口缺少端点详情时Claude/Gemini已知标签被误过滤。共享协议表同时影响前端和原生保存，Codex完整列表规则保留；第3项搜索清空明确未修改。客户端基于fa0f078在system-token分支本地实施，API 2e72a8b保持不变。类型、110项前端、43项原生账户（1既有忽略）和renderer构建通过；完整边界见 [R06验证](r06-model-picker-verification.md)。未push或发布，实际Key及安装包验收未执行。

## R07 Codex账户凭证读取（2026-10-21）

按用户修复及重新构建授权，新增TUZI_SWITCH独立引用识别并接入资格/缓存门；不再错误拒绝账户保存生成的env_key。58项Codex、14项账户工具、31项模型检查、29项供应商定向测试通过，包含真实隔离保存→数据库去明文→异步读取两条不同Key。API与搜索清空逻辑未改；R07沿用R06隔离数据，仍不切换日常Codex。详见 [R07记录](r07-codex-credential-verification.md)，无push/PR/发布，实际Key验收待用户执行。

## R08 Codex 同名 provider（2026-10-21）

用户批准不同供应商卡片共享 `custom` 等 TOML 标识，替代 R04 全局唯一及未启用预注册规则。保存与生效分离，启用时整体替换目标表，独立凭证和账户事务保留；同名往返切换、未启用编辑、删除、MCP及账户恢复合成回归通过。API、搜索清空未改；仅本地，未推送/发布，实际验收待用户完成。见 [R08验证](r08-codex-duplicate-provider-verification.md) 与 [ADR-013](decisions/0013-codex-card-local-provider-ids.md)。

## R09 Codex 配置失败补偿（2026-10-21）

用户明确授权修复后提交、推送并创建客户端目标 main 的 PR；不含合并或发布。普通表单准备不提前写Key；Codex普通保存/启用及供应商页代理热切换加入补偿，覆盖数据库、当前状态、配置文件和独立凭证；账户事务继续复用。逐写入点错误、数据库/代理备份错误及外部冲突回归通过。全库单元1415通过、1既有历史恢复失败、1忽略，详细限制见 [R09验证](r09-codex-transaction-verification.md) 与 [ADR-014](decisions/0014-codex-save-activation-compensation.md)。API与暂缓的搜索清空未改。
