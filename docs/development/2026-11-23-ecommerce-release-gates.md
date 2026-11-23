# ECOM-ACCEPT-1123：补齐验收后再发布

用户选择「先补齐并验收，再发布」。基线 `codex/ecommerce-desktop-integration` / `b3e16ad5`。允许本地修复、真实付费模型验证及构建安装；仅在验收通过后推送测试仓库 `AiW520/tuzi-switch` 并发布新的测试版本。当前验收仍有未通过项，尚未推送、触发云端构建或发布。正式仓库及更新通道不在本轮发布范围。

## 本轮修复与兼容

- 图片导出统一使用任务记录中的目标像素尺寸，PNG 编码；保持原图并等比留边，不拉伸、不裁剪、不回写历史。无需新增持久化字段或数据迁移；既有图片记录可直接按原任务尺寸导出。正确尺寸 PNG 直接使用原文件，避免重复编码。
- 视频菜单过滤已知图片模型及别名，防止远端目录错误声明 `/videos` 后将 GPT Image、Nano Banana 展示为视频模型；自定义未知 ID 继续遵循已有配置。提交前再次校验，错误类型不发付费请求。
- 原生测试进一步发现多供应商同名模型使用重复 React key，会使切换类别后残留图片选项。通过带重复模型的实际组件渲染测试复现（修复前保留两项 GPT Image）；改用供应商＋模型的唯一选项标识，并按媒体类型重建选择器。同名选项显示供应商名，选择后保留供应商，不能被同名默认预设覆盖。不新增持久化字段。
- Seedance 2.0/2.5 接入已有 `submitSeedance2Request` JSON 适配器，传入公网参考视频及尺寸、时长、比例，先持久化任务编号再轮询；恢复只查询旧编号，支持 `succeeded` 和 `content.video_url`。真实桌面测试发现适配器不接受本地视频，已修正能力声明和提交前检查；工作台尚未接入素材托管，不能宣称本地视频已支持 Seedance。不改变底层账户权限或凭证机制。
- MiniMax 原有任务、HappyHorse 缓存恢复、Gemini Omni 1.2 原有视频参考传参保持。

## 原生真实验证

### HappyHorse 缓存恢复通过

在包含缓存修复的已安装测试版中，点击原任务「继续获取结果（不重新生成）」立即恢复已完成视频，原生从 0 播放至 3 秒并导出成功。

- 原任务：`task_4REO1lJyBbmMzoKGwY7Xoj04QI7KvJUy`，本轮未重新生成。
- 文件：`/Users/sdy09/Documents/tuzi-switch-artifacts/ecommerce-media-qa-20261123/verified-happyhorse-product-video.mp4`。
- 960×960、H.264、24 fps、AAC、3.162667 秒、776791 字节，完整 ffmpeg 解码通过。
- 抽帧：`happyhorse-contact-sheet.jpg`；单个米色杯子、白底、推近，无额外植物/杯子/文案；最后镜头推近使杯柄部分出画。不能宣称所有镜头都完整展示商品。
- 上一轮 MiniMax 已保存视频冷启动后仍可加载和播放。
- 在本轮尺寸修复包中重新进入「带货视频」，同一 HappyHorse 任务显示「已保存」，原生播放从 0 到 3 秒；无需重新生成。

### MiniMax 第二轮效果仍失败

2026-11-23 20:44:07，使用同一 `reference-mug-pan.mp4`，MiniMax-H3、5 秒、768P、16:9、相似复刻；加强提示明确白底、单杯、禁止桌布植物等，仍生成了桌布和植物背景。

- 任务：`task_3DzPK3xoAEVkbGKA03KGnUxdjEpxxdUK`，本地记录 `b007962c-df93-400a-86b4-de010b71e19e`。
- 原生播放至 5 秒，导出 `verified-minimax-reference-video-v2.mp4`；1280×720、24 fps、H.264/AAC、5.175 秒、542971 字节，全文件解码通过。
- 截帧 `minimax-v2-contact-sheet.jpg`，**仅生成链路、保存播放导出通过；忠实复刻及请求画质档位对应的实际分辨率未通过**。
- 代码核查 MiniMax 的 `referenceVideos` 实际进入 `content` 的 `reference_video`，提示也进入请求；不能再把加强提示视为效果验收成功。

### 指定图片导出尺寸通过

在已安装原生包中打开 18:59:22 的鞋图历史记录，点击保存图片，得到 `verified-shoe-comparison-1024.png`。`sips` 与 `file` 确认 1024×1024 RGBA PNG，目视检查完整商品及对比内容保留；原始 1254×1254 历史文件未改动。本项验证导出尺寸，不代表模型原始输出严格遵循尺寸，也不代表放大能增加真实细节。

### Seedance 本地视频接入未通过

21:05:06，原生工作台选择 `doubao-seedance-2-5-260628`、4 秒、720p、16:9、相似复刻，上传 `reference-mug-pan.mp4` 并提交。适配器在发送前报「参考视频仅支持公网 HTTP(S) 地址」，无远端任务编号、无生成结果。原单测把适配器完全 Mock，错误地接受 Data URL；本轮已纠正测试输入，并补充本地 Data URL、Blob URL、回环 URL 不应进入提交的回归。前端现在在创建任务前提示限制并禁用提交，仍需正式素材上传能力才能完成该模型的本地视频参考链路。

### 本地视频压缩原生验收通过（Mac ARM）

已完成 `pnpm build:local`，安装到 `/Applications/Tuzi Assistant Test.app`。正式应用和数据未替换，上一测试应用可从废纸篓恢复。以下均从最终安装包操作，不是浏览器 Mock：

| 场景 | 实际结果 |
| --- | --- |
| 5 秒合成 1080p 音视频，均衡/720p/保留音频 | 7558880 → 625540 字节（减少 91.7%），1280×720、H.264/AAC、音视频均 5 秒；播放与导出通过 |
| 真实 HappyHorse 商品视频，均衡/保留尺寸/保留音频 | 776791 → 299322 字节（减少 61.5%）；960×960，视频 3.041667 秒、音频 3.162667 秒，与原流时长一致；播放与导出通过 |
| 同一商品视频，移除音频 | 250575 字节（减少 67.7%），960×960、3.041667 秒，仅视频流；音频尾部消失导致容器时长缩短，视频未截断 |
| 取消执行 | 21:53:52 的任务取消后显示「已取消压缩，原视频未改动」，无成功结果，实际引擎进程退出；21:52:46 的先前任务在点击前已完成，不作为取消证据 |
| 冷启动 | 完全退出并核查进程消失后重新打开；五条压缩记录（含取消记录）保留，选择 21:54:43 商品视频后从 0 播放至 3 秒 |

三个实际 UI 导出文件均完整解码通过，位于 `/Users/sdy09/Documents/tuzi-switch-artifacts/ecommerce-media-qa-20261123/`：`opentu-synthetic-compression-av-compressed.mp4`、`opentu-verified-happyhorse-product-video-compressed.mp4`、`verified-happyhorse-no-audio.mp4`。商品压缩前后 73 帧 SSIM 为 0.994828；合成素材缩至 720p 的 SSIM 为 0.991658。这些仅是两段样本的比较，不承诺任意视频无损。商品原片末尾杯柄出画的构图问题仍保留。

最终安装包可执行文件 SHA-256：`efcb901e23bb5324451b11818d839ef68cf8f775c0212c42325e9f773ea90e69`；随包引擎：`93a29a77d352471bf9db0997937f74237b2000b619dbef6e2dd7db81059cd6c1`。源包、安装包及引擎签名完整性通过。DMG 为上述目录中的 `Tuzi-Assistant-Test-1.6.3-local-compression-arm64.dmg`，SHA-256 `15cca7ade24a347af0240f6d3380eecb83cae9124ad04105cad6e6d77b9de67f`，`hdiutil verify` 通过。它是独立本地身份、ad-hoc 签名的测试包，没有公证或正式 updater 发布。

日志：`/tmp/tuzi-compression-{full-tests,bridge-final,native-final,types,desktop-build,dmg-verify}.log`。原生引擎单测中的取消是执行前取消；运行中取消由上述实际 UI 验证补足。五平台云端构建/实机、正式 Windows 构建工具链与跨架构打包尚未验收，不能由本机成功推断通过。

## 验证进度与门禁

- 136 项定向测试通过（工作台/图片尺寸/模型分类/任务恢复及已有 Seedance 适配器）；`pnpm typecheck` 通过。最终日志 `/tmp/tuzi-media-model-routing-tests.log`、`/tmp/tuzi-media-model-routing-types.log`。新增组件回归还验证了供应商选择跨页面切换保留，5 项通过 `/tmp/tuzi-media-model-menu-regression.log`。测试环境存在 IndexedDB 未定义的既有 stderr，测试断言均通过，不将该环境当作原生持久化证明。
- 尺寸修复包应用二进制 SHA-256 为 `dc5c778e352024ebb15b9860e9c5810d448aad0fe32eee07d49f90f5cbeb86da`，图片导出与 HappyHorse 冷启动恢复实测通过。模型修复包随后已构建安装，SHA-256 `64bf7bcc9852ccba60eaf4dae358c7a5dba3784cfe482d7d45bac97b9346d49f`，源包及安装包签名完整性通过。
- 模型修复包的原生菜单已从首项至末项检查，没有 GPT Image / Nano Banana 残留；上传本地参考视频后 Seedance 在创建任务前提示限制并禁用生成。HappyHorse 已保存任务在该包从 0 播放至 3 秒通过。本轮没有为这些检查重新提交付费生成。
- 用户已选择「本地压缩＋专用 AI 服务」。本地压缩代码、独立记录、固定源码随包引擎已实现；141 项创作、11 项宿主媒体、2 项原生（含实际引擎）及类型通过。最终 Mac ARM 安装包、真实压缩/取消/导出/冷启动播放已验收，具体证据见上节。设计、字段、打包和回退见 [ADR-027](decisions/0027-offline-video-compression.md)。
- 其余四项视频处理仍缺已选择、已配置并实测的专用服务；已读取 fal 的公开模型目录及 Topaz 接口，向用户提出 Topaz/BRIA 与仅兔子服务的具体选择，尚未擅自创建第三方账户或复用兔子 Key 访问第三方。
- 只读检查 API 仓库 `7cd752e24e17cb481edd9301d3cb9c30d47ef99c` 发现 `/v1/seedance/assets` 支持本地 MP4/MOV、返回受归属约束的 `asset://` 引用及审核状态。不能把可能需要认证的 `web_url` 当公网托管地址；客户端上传/审核/引用与受管账户桥尚未接通，线上可用性未验证。本轮未修改该 API 工作区。
- MCP 一键连接的正式 API 自动注册依赖仍按 [集成记录](2026-11-23-results-style-mcp-integration.md) 保留，本轮未部署服务端，也没有新增生产 OAuth 验收。
- 本地压缩的 Mac ARM 验收通过；精确生成视频尺寸、复刻保真、其余四项专用处理与跨平台验证尚未满足测试发布条件；此记录不是发布批准。
