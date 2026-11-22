# UC-OPENTU-CONNECTOR-1122：一键连接 Codex

日期：2026-11-22。用户选择“一键安装本地连接器”，本轮授权本地实现和验证，无 push、PR、发布。基线 `fedb2205`，工作分支 `codex/opentu-codex-connector`。设计见 [ADR-025](decisions/0025-opentu-codex-local-connector.md)。

## 完成的实现

- 设置页、创作项目页：一键连接、修复、解除；手动 HTTP 配置折叠为备用入口。
- 内置 stdio 连接器、每请求重新发现当前端口与短期认证、无 GUI 启动分支。
- 原子安装、仅更新自有 MCP 项；路径/权限/冲突校验，保留其他工具设置。
- 明确区分配置完成、本地服务检查、连接器实际调用；补齐中英日文文案。

## 验证证据

| 层级 | 验证 | 结果 |
| --- | --- | --- |
| 连接器进程与配置 | `cargo test --manifest-path src-tauri/opentu-connector/Cargo.toml` | 7 项通过；包含真实 stdio 子进程、loopback HTTP、同进程跨端口/令牌轮换、重定向拒绝、权限/符号链接、配置保留/冲突、脱敏错误 |
| 设置交互 | `vitest run tests/components/OpenTuConnectionPanel.test.tsx` | 6 项通过；写入成功与客户端调用分离，失败不暴露异常内容 |
| 原有画布桥接 | creative-workspace `tests/opentu-mcp-bridge.test.ts` | 15 项通过 |
| 类型 | `tsc --noEmit` | 通过；新 worktree 补齐既有依赖链接后复验 |
| 创作与宿主构建 | creative-workspace `vite build`、根目录 `vite build` | 均通过；保留既有 Sass/大包警告 |
| 原生集成编译 | `cargo check --lib --bins --features opentu-preview` | 通过，包含宿主命令注册与二进制入口；8 项既有 unused 警告 |
| 真实已安装应用 | 新连接器 stdio → v1.6.3 HTTP → Tauri → 当前验收画布 | 初始化、9 工具发现、get_canvas 成功，返回 4 个画布元素；未修改作品、未发起付费调用 |

真实应用测试只读取已保存的该 MCP 配对，临时运行文件使用 0700/0600 并在测试后删除；没有把令牌写进报告或仓库。脱敏结果在本机 `tuzi-switch-artifacts/real-acceptance-20261122/connector-live-read.json`，原生编译日志同目录 `connector-native-check.log`。

## 尚未验收 / 发布限制

- 上述真实调用由独立连接器验收进程发出，不是当前 Codex 会话调用；不得标成“Codex 已实测连接成功”。
- 完整新安装包中的按钮点击、宿主真实冷重启后自动发布运行记录、安装路径升级稳定性尚需验证；合成进程轮换通过不能代替完整桌面冷重启。
- Windows/Linux 原生运行、ACL 与安装包未验收。
- 本机编译检查完成时剩余磁盘约 203 MiB；已清理本轮生成的约 1.1 GiB 原生编译缓存，保留源码和日志，未删除用户文件。空间仍不足以稳妥生成和验证完整桌面安装包。
- 没有修改用户现有 Codex 配置，没有覆盖已安装兔子助手，没有 push/PR/发布。已有手动 OpenTu 配置应在启用新连接器后停用，避免重复服务。
- 本轮连接器验证没有新增模型费用；此前真实生成测试记录约 ¥0.97，授权上限 ¥5。
