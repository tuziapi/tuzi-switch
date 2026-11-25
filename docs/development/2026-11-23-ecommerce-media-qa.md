# ECOM-MEDIA-QA-1123：图片效果与视频真实验收

用户要求确认效果图是否达标、视频是否真实测试，并继续完善。基于 `codex/ecommerce-desktop-integration` / `cfb3b681`，沿用此前真实付费模型调用、本地修改、构建、安装及验证授权；无 push、PR、发布或 API 部署。

## 发现与修复

- 逐张查看用户 17:45 的五张鞋子图：主视觉与场景图整体协调，但卖点图出现未经提供的舒适、耐用文案；对比图将黑鞋画成磨损旧鞋，并使用 Before/After，不能认定全部效果达标。
- 图片提示加入商品事实约束：不能凭空推断不可见结构、规格、成分、舒适/耐用性、售后或认证；没有真实前后依据时使用中性的已有颜色/角度并列，不造旧或贬低某款。保留已有结果，不回写旧任务提示。预览导航移到图片下方，避免遮挡成品文案。
- 原视频页面上传的参考视频没有传入生成函数；已按现有实际适配器传入 Gemini Omni 1.2 的 `video_media`、MiniMax-H3 的 `input_videos`。其余模型明确阻止忽略素材后继续付费生成。MiniMax 本地文件限制 MP4/MOV，工作台本地参考上限 20 MB。
- 视频不再沿用图片尺寸：时长、尺寸来自所选视频模型，比例单独配置；使用带明确能力描述的 UI，不承诺逐帧完全复刻。
- 普通生成不能替代压缩、超分、去背景、变清晰或去水印。五个处理入口保留并明确提示未接入，阻止误发付费生成；专用视频处理服务仍未实现，不能将本轮修复写成全部功能完成。
- 新增独立视频记录数据库 `tuzi-ecommerce-videos/jobs`，`version: 1`，记录任务/工具/账户归属、模型引用、提示、尺寸/时长/比例、状态、远端任务编号、待下载 URL 或已下载 Blob。无凭证字段，不改变账户/API 契约和原图片数据；旧版无视频记录可直接空库启动。
- 提交前保存意图，取得任务编号后持久化，再查询；任务独立于 React 页面，切页继续。停止等待和 90 分钟上限保留编号；冷启动不自动提交，用户可仅查询原任务。下载失败重试原结果，存储失败阻止新付费请求；完整视频保存本机后播放、原生导出。

## 自动验证

`pnpm test:creative tests/ecommerce-generation.test.ts tests/ecommerce-video-jobs.test.ts tests/ecommerce-video-media.test.ts tests/ecommerce-workbench-lifecycle.test.ts tests/ecommerce-jobs.test.ts tests/ecommerce-executor.test.ts tests/ecommerce-request.test.ts tests/ecommerce-workbench-config.test.ts`：8 个文件、46 项通过；最终日志 `/tmp/tuzi-ecommerce-media-final-tests.log`。

覆盖真实参考字段、时长尺寸、提交编号先保存后查询、只查询恢复、停止后晚到编号保留、不同账户禁止恢复、存储失败不调用、下载失败不重复生成、页面离开/返回、未接入视频处理禁用以及图片事实约束。

`pnpm typecheck` 通过。首次类型检查暴露上轮视觉 fixture 引用运行时设置导致宿主跨包扫描及模型引用字段缺失；改为独立持久化路由类型、补齐 fixture `profileId` 和可空 title 后通过。测试首次 Blob 持久化断言因 jsdom Blob 不被 Node structuredClone 保真而失败，测试改用 Node Blob 后通过，不冒充浏览器存储验收。

## 原生图片实测

用原来的鞋子图片、`gpt-image-2.5-1k`、英文、请求 1024×1024，重新生成首屏和对比两图，历史 `2026/11/23 18:59:22 · 2/2`：

| 项目 | 结果 |
| --- | --- |
| 首屏 | HTTP 200，46 秒；本地编号 `b0210d44-af3a-4f83-bb14-64ebfdb00a67`；服务端 `202611231059249810166248268d9d6wB94bN5S` |
| 对比 | HTTP 200，42 秒；本地编号 `601a7cce-769e-4a3e-87b4-74fbe2fd8ce0`；服务端 `202611231100097232317998268d9d6FRf81Hkq` |

实际逐图观察：首屏保留黑/米色两双鞋；对比以两种已有颜色中性并列，无旧鞋磨损、Before/After 或虚构效果文案。已原生导出 `tuzi-switch-artifacts/ecommerce-media-qa-20261123/verified-shoe-comparison.png`。

实际文件仍为 **1254×1254**，与请求 1024×1024 不符；因此不能认定精确尺寸交付达标。单次修复后样本通过不代表所有商品、文案、模块或模型均稳定达标。

## 视频实测与最终交付

### 真实 MiniMax 参考视频生成

输入为本地合成测试素材 `reference-mug-pan.mp4`：原白底米色杯子图片的 4 秒缓慢推近，512×512、24 fps；它只是参考输入，不冒充 AI 生成结果。通过安装版「视频复刻」上传，选择 MiniMax-H3、5 秒、768P、16:9、相似复刻，未另传参考图片。

- 2026-11-23 19:12:43 提交，远端任务 `task_HdDbhG6AFMuQiYjMOpt91odUO5e1nr3G`，本地记录 `67056123-9334-416e-869f-e23cbddf562c`。
- 约两分钟完成；生成时离开工作台到「我的项目」再返回，任务继续；原生播放器从 0 到 5 秒播放，原生导出成功。
- 成品 `verified-minimax-reference-video.mp4`：1280×720、H.264、24 fps、AAC、5.175 秒、535278 字节；完整 ffmpeg 解码通过。请求 768P，实际高度 720，与档位存在差异。
- 逐帧观察：米色杯子主体稳定，无文字或标志，但模型擅自将白底改为桌面、布、植物，并在左侧新增另一个杯子，镜头也不是严格复刻。**播放/导出通过，忠实复刻效果失败。** 截帧证据 `minimax-contact-sheet.jpg`。
- 已进一步收紧提示，要求保留背景、构图和对象数量；加强提示的第二轮真实调用尚待最终包原生复测，不能把提示修改当作效果通过。

### 真实 HappyHorse 商品图生视频与缓存修复

2026-11-23 19:04:14，从「带货视频」用白底米色杯子图提交 happyhorse-1.1-i2v、3 秒、720P；远端任务 `task_4REO1lJyBbmMzoKGwY7Xoj04QI7KvJUy`。主动停止等待、退出重启后记录保留，继续获取使用相同任务编号。

服务器生成完成且视频进入创作统一缓存；工作台错误地将 `/__aitu_cache__/video/...` 当成普通 HTTP URL，在 Tauri 中读到 554 字节 HTML，导致无法展示。已改为直接读取统一缓存 Blob，并增加 MP4/MOV/WebM 文件头校验及通用 MIME 归一化，避免把 HTML 当视频。缓存命中/缺失与不走 HTTP 的专项测试通过。最终包的已有任务恢复、播放、导出仍待原生复验；禁止为该任务重新发起付费生成。

所有媒体证据位于 `/Users/sdy09/Documents/tuzi-switch-artifacts/ecommerce-media-qa-20261123`。五项专用视频处理未实现、精确尺寸未达标、忠实复刻失败仍是上线阻断项。禁止据构建或合成测试直接放行。

### 最终本地包与未完成验收

- `pnpm build:local` 完成，日志 `/tmp/tuzi-ecommerce-media-cache-final-build.log`；46 项定向测试、`pnpm typecheck`、`git diff --check` 通过。
- 2026-11-23 19:27 已更新 `/Applications/Tuzi Assistant Test.app`，`codesign --verify --deep --strict` 通过；可执行文件 SHA-256：`2546cde432574883988f4a822e915be6346359dc9c4dbe3fb938cc6ce3f8aac7`。
- 旧安装移动到 `/Users/sdy09/.Trash/Tuzi Assistant Test before cache-fix 20261123.app`，可恢复；正式兔子助手及测试数据未删除。
- 安装包 `/Users/sdy09/Documents/tuzi-switch-artifacts/ecommerce-media-qa-20261123/Tuzi-Assistant-Test-1.6.3-media-qa-arm64.dmg`；`hdiutil verify` 通过；SHA-256：`68c30d26deac3fa059096432dab135a17454b88bff0c85cc5a76915ceb772b09`。
- 最终包为 Mac ARM64 本地 ad-hoc 签名验收包，未公证、未正式发布。原生编译有 9 项既有未使用项 warning。
- 19:24 后桌面自动化持续报告找不到测试应用可见窗口；可退出旧进程、安装新包，但无法读取新版界面。已请用户保持解锁并打开测试窗口。故 **最终缓存恢复、最终包冷启动视频播放、加强提示第二轮实际复刻均未完成**；既有 MiniMax 播放/导出证据来自前一轮中间包，不能冒充最终包全流程通过。
