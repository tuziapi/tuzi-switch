## 更新内容

- 修复 Codex 模型列表缺失，优化模型下拉列表滚动及模型数量提示。
- 修正 Claude/Gemini 等工具的协议识别，隐藏无法确认兼容性的模型，保持展示与保存校验一致。
- 修复 Codex config.toml 编辑时光标跳动、配置被反复改写和保存异常。
- 修复账户生成的 Codex 配置在模型检查时误报 `API Key not found`。
- 支持不同供应商卡片使用相同的 `model_provider` 标识，并分别保存凭证；启用时切换对应配置。
- 加强 Codex 保存及启用失败后的恢复，减少配置文件、凭证和当前供应商状态不一致的问题。

## 安装与升级

在下方 Assets 下载对应系统安装包：macOS 适用于 Apple Silicon；Windows 和 Linux 适用于 x86_64。Windows 可选择 MSI 或 setup.exe，Linux 可选择 AppImage、deb 或 rpm。

macOS / Linux 一键安装：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/tuziapi/tuzi-switch@v1.4.2/scripts/install_tuzi_switch.sh | TUZI_SWITCH_REPO=tuziapi/tuzi-switch TUZI_SWITCH_TAG=v1.4.2 bash
```

## 已知限制

- “清空 Key 后四位后仍保留旧搜索结果”的组合筛选问题按计划暂缓，本版本未修复。

完整改动：[v1.4.1...v1.4.2](https://github.com/tuziapi/tuzi-switch/compare/v1.4.1...v1.4.2)
