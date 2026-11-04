# UC-MEDIA-01：账户多媒体适配与原生画布验收

日期：2026-11-04。用户在续接“设计 openTu 客户端整合”后明确选择 **B：补齐现有视频、音乐功能的账户适配并全面验收**。本轮只本地实现、验证及 commit；没有推送、PR 更新或发布。此前单次真实生图授权不扩大为任意次数的付费视频、音乐调用。

## 基线与兼容

- 客户端：`codex/opentu-assistant-sync`，起点 `4ee6a4014d24e55bb7e8a6fb4c8aaa9b135115aa`。
- 服务端只读核查：`/Users/sdy09/.codex/worktrees/dev-latest-20261104/tuzi-api3`，HEAD `1cecdedec6c3bb2dd6a186682eebdc09b2ed80c5`；未修改 API 仓库。核查 Suno native/v2/legacy、视频路由、分发模型及计费模型。该 SHA 不证明线上部署。
- 账户管理契约仍为 `system-token-v1`；新增内部创作动作，复用原站媒体接口。模型 Key 只由原生层解析，账户系统令牌不充当模型 Key。不新增数据库、绑定文件或项目持久字段，无迁移要求。
- `mediaActions.json` 为 TypeScript/Rust 共用的 75 项有限路由清单。新增项的 method/path、taskId、权限模型或模型字段、端点别名均已补齐；不接受任意前端 URL/header。未知、重复 query 和非法任务 ID 拒绝。
- MiniMax-H3（生成、增强、重制、轮询）、Seedance 原生与 Kling 文/图生视频；Suno legacy、v2、native 的既有音乐动作、查询和上传接入账户来源。Suno body.model 可以是版本 V6，权限依据 API 路由使用的真实模型，native 同时校验服务端涉及的路由/计费模型。保留手动配置，不扩大 MJ/任意自定义 HTTP 的账户范围。

## 修复与原因

| 问题 | 根因与处理 |
|---|---|
| MiniMax-H3 提示未接入账户关联 | 原桥接只覆盖标准视频路径；增加固定专有路由和原生资格校验。 |
| 视频、音乐、文本任务卡片空白 | WebKit 对 SVG foreignObject 中 HTML 的绘制不可靠；原生任务卡片改用 SVG，沿用任务订阅与交互。 |
| 图片加载时仍见破图/模糊图 | 原生 SVG 分支绕过共享任务/画布 readiness hook；接回控制器订阅，加载阶段只绘制“正在加载图片”。 |
| 内外状态不一致 | 任务列表、工作区统一待执行/提交中/生成中/终态语义；WorkZone 合并实际队列更新。MiniMax 获得 remoteId 后，即使供应商进度仍为 0%，适配器也保持 polling，不退回 submitting。取消保持 cancelled，不映射为失败；失败卡片保留可审查及重试。 |
| 视频计时正常但画布完全空白 | 浏览器实测发现媒体已解码却未绘制；原生 video/audio 移至画布 HTML 层，依据 SVG CTM 同步位置、缩放、旋转与尺寸，卸载时释放观察器和图层。网页路径不变。 |
| 音乐文字覆盖播放按钮 | WebKit 在 grid max-content + 百分比高度 + aspect-ratio 间存在循环尺寸依赖；明确封面列宽，保留容器自适应。 |
| 勾选模型后偶发添加 0 个 | 目录/价格持久化发出新数组引用，弹窗 effect 重置未提交勾选；只在每次打开初始化草稿，后台刷新不覆盖用户选择。复现测试涵盖刷新及关闭后重开。 |

媒体可见性验收要求实际画面/可点击控件与播放进度，不能仅用 DOM、解码成功、任务完成或保存成功替代。

## 验证分层

| 层次 | 证据与结果 |
|---|---|
| 宿主单元 | 94 文件 / 760 项通过；包含 75 路由映射及恶意参数、既有桥接回归。`/tmp/tuzi-media-host-delivery.log` |
| 嵌入模块单元 | 全量 114 文件 / 1861 项通过；包括模型勾选竞态、SVG 状态和重试回调、媒体层定位/清理。最后 MiniMax 阶段转换另由真实 UI 的挂起轮询检查覆盖。`/tmp/tuzi-media-creative-complete.log`、`/tmp/tuzi-media-final-targeted-2.log` |
| 原生 Rust | 12 项通过。真实本机 loopback HTTP 穷举 75 动作，验证方法、URL、模型 Key 鉴权、正文及清理；不使用真实凭证。`/tmp/tuzi-media-native-tests.log` |
| 类型/构建 | 宿主 `pnpm typecheck`、创作 build 通过；隔离 macOS app 已构建并启动到账户/创作/空白画布。`/tmp/tuzi-media-types-delivery.log`、`/tmp/tuzi-media-build-final-2.log`、`/tmp/tuzi-media-native-delivery.log` |
| 图片浏览器 | Chrome 5/5；WebKit 最终 5/5（停留、助手切换、项目列表、其他项目、未知结果）。初轮切回助手场景因截图早于本地项目加载结束误判；改为等待准确生成元素解码及加载遮罩消失。`/tmp/tuzi-images-verified/results.json` |
| 视频/音乐/文本浏览器 | 实际账户绑定 UI、模型选择、任务队列、画布和 IndexedDB，仅替换原生 HTTP 边界为合成响应并阻断外网。Chrome 成功/刷新恢复 3/3；WebKit 最终结果见下。视频检查彩条像素及时间推进，音频实际点击后验证时间推进，文本检查可见且未被输入框遮挡。 |
| 失败/取消 | HTTP 422 三类失败状态、画布一致及刷新不重发；取消通过任务队列多选操作检查 cancelled、画布提示和刷新不重发。最终结果见下。 |
| OpenSpec | `complete-assistant-media` strict 校验通过。`/tmp/tuzi-media-openspec.log` |

测试脚本 `tests/visual/creative-media-acceptance.cjs` 支持 `CREATIVE_QA_BROWSER`、`CREATIVE_QA_OUTCOME=success|failure|cancel`、`CREATIVE_QA_KINDS` 与 `CREATIVE_QA_BASE_URL`。`tests/visual/fixtures` 包含可重复生成的纯合成 MP4/WAV。运行预览时设 `CREATIVE_QA_NO_HMR=1`，避免构建期间热刷新干扰验收。没有把重跑掩盖为首次全部通过：测试过程确实发现并修复视频绘制、音频布局和模型选择竞态。

## 原生与真实服务剩余门禁

隔离 App 身份 `com.tuziswitch.desktop.acceptance`，名称 `Tuzi Assistant Test`。原生启动检查确认未连接账户。尝试导入本地合成视频时，自动化文件对话框按键未按预期响应，未完成原生媒体导入/播放验证；通过菜单正常退出测试包。正式客户端及其数据未修改。

本轮未进行真实供应商的付费视频/音乐/文本生成，75 项本机 HTTP 检查不等于 75 个线上功能全部验收。仍需用户在隔离测试包连接测试账户，并明确本轮调用次数/预算后完成真实图片、MiniMax-H3 视频、Suno 音乐、文本四类端到端；再验证真实素材播放、保存、重启及对应任务记录。Windows/Linux 原生运行、各专有媒体扩展动作的真实提供方行为尚未验收。

最终状态：本地修复与分层合成验证完成；真实服务验收及发布未完成。不能据此宣称全面验收完成或已经上线。回退本任务代码提交可保留项目/媒体数据、手动配置及既有账户绑定；不回填密钥、不删除账户数据。

## 最终浏览器证据

- WebKit 视频/音频：`/tmp/tuzi-media-polling-final/results.json`，2/2 通过。挂起 GET 轮询时检查画布和任务面板同时为“生成中”；播放、视频彩条像素、刷新恢复通过，每项首次 POST=1、刷新 POST=0。
- WebKit 文本：`/tmp/tuzi-media-success-verified/results.json` 中 text 通过，画布文字未被遮挡及刷新恢复通过。该批 video 在刷新后过早 play()，抛出 NotSupportedError；改为等待缓存解析/metadata 后，上述最终视频复查通过。
- WebKit 失败：`/tmp/tuzi-media-failure/results.json`，3/3；取消：`/tmp/tuzi-media-cancel-verified/results.json`，3/3。全部检查持久终态与无重复提交。
- Chrome 视频/音乐/文本：`/tmp/tuzi-media-chrome-stable/results.json`，3/3，媒体播放和刷新恢复通过。
- 最终创作构建 `/tmp/tuzi-media-build-polling.log`。模型新增选择弹窗竞态修复后，不通过重试按钮绕过失败；测试等待界面确认实际已添加 3 个模型。

来源追溯最终复核：固定源 `f36267808b131c416e6d6efebce3259692ee40f8`，1537 个嵌入文件逐字节重建通过（1514 个源文件记录、24 个本地登记，其中 1 个也在源版本中），补丁 343083 字节。见 `/tmp/tuzi-media-provenance-final.log`。
