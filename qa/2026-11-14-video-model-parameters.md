# 视频参数定向验收（2026-11-14）

## 环境与范围

本地 `/Users/lkj/Desktop/working/switch`，Vite `http://127.0.0.1:7206/`。
真实接口为 `https://api.tu-zi.com/v1`，用户已授权六个目标模型的有限抽样。
凭据只从指定本地密钥文件按需读取，不写入源码、报告或命令行参数。
本次未跑全量测试，未提交/推送/发布。

## 真实接口抽样（此前完成）

以下是脚本直接构造 JSON 调用 Tuzi API 的结果，不能代替桌面原生 UI 端到端验收。
六条创建请求均 HTTP 200，随后均查询到 completed，内容下载均 HTTP 200、video/mp4。

| 模型 | 抽样参数 | 公共任务 ID | 下载字节数 |
| --- | --- | --- | --- |
| gemini-omni-1.2-flash | 3s、640x360，无参考图和水印 | task_MqOFPr1HfriukOs1QHSW5XqjhGML5Cmz | 1299515 |
| wan3.0-video | 2s、480P、16:9、首尾帧、水印关闭 | task_RqNwFc8tAOw6XF1EZ3u9SXkZ07XvqQpC | 707027 |
| happyhorse-1.1-t2v | 3s、480P、16:9、seed=7、水印关闭 | task_3X0CnWMqphvR3CIOc2h0sCEnCLSsUq9e | 432202 |
| happyhorse-1.1-i2v | 3s、480P、单图、seed=8、水印关闭，无 ratio | task_tsCJhUD33oMIAWMRfcoSrFeeTmPn96W3 | 680599 |
| happyhorse-1.1-r2v | 3s、480P、1:1、单图、seed=9、水印关闭 | task_I6N7BZXhxqPaynnRV8HpgfpH53xKa0NJ | 519087 |
| kling-4.0 | 3s、720p、16:9、单图、水印关闭 | task_kTNppIiLzwjgor1gJ6KXyY4KNYUT65XY | 2525501 |

较早调试曾出现 Wan multipart、Kling 顶层 ratio/size 和 HappyHorse I2V ratio 被拒、
HappyHorse 提交超时/上游 500 等结果；上表是后续合同复测的新任务，不将早期不确定请求算作成功。
下载临时文件已清理；当时无 ffprobe，未取得视频实际像素、时长或解码结果。未核验真实账单。

## 本轮本地与页面补验

- 修正 HappyHorse 1.1 专用适配器遗漏共享请求构造、默认适配器回退到通用时长/尺寸、重复模型/参数定义。
- 恢复旧 Gemini 1.1 时长与默认值，保留 HappyHorse 1.0 分辨率合同。
- 命令 `pnpm --filter @tuzi/creative-workspace exec vitest run tuzi-video-request.test.ts gemini-omni-video.test.ts provider-routing.test.ts model-config.test.ts`：四文件 274 项通过（58+19+121+76）。
- `pnpm typecheck`：宿主 TypeScript 检查通过。创作源码由 Vite 构建验证，不把宿主检查称为独立 drawnix 全量类型检查。
- `pnpm --filter @tuzi/creative-workspace build`：通过；既有 Sass/CSS 与动态导入 warnings 保留。
- 单测存在 localStorage/indexedDB 环境初始化诊断，以上文件无失败；未改全局测试环境。
- `git diff --check`：通过。

Ego 浏览器对 7206 的最终构建做定向页面检查。使用合成凭据/目录创建临时供应商，
拦截生成 POST 并返回带明确 QA 文案的 HTTP 400；没有新增真实付费生成。

| 页面检查 | 预期与结果 |
| --- | --- |
| 六个模型参数菜单 | 时长、尺寸、比例、水印/seed 按合同展示；通过 |
| Gemini 1.2 | 选择 3 秒、360p 竖屏；捕获 `seconds:"3", size:"360x640"`，无 watermark；通过 |
| Wan 3.0 | 选择 2 秒、480P、9:16；捕获扁平 JSON，watermark=false；通过 |
| Kling 4.0 | 选择 3 秒、720p/21:9、水印开启；捕获 contents、settings（duration/resolution/aspect_ratio）与 options.watermark_info.enabled=true；通过 |
| HappyHorse T2V | 选择 3 秒、480P、1:1、seed=2147483647；实际专用适配器捕获 parameters，watermark=false；通过 |
| HappyHorse I2V | 菜单无 ratio，未提供参考图时提示需要参考图片，未发起 POST；通过 |
| HappyHorse R2V | 菜单包含 ratio，未提供参考图时提示需要参考图片，未发起 POST；通过 |

页面共捕获四条请求；两条无图失败停在发送前。合成供应商已移除，fetch 拦截已恢复。
测试画板 `QA 视频参数（合成拦截验证）` 保留供查看，其失败卡片来自主动拦截/缺图检查，不能当作真实接口失败。

## 未覆盖与限制

- 原生 Tauri 账户关联、真实页面生成后的缓存/落画布/播放与重启恢复，未完成验收。
- 7206 浏览器预览缺少原生账户 IPC；本地参考图上传尝试未得到可用附件，本轮未把这条 UI 路径判为通过。
- 带图的请求格式通过共享/专用适配器单元测试验证；此前六模型真实接口样本覆盖部分图片输入，不能替代本轮页面正向带图验证。
- 无全量组合、参考视频/主体/音色、编辑/延展、全部分辨率真实生成、账单核验或跨平台测试。

## PR #336 增量同步验证

来源为 `f0cb1fac...f8ff9cd6`，本地分支 `codex/sync-video-336-fixes`。
同步 Kling 尺寸/比例分组、旧像素尺寸恢复兼容、非法比例校验和六模型按钮短代码。
补齐本地枚举按钮缺少的 `aria-pressed`，保留既有请求适配及 Gemini 1.1/HappyHorse 1.0 兼容逻辑。

| 验证项 | 预期与实际结果 |
| --- | --- |
| 修改前基线 | 偏好与两类菜单原测试 3 文件 80 项通过 |
| Kling 独立选择 | 两档尺寸、五种比例的 10 种请求组合通过；组件测试确认改变一项保留另一项、旧值选中态正确 |
| Kling 旧参数 | 八种原像素尺寸的有效尺寸校验及请求映射通过；显式比例优先；非法 4:3 及未知尺寸被拒绝 |
| 偏好恢复 | 输入栏、按供应商区分的模型参数及视频工具均恢复尺寸和比例，保留时长与 watermark=false |
| 模型显示 | 六个精确 ID 的旧目录补短代码、自定义视频模型回退名称的组件测试通过 |
| 最终定向回归 | 下列命令 9 文件 399 项通过，无跳过；覆盖请求合同、原有 Gemini、路由、目录发现、模型配置及偏好/组件逻辑 |
| 宿主类型与构建 | `pnpm typecheck` 通过（宿主范围）；`pnpm --filter @tuzi/creative-workspace build` 通过（31.71s），已更新预览依赖的创作构建产物 |
| 本地预览 | `http://127.0.0.1:7206/` HTTP 200；仅确认服务可访问，不据此认定页面交互通过 |
| 差异检查 | `git diff --check` 通过 |

```sh
pnpm --filter @tuzi/creative-workspace exec vitest run \
  tuzi-video-request.test.ts gemini-omni-video.test.ts \
  provider-routing.test.ts model-config.test.ts \
  ai-generation-preferences-service.test.ts ModelDropdown.test.tsx \
  ParametersDropdown.test.tsx ParametersDropdown.kling.test.tsx \
  runtime-model-discovery.test.ts
```

最初增量组件测试发现本地按钮未提供上游已有的选中状态，补齐后最终全部通过。
既有 localStorage/indexedDB 测试环境诊断和构建 Sass/CSS/动态导入 warnings 保留。
本轮未新增浏览器页面验收或收费请求，未执行全量测试、独立 drawnix 源码类型检查或原生应用构建；
前述真实接口与原生端到端限制仍适用。未提交、推送或发布。

日志：`/tmp/switch-336-baseline-tests.log`、`/tmp/switch-336-final-tests.log`、
`/tmp/switch-336-typecheck.log`、`/tmp/switch-336-build.log`。

## 高级参数与输入栏素材同步（最新）

本轮固定来源为 PR #336 的 `f8ff9cd6...c1c2366b`，功能提交 `84ad6d83`。
本地分支仍为 `codex/sync-video-336-fixes`，保留此前未提交的适配改动。
环境为 macOS、Node v26.8.1、pnpm 10.21.0，全部请求测试使用合成凭据及内存响应，未读取真实 Key。
按项目惯例更新现有 DOC/QA，不复制上游的真实验收结果作为本仓结果。

| 测试范围 | 预期与实际结果 |
| --- | --- |
| Gemini 输入及输出 | 原始本地图片、缓存视频转 MIME/Base64；公网 URI 与显式 MIME 保留；多模态文本不与顶层 prompt 混发；独立尺寸/比例、旧像素恢复、编辑/延展字段及 10 秒延展上限通过 |
| Wan 参数 | 混合图/视频/音频、音轨、改写、seed、文档/网页及智能时长的最终 JSON 通过，false、0、-1 保留；本地旧静态时长白名单已补齐 -1 |
| 输入栏自动模式 | 无附件、单图、双图、多图、图片加视频/音频均按预期映射；忽略旧素材和旧手动模式；菜单不出现重复素材/参考模式表单 |
| Kling 扩展 | 所有素材角色、唯一 ID、主体/音色及数量/已知时长限制通过；原尺寸/比例选择及八种旧像素尺寸回归通过 |
| HappyHorse I2V | 图像存在时空提示词通过输入解析、工作流、MCP async/queue、任务校验和共享请求；300 像素、比例边界及 R2V 400 像素检查通过；旧 1.0 合同回归保留 |
| 拒绝路径 | 互斥输入、超数量、重复 ID、未知字段、错误 MIME/大小/图片尺寸、受保护 URL、无图或缺少前序 ID 均在提交前拒绝；提供方拒绝不自动重提 |
| 主线程及共享路径 | 主线程从缓存原始 Blob 构造 Gemini Base64；六型号 JSON、参考图顺序、尾帧缺首帧保护通过；共享提交及 HappyHorse 专用适配器回归通过 |
| 偏好及其他回归 | 按型号/供应商隔离素材和前序身份、旧尺寸恢复、模型短代码、目录发现、路由、旧 Omni 1.1 与工作流回归通过 |

实际命令与结果：

```sh
pnpm --filter @tuzi/creative-workspace exec vitest run \
  tuzi-video-advanced.test.ts tuzi-video-request.test.ts \
  tuzi-video-workflow.test.ts tuzi-video-generation.test.ts \
  video-api-service.test.ts ai-generation-preferences-service.test.ts \
  ParametersDropdown.test.tsx ParametersDropdown.kling.test.tsx \
  gemini-omni-video.test.ts model-config.test.ts provider-routing.test.ts \
  runtime-model-discovery.test.ts workflow-converter.test.ts \
  video-reference-image-utils.test.ts ModelDropdown.test.tsx

pnpm typecheck

pnpm exec tsc --noEmit --strict --skipLibCheck --target es2022 \
  --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable \
  packages/creative-workspace/upstream/packages/drawnix/src/services/tuzi-video-request.ts \
  packages/creative-workspace/upstream/packages/drawnix/src/services/tuzi-video-media.ts \
  packages/creative-workspace/upstream/packages/drawnix/src/constants/tuzi-video-models.ts

pnpm --filter @tuzi/creative-workspace build
git diff --check
```

最终 **15 文件、554 项全部通过，无跳过**。宿主 TypeScript 与上述合同/媒体模块的独立严格类型检查通过，
不称为整个 drawnix 源码的类型检查。创作生产构建通过（26.41s），已更新宿主预览消费的产物。
既有 localStorage/indexedDB 初始化诊断、缺少第三方 source map、Sass/CSS/动态导入 warnings 保留。
修改前原工作流测试 75 项通过；首次新增验证暴露的 Wan 静态白名单、旧假图片及旧单图断言已修正，
没有将这些问题归为基线失败或跳过断言。

7206 检查时原服务已停止，已用 `pnpm exec vite --host 127.0.0.1 --port 7206 --strictPort` 重新启动；
服务 HTTP 检查仅代表可访问，不代表新增页面流程验收。

本轮未新增收费生成、真实素材上传、浏览器页面测试、全量测试、ESLint 或原生包构建/安装。
Gemini 编辑/延展及其他新增模式的线上受理情况未验证；上游真实样本不作为本仓通过证据。
Wan 视频/音频和 Kling 视频仍须公网 URL；原生桥保留 64 MiB 请求总量限制，多份 Base64 可能先触及该限制。
图片头检查不等同于完整图片解码；远程媒体属性和前序任务权限由服务端最终校验。
没有提交、推送、更新 PR 或发布。

日志：`/tmp/switch-336-advanced-baseline.log`、`/tmp/switch-336-advanced-final-tests.log`、
`/tmp/switch-336-advanced-typecheck.log`、`/tmp/switch-336-contract-types.log`、
`/tmp/switch-336-advanced-build.log`、`/tmp/switch-7206-preview.log`。

## 最新构建真实生成验收（2026-11-15）

用户本轮明确授权真实生成。使用 ego-browser 操作 `http://127.0.0.1:7206/` 的最新创作构建，
新建项目 `真实视频验收 2026-11-15（6次）`，不修改原有画板。
六个型号各一次使用真实 Key 的生成 POST，固定最低时长与较低清晰度，受理后仅查询原任务，不重提生成。

浏览器预览缺少原生账户 IPC。本轮临时加入只含占位认证的供应商，真实 Key 只在页面内存的
fetch 包装中注入，并仅发送给 `https://api.tu-zi.com`。生成路径、模型和最低时长由临时护栏限制，
每型号最多一次有效 POST；模型列表认证预检 HTTP 200，包含全部六个目标 ID。
本次走实际输入栏、工作流、队列、适配器、提交、查询、缓存和画布插入，未使用模拟供应商响应，
不等同于原生账户认证或安装包验收。

### 真实请求与结果

六条有效 POST 均 HTTP 200，返回远程任务 ID，最终全部 completed。
使用自制 768×768 PNG 红船图；R2V 第二张图仅改变阳光色调，图片不含用户私有材料。

| 模型 | 实际抽样参数 | 结果 MP4 | 任务 ID |
| --- | --- | --- | --- |
| wan3.0-video | 2s、480P、adaptive、输入栏单图自动首帧、watermark=false、audio=false、prompt_extend=false、seed=0 | 640×640、2s、676035 bytes、0 音轨 | task_WLRTntYMGLycYg0Dph3Dnl3FbKwdmcAe |
| gemini-omni-1.2-flash | 3s、360p、9:16、image_to_video；本地图像以 input 的 text+image/MIME/原始 Base64 提交，无顶层 prompt/input_reference 混发 | 360×640、3.029333s、1164912 bytes、1 音轨 | task_dc98CbHlTf1JNmFzEOLXNCH2JL9h0L9o |
| kling-4.0 | 3s、720p、21:9、输入栏单图自动 refer_image、watermark=false；contents/settings/options | 1460×624、3.041995s、686683 bytes、1 音轨 | task_A665yYV4j9tLQ4ubsHHX34LPVGTWaNqI |
| happyhorse-1.1-t2v | 3s、480P、1:1、纯文本、watermark=false、seed=0 | 640×640、3.162667s、356908 bytes、1 音轨 | task_t9jT6PcQFajQR44LjOYgGrJ6eJTQDS6B |
| happyhorse-1.1-i2v | 3s、480P、单图、空提示词、watermark=false、seed=1，不发 ratio | 640×640、3.162667s、345044 bytes、1 音轨 | task_zDvW7gg6k8n0TaYwxuhz520ChUaJZZ6i |
| happyhorse-1.1-r2v | 3s、480P、9:16、两张有序图片、watermark=false、seed=2147483647 | 480×848、3.162667s、334039 bytes、1 音轨 | task_0SLWE8anoHlQdCyTddAB7S0peLM4CRPH |

I2V 曾持续显示 in_progress/30%，最终原任务完成，没有新建替代任务。
全部结果在应用本地缓存中取得 `video/mp4`，宽高/时长由浏览器解码缓存 Blob 得到，
音轨数量由原始 MP4 的 moov/trak/mdia/hdlr 解析得到，没有将接口档位当成实际像素。
六个画布播放器均实际静音播放超过 0.35 秒，readyState=4，无媒体解码错误。
Wan 的音轨关闭在该文件中得到验证；其余音轨只核验存在，未评价声音内容。

### 接入调试与结果边界

- 接通内存认证之前有一次 Gemini POST 使用占位认证被 HTTP 401 拒绝，没有生成任务；这不是 Key 文件失效。随后模型列表真实认证 HTTP 200。
- 另有一次 Gemini 默认 10 秒被本地 3 秒护栏拒绝，未发出生成 POST。调整为 3 秒后才执行表中的有效请求。
- 因而本轮并非所有尝试均通过：服务端收到 1 次占位认证失败和 6 次有效生成；另有本地预算拦截。两张接入调试失败卡片保留于独立测试项目，不视为最终模型样本失败，也不删改为成功。
- 新结果自动选中时，先取消选中再发送下一条，避免无意把结果视频作为参考素材；未通过重复点击重提已受理任务。
- Kling 720p 档位实际短边为 624，约为 21:9；HappyHorse 480P 方形样本为 640×640。档位不保证固定输出像素，未为此追加生成。
- 未核对账单金额、seed 可复现性或改写内部行为；未真实覆盖 Gemini 编辑/延展、多视频输入、Wan 智能时长/混合视频音频/file/link、Kling 主体/音色及复杂角色、全部清晰度和组合。

### 清理与恢复

完成后恢复原设置，移除临时供应商及 fetch 包装，刷新后重新打开创作工作区。
已确认测试 Hook 不存在、临时供应商不存在、活动任务 0；六个视频均从缓存恢复到有效宽高，readyState=4、无解码错误。
真实 Key 未写入供应商设置、源码、QA 或请求摘要。保留真实结果项目及浏览器结果页供查看。
未新增产品代码修改、提交、推送或发布；本轮无需重跑先前已通过的 554 项逻辑测试。

脱敏请求/任务/媒体/播放/刷新摘要：`/tmp/switch-video-real-20261115.json`。
现场及恢复截图：`/tmp/switch-video-real-20261115-current.png`、`/tmp/switch-video-real-20261115-restored.png`。
以上是本仓最新构建的真实样本，前文 2026-11-14 的“新增能力未真实验收”属于当时状态。
