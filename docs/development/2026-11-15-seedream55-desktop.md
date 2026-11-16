# SD55-01：Seedream 5.5 桌面完整适配

> 2026-11-16 当前状态：用户已授权继续真实付费测试。最新22ae76d2已安装，已完成一次真实生图及ch=3成功结算；画布左上角更新提醒和工具栏避让已实现，最新包分层/OCR、导出、重启及长提示词避让实测尚待完成。986e0884此前的透明像素、5图层中英文OCR、本地缓存、ZIP及重启通过证据仅属于该旧包。正式候选43786133865已获用户签名审批，四平台构建进行中；正式发布门禁仍未通过。详见[逐包真实验收](2026-11-16-latest-package-real-acceptance.md)。下文为历史过程，不作为最新包通过证明。

当前状态补充：用户暂时无法操作电脑，且明确暂不追加付费测试。两次授权提交已用完；供应商传递、旧 Key 回退及预览修复已进入本地收尾，新包实装和真实分层/OCR仍未通过。后续以[最终整合记录](2026-11-15-final-release-readiness.md)中的最新交付状态为准；不再等待用户设置分层参数，不发布。

最新覆盖（2026-11-15 晚）：已整合测试 main 至 `6cfb7f9e`，真实透明生图1次成功、¥0.091、持久消费列表ch=3；详情遗漏来源字段与分层预览破图已隔离修复，分层/OCR第二次提交未得到结果、未重试，窄范围未查到账单但费用未确认。新安装包与签名候选仍待验收。用户已授权验收通过后发布，当前未满足条件。以下旧候选和“0次调用/未授权”均保留为历史时点；准确现状见[最终整合记录](2026-11-15-final-release-readiness.md)。

用户2026-11-15明确选择完整适配（生图、透明背景、分层、OCR）。基于已同步PR #73的独立分支实施，不改变旧模型或本地分层入口，不调用付费模型。

## 配对契约

API HEAD `28443ae853a24165b23638a8b98d3ad96ddba4f0`，对应 `docs/2026-11-11-seedream55.md`、`dto/seedream55.go` 与共享 `dto/testdata/seedream55_native.json`。共享合成用例原样复制到桌面 `packages/creative-workspace/tests/seedream55-native-fixtures.json`。API目录现有其他会话改动保持不动。无数据库迁移、价格或生产配置改动。

## 实现与字段

- 精确ID `doubao-seedream-5-5-261028` 加入模型目录与适配器。普通生图支持1K/1.5K/2K、比例转换及契约内像素尺寸，最多10参考图，单次一张；保留透明/不透明/自动背景与PNG/JPEG。透明+JPEG、4K、超量输入、不支持的流式/组图等在发送前拒绝。
- 新的图片工具栏“Seedream 5.5 分层 / OCR”打开参数对话框。默认29个前景层，加底图总数30；支持1–99个前景层、auto/1K/1.5K/2K、可选OCR（默认false）。只提交一次明确选定的模型请求，无隐式跨模型付费重试。旧“AI分层”的本地优先逻辑保留。
- `LayerDecompositionRequest` 新增可选 `size`、`textRecognition`、`outputFormat`；只在5.5路径映射为原生 `size`、`layer_decomposition_options.text_recognition`、`output_format`，`max_images=maxLayers+1`，显式false保留，拆图不传background。
- `LayerArtifact`/画布 `SemanticLayerMetadata` 新增可选 `background`、`textRecognition`、`providerMetadata`。OCR富文本嵌套及未知扩展深拷贝保留，经画布存储、重载及manifest/ZIP导出传递。原始重复媒体字节不再复制进metadata；已知媒体内容由图层URL表示。旧schemaVersion1文档缺少这些可选字段时仍有效，不需要迁移。
- 重复URL不合并图层，任一结果失败、重复z_index或返回超过请求上限时整体拒绝。5.5专用上限99不提高本地服务的16层限制。缺少实测SSIM时不填造质量分数；界面提示检查分层效果，并展示识别文字，完整样式随清单保存。
- 修复模型参数筛选中特判GPT背景参数时未核对参数所属模型族的问题，防止Seedream背景选项重复进入GPT菜单。

## 验证与限制

- API合成测试：`go test ./dto ./relay/helper ./relay/channel/volcengine ./relay/channel/openai ./relay -run Seedream55 -count=1` 五包通过。
- 桌面共享契约/请求/分层/交互66项，额外普通适配器发送回归1项；模型与参数兼容164项通过。全量创作159文件2681项、宿主99文件839项通过；类型检查与renderer构建通过。后续微调取消处理和OCR文字展示，定向66项再次通过。
- Chrome和WebKit隔离浏览器均经实际菜单、生图队列、图层Provider、画布与IndexedDB完成生图→分层/OCR→应用→重载，验证3个相同URL图层未合并，OCR文字、样式与未知扩展保留。验证源码 `a986a3d03c8d1bd84214e8916d8378b314d6bc2d`；结果分别保存在 `/tmp/tuzi-seedream55-expanded-chrome/seedream55-results.json` 与 `/tmp/tuzi-seedream55-expanded-webkit/seedream55-results.json`。脚本 `tests/visual/seedream55-acceptance.cjs`，仅原生HTTP边界返回合成数据，外网请求全部阻断。补查透明PNG界面选择实际发送 `background=transparent`、`output_format=png`，OCR详情可展开并读取文字；汇总见 [双浏览器记录](evidence/2026-11-15-seedream55-browser.json)。Chrome截图已人工查看。浏览器运行时安装在仓库外；安装器清理的既有WebKit2386缓存已按官方同版本归档恢复，未更改项目依赖。
- 真实供应商权限、生成效果、透明像素和实际OCR准确率/计费没有付费联调，不能标为真实模型验收通过；最终签名安装包与跨平台实装验收见UP-03。未发布。

OpenSpec记录：`packages/creative-workspace/upstream/openspec/changes/add-seedream55-desktop/`。本机未安装openspec CLI，已人工核对需求/Scenario格式，不声称CLI验证通过。

## 正式Windows包补验与分层后占位残留修复

43697704283的NSIS/MSI实际安装包完成普通UI→原生HTTP→透明PNG→三图层/OCR→正式签名自动升级→画板/任务/图层元数据/透明像素恢复，15项子集通过；本机合成供应商，非真实模型效果验收。截图审查发现快速分层替换原图后，原生成占位卡未结束。真实Plait变换测试及原构建Chrome均复现；修复让图层继承已有generationTaskId/generationAnchorId，只在原图已有字符串关联时保留，无新增存储schema或对导入图片伪造任务关联。

新增回归验证全部图层真正绘制就绪后才完成旧任务占位，以及JSON重载后的关联；导入图片无关联继续保持。17项定向、160文件2683项创作全量、宿主类型及创作构建通过；Chrome/WebKit实际生图/分层/OCR/保存重载均验证占位消失且重载不复现。原生候选测试也加入此必需断言，旧候选不会被误记完整业务通过。见evidence/2026-11-15-layer-generation-handoff.json。修复后的正式签名候选须重新构建与实装验收，不能用前一候选通过证据替代。

补丁重建检查发现此前PR#73视频及Seedream新增12条源码/规范路径未登记在UPSTREAM.json，已按实际引入commit补登记并重建完整补丁，1523原始文件+116本地文件=1639文件逐字节还原通过。生成的统一diff保留其必需空白上下文，不按普通源码尾空格规则改写；普通修改通过git diff --check，补丁独立通过git apply --check及全部文件字节比对。未更改原opentu源码仓库。


## 修复正式候选 Windows 四组业务升级复验

修复候选43699923173/5bfee5f3已经完成四平台正式更新签名及完整性独立核验。43703529198的NSIS/MSI × 旧1.6.0/1.6.1四组各16项通过：真实UI和原生HTTP执行Seedream5.5透明PNG、三图层/OCR；手动过渡及正式签名自动重启后，画板、图层、OCR嵌套字段、未知扩展、任务与精确缓存像素保留。新增completedGenerationPlaceholderRemoved通过，四张升级后创作截图人工核对无残留占位卡。供应商是本机合成HTTPS，真实模型质量、权限、准确率、计费和生产经营统计仍未验收。逐份证据见桌面任务清单。


## 有限真实调用授权与核价预检

用户已授权应用配置的专用测试Key执行1次透明生图、1次三层分层＋OCR，总费用上限¥5，先核实际价格上限、无法确认则停止、不自动重试。只核对这两笔消费及ch=3。当前真实调用0次。公开/api/pricing已返回精确模型tiered_expr计价，仍需核定专用Key及用户/分组倍率，不能用匿名价保证最终费用。普通应用绑定只发现“奶酪”/default，已向用户确认是否为专用测试Key；未擅用工具供应商凭证。计划在最终候选验签完成后执行，避免重复消耗预算。


### 2026-11-16 最新候选跨平台复验

基于已绑定的 43786133865/22ae76d2 候选启动独立原字节复验：Linux run 43794074569 的 AppImage、DEB、RPM（1.6.0/1.6.1）全部成功；macOS run 43794078636 的 ARM64 与 x64 成功。Windows run 43794070706 未通过：NSIS 创作保留检查观察到 generation-anchor 仍为 `phase=inserting`，MSI 一组等待“查看更新”超时。失败已保留，不以 Linux/macOS 结果替代，正式发布继续禁止。
