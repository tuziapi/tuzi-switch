# SD55-01：Seedream 5.5 桌面完整适配

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
