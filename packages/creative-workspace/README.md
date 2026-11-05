# 兔子助手创作模块

2026-11-04 UC-SYNC-FEATURE-01：当前已增量同步另一会话 `5148d469`，以桌面 `f3626780` 为创作原始基线，保留助手 `501af92c` 的图片右键/原生导出与账户适配。当前状态和旧字段兼容见 [同步记录](../../docs/development/2026-11-04-creative-feature-sync.md)；下文历史阶段说明不作为当前验收结论。

`pnpm test:creative` 独立运行创作测试（Vitest 3），`pnpm test:unit` 运行宿主测试（Vitest 2）。运行浏览器和宿主测试时不要同时重建创作 dist。来源补丁可用 `python3 scripts/refresh-creative-provenance.py --source-repo <包含固定桌面提交的本地仓库>` 重建，脚本不联网、不修改来源仓库，并逐文件验证重建字节一致。

本地 React 业务包，来源固定在 `UPSTREAM.json`。`upstream/LICENSE` 保留原许可；`UPSTREAM-PATCHES.patch` 记录集成补丁。更新上游时先比对原始哈希，再审查/应用补丁，不能直接用新目录覆盖本地改动。

`src/index.tsx` 装配真实项目服务与 Drawnix，`vite.config.ts` 负责依赖别名、React external、CSS 作用域及 worker 构建。宿主通过包导出懒加载，不运行 opentu 独立 bootstrap 或 updater。

`pnpm --filter @tuzi/creative-workspace build` 构建本包。整体状态、复现和未完成门槛见 [UC-P01](../../docs/development/opentu-unified-client-implementation.md)。当前仅为本地第一阶段预览，账户来源和受限模型请求已在 UC-P02 本地接入；原生媒体、完整任务链、真实账户、旧数据迁移和发布验收仍未完成。

独立工作流模块已按用户要求移除，仅提供项目与自由画布。自由画布内部的生成编排和任务队列不是被移除的页面模块，继续保留。

`UPSTREAM.json` 的 `files` 是保留源码的原始哈希；`omittedPaths` 明确排除工作流目录和专用资源/导航插件；`localFiles` 记录迁出的图片找回服务及本地账户关联组件/桥接。更新上游时必须先排除这些目录，避免重新带回已移除功能。补丁仅覆盖保留源码与本地新增文件，不包含已删除模块的完整代码。

账户关联复用原设置和模型路由，字段、安全边界与协议范围见 [UC-P02](../../docs/development/opentu-account-binding-implementation.md)。

UC-P03 通过显式 `requestManual` 接入宿主 HTTP，并修复原生流取消；仍不启用旧桌面全局存储标记。实现、独立测试包与剩余门槛见 [UC-P03](../../docs/development/opentu-native-runtime-implementation.md)。

内置二维码和供应商图标由模块导入随包分发，不依赖宿主 public 目录；旧 `/logo-tuzi.png` 仅在显示层解析，不改写存量配置。新增上游二进制资产须保留原始字节及 `UPSTREAM.json` 哈希，更新补丁后验证包与宿主 dist 均包含资源。显示回归见 `tests/visual/creative-{pages,key-dialog}-smoke.cjs`。

嵌入窗口与二级面板回归见 `tests/visual/creative-overlays-smoke.cjs`。WinBox 在宿主使用 `winbox/src/js/winbox.js` 的 ESM 入口，以保留动态尺寸约束属性；不要改回会重命名这些属性的预压缩 bundle。布局以 `.creative-root` 为边界，素材库另按自身窗口宽度响应。


UC-AC-R1 验收修复将任务执行与可见画布生命周期分离：宿主常驻组件传入 `active`，非创作页只保留任务运行与账户桥接，画布卸载；返回自动恢复结果。三个公开外站由受限 `openExternalTool(toolId)` 桥接打开，不插值 Key。备份在任何导入修改前校验完整 ZIP，但尚无跨数据库事务回滚。见 [上线验收报告](../../docs/development/opentu-release-acceptance-2026-11-02.md)。新增验收脚本为 `creative-{generation,backup,tools}-acceptance.cjs`；运行浏览器/单元验收时不要同时重建 dist，以免构建清理导致入口或动态模块暂时缺失。
