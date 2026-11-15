# UC-FIX-03：模型获取、生图接口识别与任务删除

日期：2026-11-04（Asia/Shanghai）。基于 `codex/opentu-assistant-sync` / `d055a8e34a925014292f16889f6fcf0a8c753dba`。本轮用户反馈并要求修复：账户关联生图立即报错、历史删除无响应、获取模型需反复点击、新供应商“保存并获取模型”不可用和持续同步。本轮本地修复、合成验证及用户授权的隔离原生真实账户/生图验收；未修改版本、推送、发布或替换公网安装包。

后续交付：用户明确授权发布后，本修复已包含于 v1.5.3，安装包与下载页已公开并核验；见 [UC-REL-03](2026-11-04-v1.5.3-delivery.md)。下文“未发布”描述修复验收阶段的状态。

## 发现及修复

| 问题 | 证据与原因 | 修复 |
| --- | --- | --- |
| 生图立即拒绝 | 原生 `supports_action` 只接受 `openai-image` / `image-generation` 等旧标签；2026-11-04 公开价格目录里的目标图片模型声明 `generate` / `edit`，本地 API 源码的 `/v1/models` 只附接口类型，无 endpoint 详情。相同形状的合成账户目录可复现拒绝。 | 在可信 Key 目录内识别 `generate` 和 `edit`，仍校验模型归属、Key 状态、操作类型和显式路径/方法，不凭模型名称或公开价格目录授予权限。用户实际 Key 响应未读取，不能据此断言其账户权限正常。 |
| 删除无反应 | 真实浏览器合成失败任务点击后，确认框位于 `.creative-root` 外，计算样式为 `display:block` / `z-index:auto`，不受构建后的作用域样式控制。 | 共用 `DialogContent` 默认使用宿主 `creative-portals`，仍优先显式 container；独立运行回退 body。修复后实测 `display:grid` / `z-index:5200`。 |
| 获取反馈迟、重复点击 | loading 在异步保存与补填 Key 后才设置；按钮没有覆盖整个操作的同步锁。获取前还强制刷新可选价格目录，最长先等 15 秒。 | 点击立即锁定，覆盖保存和模型请求；复用有效价格缓存，可选元数据只等待最多 2 秒。成功自动打开选择框，保存失败/获取失败留在当前配置显示原因。 |
| 持续“同步中” | 旧实现仅给 transport 发送 abort；若 transport 或响应正文不响应取消，调用仍可永久 pending。 | 模型响应头及正文整体与 15 秒超时/主动取消竞争；即使底层忽略取消，也能退出等待。超时后允许重试，旧响应不得覆盖当前结果。切换供应商、关闭配置时取消旧请求，修正取消被备用地址逻辑吞掉的问题。 |
| 原生大响应被误判失败 | 用户自行配置隔离账户后，真实 macOS 客户端单击获取模型返回“请求结果待确认”。宿主 `nativeCreativeResponse` 在 invoke 成功但 Channel 尚未收到 end 时立即报错；Tauri 对超过 8192 字节的 JSON Channel 消息另行异步 fetch，完成通知可先于数据到达。此前 mock 全部同步发送 Channel，遗漏此时序。 | 等待显式 end 完成响应；命令成功后保留最多 30 秒交付期限，结束、取消均清理定时器。账户和手动请求共用修复；不自动重放请求。补充延迟大正文、延迟响应头、交付期间取消与缺失 end 超时回归。修复后原生单击模型获取及真实图片生成通过。 |
| 原生错误原因被统一隐藏 | 用户手动提交的失败任务详情仅显示“配置操作失败”，无法区分权限、网络、限流或参数。 | 为已知原生错误码补齐固定中文提示，不暴露原始诊断或凭证。此前失败记录的精确原因无法倒推，不把它事后归因于某个已修复问题。 |
| 加载阶段绿色进度圈 | 桌面 SVG 占位组件所有非失败阶段均使用绿色 spinner；用户明确选择“去掉进度圈，只显示正在加载图片”。 | developing/inserting 不再绘制进度圈、进度条和副标题，仅显示“正在加载图片”；浏览器组件同步文案及无圈状态。生成阶段的进度反馈保持。 |

无新增业务持久字段、账户契约、权限或依赖。保留手动配置、已选模型与已有本地任务；不读取日常客户端凭证、不删除用户任务。测试夹具增加 `model-fetch-qa=1`（3 秒延迟，首次失败）及 `model-fetch-qa=stall`（首次无响应）参数，仅在本地预览入口启用。

## 验证

- 创作定向测试：确认框 3 项、供应商目录 14 项、模型按钮 5 项、历史筛选 3 项、凭证刷新 4 项、原模型目录 24 项；覆盖取消、重试、慢保存、防重复请求、Key 输入取消、超时响应头/正文、迟到结果、公开目录不扩充 Key 权限。
- 宿主桥接与接口兼容测试：2 文件 69 项通过。
- 原生 `cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::creative`：10 项通过。合成 HTTP 账户绑定、持久化重载、`generate`/`edit` 目录校验和生图请求通过；反例覆盖错误模型、错误操作、冲突路径/方法、跨账户身份及取消不重放。
- `pnpm typecheck`、`pnpm build:creative` 通过。保留既有 Sass 除法弃用警告。
- 实际浏览器：独立 `127.0.0.1:5206` 存储域，生成合成失败任务；删除取消保留，确认后移除，刷新后仍为 0。账户关联模型获取单击显示 loading；首次失败有持久提示，单击重试打开模型列表；新建供应商→选择合成 Key→改名→单击保存并获取→选择图片模型→添加后显示已添加 1 个和配置已保存。
- 实际浏览器补充：底层永久 pending 时退出 loading 并显示超时，重试可打开模型选择；请求中切换供应商后，切回可再次获取，无过期选择框弹出。
- 最终完整回归：创作 111 文件 / 1852 项、宿主前端 93 文件 / 678 项全部通过。桥接定向 29 项、加载文案组件 5 项及类型检查通过。包含加载文案调整的原生 app 构建成功。
- 未重新发布安装包，公网 v1.5.2 不包含本修复。

## 真实验收进展

用户明确授权向 `api.tu-zi.com` 使用隔离测试账户生图，费用不设上限。用户确认自行配置测试账户，并确认曾手动提交 1 次生图，该任务失败。随后用户明确允许代理追加最多 1 次；代理在新验收画布提交 1 次 `gpt-image-2`、单张图片，成功，未再次提交或自动重放。不读取日常客户端凭证、不把凭证写入记录。

原生隔离包使用 `--debug --features isolated-profile --bundles app --config src-tauri/tauri.acceptance.conf.json` 构建，线上账户地址、非 local-preview。App 名 `Tuzi Assistant Test`，标识 `com.tuziswitch.desktop.acceptance`。窗口控制曾间歇出现 ScreenCaptureKit -3811/-3812，经重新绑定与用户保持前台后恢复；这属于测试控制限制，不记作客户端业务通过或失败。

| 原生真实流程 | 结果与证据 |
| --- | --- |
| 账户连接、重启保留连接 | 已连接，重启仍保持；只使用用户在隔离客户端配置的账户。 |
| 获取模型 | 修复前实际失败；修复后单击显示 loading，随后打开 620 个模型列表。截图 `native-models-success.png`。 |
| 首次保存并获取模型 | 原生新建本地供应商“原生首次保存验收”，关联用户已配置的 test Key；单击按钮立即进入 loading，成功显示 620 个模型。搜索并添加 gpt-image-2 后显示“已添加 1 个 / 供应商配置已保存”。截图 `native-first-save-models.png`；未创建远程 Key、未追加生成请求，保留原默认供应商。 |
| 生图→画布 | 代理追加的 1 次真实请求成功，蓝兔插画在画布可见。截图 `native-generated-canvas.png`。 |
| 右键复制图片 | 首轮仅确认 toast，发布前补验通过：原生右键复制生成图，Chrome 本机验收页通过系统 Cmd+V 收到 1254×1254 PNG（1,929,238 字节）。同一浏览器解码后与另存为原图比较，6,290,064 个 RGBA 通道差异为 0；不以重新编码后的文件字节相同作为标准。证据 `/tmp/tuzi-v153-delivery/clipboard-native-result.{txt,png}`。 |
| 显示图片文件 | 自动写入隔离 home 下 Pictures/兔子助手，并在 Finder 选中生成文件，截图 `native-reveal-generated.png`。 |
| 图片另存为 | 原生 Save 成功，实际文件 `/private/tmp/opentu-image-AfKZZ.png`；1254×1254 PNG，与自动保存副本 SHA-256 一致。 |
| 原图预览 | 原图可见且显示 1254×1254，截图 `native-generated-preview.png`。 |
| 重启后画布图片 | 正常退出、重建并重新打开验收项目后，蓝兔图片仍可见，截图 `native-generated-after-restart.png`。 |

生成图片 SHA-256：`0305fa9a671a5a7d926bfacff265da3ad2262a5a05671e50078f0c3b4f8b921d`。核心成功路径不代表所有发布门禁关闭；Windows/Linux 安装与升级、普通退出时运行中任务保护、完整备份迁移/扩展隔离仍需独立验收，见历史发布验收记录。

加载提示调整已进入重新构建并启动的隔离 app，组件回归验证 developing/inserting 只显示“正在加载图片”、不显示进度圈；本次未为拍摄短暂加载状态再发起付费生成请求。验收结束时客户端已返回成功生成的蓝兔画布。

最终完整回归日志：`/tmp/tuzi-creative-final-acceptance.log`、`/tmp/tuzi-host-final-acceptance.log`；原生构建日志：`/tmp/tuzi-native-loading-label-build.log`。

日志 `/tmp/tuzi-{model-timeout-tests,bugfix-regression,bugfix-bridge-tests,native-model-fix-tests,bugfix-typecheck,creative-bugfix-build,bugfix-provenance}.log`；截图 `/tmp/tuzi-creative-bugfix/`。来源补丁与 manifest 重新生成，对固定源 `f36267808b131c416e6d6efebce3259692ee40f8` 重建核验，1513 原始文件 + 17 本地文件。源码 `git diff --check` 排除生成的 `UPSTREAM-PATCHES.patch`：该文件中空白上下文行本身含 diff 语法空格，不应手动剥除。
