# 本地附件实现决定（UC-TEXT-ATTACH-01）

用户已选方案 A。本文件记录该范围内的实现选择，无新产品范围。

- 会话 version 1 增加可选 `messages[].attachments` / `draftAttachments` 引用。正文在 `aitu-chat/text_attachments`，记录含 ref、sessionId、text 或 dataUrl，图片可选 thumbnailDataUrl。旧会话无需迁移。
- 发送前按顺序解析引用，校验归属、图片数量/体积和文本上下文；到达上限即停止读取。持久化成功后才请求供应商，失败仅由用户点击重试。
- 图片在本机压缩至 2048 边长/2 MiB，并生成 160px 缩略图。列表只保留缩略图，预览/请求才读取完整压缩图。无原始图片归档保证。
- PDF 使用已有依赖的延迟加载 legacy 兼容解析器和本地内联 worker，中文字符映射/标准字体也随包延迟加载，退出/取消销毁；只保存文字，不保留原 PDF。扫描件不做 OCR，空页明确提示。纯文本严格 UTF-8，拒绝 NUL/无效编码。
- 解析批次串行、可取消；切换会话/隐藏界面中止处理，已完成附件保留。每条 6 个/20 MiB原文件，文档8万字符上限在提取时检查。
- 复用现有环境备份，增加可选 `localForage.textAttachments`；恢复前校验附件，避免异常附件在覆盖清理后才被拒绝。既有跨存储恢复不具备整体原子回滚，本轮没有扩大该保证。
- 备选为把全部 data URL/正文写进会话快照，会导致每次流式保存和会话列表复制更大；独立存储维护多一个可选备份字段，但降低高频保存成本。回退旧应用仍可读取文本，附件功能需保留当前版本，降级前建议导出含附件的备份。

原生 WebKit 兼容：getTextContent 内部的 ReadableStream 异步迭代在系统内核中不可用；直接 streamTextContent().getReader() 分段读取，片段级限额、取消/释放 reader。回归主动移除 Symbol.asyncIterator 再上传PDF，覆盖真实失败条件。
