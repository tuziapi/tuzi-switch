# 专用视频服务候选（2026-11-23，只读调研）

用户已选择「本地压缩＋专用 AI 服务」。以下来自本轮实际读取的 fal 官方模型目录与 OpenAPI Schema，不是效果验收或购买/接入批准。尚未创建第三方账户、保存凭证、上传素材或执行付费请求。

读取入口：`https://api.fal.ai/v1/models?category=video-to-video&limit=100`；Schema 使用 `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint_id>`。应以接入时实际返回为准，不能把旧的相似模型名当作可用接口。

| 功能 | 已验证存在的候选端点 | 实际输入与重要限制 |
| --- | --- | --- |
| 4K 超分 / 清晰度增强 | `topaz/upscale/video/precision` | 必需 video_url；可选 model、upscale_factor、noise、compression、recover_detail、H264_output 等。须按输入像素计算倍率并核对实际输出；1 倍增强与升分辨率分开，不能仅将标签设成 4K |
| 去背景 | `bria/video/background-removal/v3` | 必需 video_url；可选 preserve_audio、background_color、output_container_and_codec、auto_zoom。透明输出格式和本机播放兼容需实际测试；默认禁止自动裁切商品 |
| 去水印/选区修复 | `bria/video/erase/mask` | 必需 video_url 和 mask_video_url；可选 auto_trim、preserve_audio、output_container_and_codec。必须实现并验证选区/遮罩随帧对齐，不能用文字提示代替遮罩，不能自动改变时长 |

### 两条接入方式

| 方式 | 优点 | 缺点/维护成本 | 当前状态 |
| --- | --- | --- | --- |
| fal Topaz＋BRIA | 公开独立任务/模型契约，覆盖需要的处理类别 | 需要单独 Key 与计费；上传、队列、取消、结果恢复、遮罩与原生格式均需接入/实测；服务需用户选择 | 已发出具体选择问题，待用户决定 |
| 仅兔子 API | 可沿用用户已有服务关系与模型 Key | 本轮尚未确认四项对应端点；不能从 /models 的名称推断专用处理能力；若 API 未开放则须服务端工作，当前不能假装已支持 | 未验证专用端点，不能放行 |

现有兔子 Key 不能发送到 fal；账户系统令牌也不是模型/处理服务 Key。待用户选定后，在本机配置对应服务凭证，无需将真实 Key 写入聊天、文档或仓库。报价、配额、质量、地域可达性和失败计费尚未验证，本记录不承诺这些方面。
