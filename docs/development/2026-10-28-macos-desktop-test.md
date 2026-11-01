# macOS 隔离桌面实测（2026-10-28）

## 范围与结论

在本机 macOS 26.5.2 ARM64，以当前 `gaizhao` HEAD `c99282989cfcaa04e55ac26c31e65dd8b2592874` 加未提交工作区改动构建并测试。测试包是 `local-preview` 调试构建，独立 bundle ID `com.tuziswitch.desktop.acceptance`，不是生产安装包。未访问真实账户、真实工具配置或付费服务。旧工具一致性与 Pi 跨设备归属问题仍未修复，不能据此判定可上线。

## 安装包

- 使用 `pnpm tauri build --debug --features local-preview --bundles app --config src-tauri/tauri.preview.conf.json --config '{"identifier":"com.tuziswitch.desktop.acceptance"}'`，Rust 工具链 1.95，构建成功。
- 标准 DMG 生成卡在 Finder 的 AppleScript 排版步骤，已终止；改以 `hdiutil create -srcfolder` 制作普通只读测试映像。映像校验、挂载、从映像启动成功。
- 临时包：`/tmp/tuzi-acceptance.arnm7n/tuzi-assistant-acceptance.dmg`；SHA-256 `f38a58665711bc6133535e5f7d870b66f447865011b59b06b0a23a18f559d0c3`。该临时路径可能被系统清理。应用为 ad-hoc 签名，无开发者签名或公证；不适合分发。
- 使用临时 HOME `/tmp/tuzi-acceptance.arnm7n/home` 启动，确认数据库及三工具配置位于该目录下的独立 preview home。未覆盖已运行的旧预览和用户日常配置。

## 实测结果

1. 真实桌面首次启动并进入 MCP 管理，添加 `fixture` 合成 stdio 服务器，勾选 Grok Build、Pi、MiniMax Code。确认原生流程生成三个工具配置文件。
2. Pi 1.4.0、Grok Build 1.0.70 使用桌面生成的文件连接本机合成 MCP 服务，各发现 1 个工具。MiniMax Code 0.7.0 使用同一桌面生成的 MCP 文件和另行提供的合成模型配置，调用本机合成模型，确认请求中包含该 MCP 工具。无真实模型调用。
3. 在桌面界面禁用 Pi，文件中 `enabled` 为 false；重新启用后 Pi CLI 再次发现该工具。通过界面删除后，三个工具配置中该测试条目均消失。
4. 将合成 Pi 配置放入隔离目录，通过界面“导入已有”导入；退出并重启测试应用后，界面仍显示该服务器。

## 未完成

- 仅验证 Pi 的禁用、启用及导入；没有逐一验证另外两工具的启停、导入和重启，也未验证异常恢复、并发冲突、跨设备备份恢复及账户真实服务。
- 未验证生产构建、签名/公证、安装升级、Windows/Linux、真实账户或用户验收。测试包使用的隔离开关和 bundle 标识与正式包不同。
- “从所有应用导入”按来源执行；新增工具内部事务并不保证所有来源整体原子。需要验证部分成功的反馈及恢复。
