# tuzi-switch 基于 ccswitch 整合新版本实施进度

## 当前结论

新版本已按“完整 CC Switch 底座 + Tuzi 产品扩展”的方式建立在独立工作树中，未覆盖旧
`tuzi-switch` 工作区。

- 实施分支：`codex/tuzi-next`
- CC Switch 精确基线：`f6e37ed99443890a865669e28bf1caf5e85d466d`
- CC Switch 基础版本：`3.17.0`
- Tuzi 当前版本：`3.17.0-tuzi.1`
- 基线记录：`upstream-base.json`
- 维护与发布说明：[`tuzi-upstream-sync.md`](./tuzi-upstream-sync.md)
- QA 报告：[`tuzi-switch基于ccswitch整合新版本QA报告.md`](./tuzi-switch基于ccswitch整合新版本QA报告.md)

该基线位于 CC Switch `v3.17.0` 标签之后 6 个提交，包含 Codex 流式工具调用、严格
OpenAI 兼容参数和跨平台 CI 修复。

当前代码和自动化通过指向 `develop` 的 PR 交付。合并前 GitHub 远端不会执行新工作流；
定时同步还要求工作流存在于仓库默认分支。

## 已完成

### 完整 CC Switch 底座

- 首次整合以 CC Switch `main` 精确提交为代码主体，后续只跟随最新正式 Release。
- 保留原有 Provider、代理、会话、统计、MCP、Skills、Profiles、跨平台和 CI 能力。
- 增加每小时正式 Release 检查及精确基线记录。
- 同步流程通过 PR 接入，不直接覆盖 Tuzi 主分支。

### Tuzi 产品层

- 应用名、包名、Bundle ID、深链接、托盘、配置目录、数据库和日志完成 Tuzi 化。
- 更新地址和发布流程指向 `tuziapi/tuzi-switch`。
- 增加集中式 Rust 产品常量模块，减少品牌值散落。
- 接入 Tuzi 图标及多平台资源。
- 增加产品不变量检查，防止后续上游同步覆盖 Tuzi 品牌和默认配置。

### Tuzi 功能层

- Tuzi Provider 作为 CC Switch 原生 Provider 扩展接入。
- 保留兔子线路、Codex 订阅、GACCode 等 Tuzi 预设。
- 保留 Codex 默认 `gpt-5.6-sol` 与第三方图片生成兼容请求头。
- Codex 统一会话桶固定为 `tuziswitch`。
- 支持旧 Provider 历史和 SQLite 状态归并。
- 支持官方会话迁移、备份与按账本恢复。
- 保留旧 `custom` Provider 表，不覆盖用户第三方配置。
- 保留 CC Switch 旧模型目录文件名兼容，升级后可识别和清理
  `cc-switch-model-catalog.json`。
- 保留 Tuzi 更新器超时后的 GitHub Release 发现降级能力。

### 旧数据兼容

- 默认继续使用 `~/.tuzi-switch`。
- 数据库继续使用 `tuzi-switch.db`，与当前旧 Tuzi 实际数据一致。
- 继承 CC Switch 的 SQLite schema 迁移、迁移前备份和未来版本保护。
- 继承旧 JSON 配置、MCP、Skills、Prompts 等迁移链路。
- Codex 会话 JSONL 使用流式处理，SQLite 使用事务和有界参数批次。

## 本轮修复

审计现有整合实现时发现并修复：

1. 旧标准化 Provider 配置可能是 `model_provider = "custom"`，但 Provider 表已变为
   `tuziswitch`，导致无法恢复原始预设 ID。
2. 官方会话恢复测试仍保留 CC Switch 的 `custom` 桶断言。
3. Codex 模型目录改名后只识别 `tuzi-switch-model-catalog.json`，未兼容旧
   `cc-switch-model-catalog.json`。
4. 统一会话测试仍按旧 `custom` 桶和冲突规则断言。

修复后旧 CC 模型目录可继续被安全识别，但新写入统一使用 Tuzi 文件名；用户自定义模型
目录不会被误删。

### 发布工程收尾

- 发布前强制校验 Git tag 与 `package.json`、Tauri、Cargo 版本完全一致。
- 发布前再执行 Tuzi 产品不变量检查，避免错误品牌或上游版本被打包。
- Web 热更改为依赖原生产物成功发布，防止原生发布失败时先行上线不匹配的前端资源。
- updater 清单分支支持首次发布自动创建，不再假设 `release-manifest` 已存在。
- 正式 Release 禁止在 updater 私钥、Apple 签名或公证凭据缺失时静默降级发布。
- Web 热更作业统一使用 GitHub `release` Environment 中的发布密钥。
- Web 资源分支改为增量发布，保留历史 `versions/<tag>` 资源，仅首次发布创建分支。
- README 的产品入口、下载产物、深链和数据目录已切换为 Tuzi，同时保留 CC 上游归属。
- Linux Wayland 环境变量新增 `TUZI_SWITCH_GDK_BACKEND`，并兼容原 `CC_SWITCH_GDK_BACKEND`。
- 修复 macOS 静默启动后再次启动或从托盘打开时，激活策略未恢复导致“进程在但窗口不见”的问题。
- 按本机已安装兔子switch App 的实际内置数据，将 Codex 兔子线路的 6 个端点统一映射到新版 `tuzi-route`。
- 上游跟随改为每小时检查 CC 最新正式 Release，合并对应 tag 的完整源码，而不是只跟随未发布的 `main`。
- 同步 PR 在全量 CI 通过后自动合并，随后创建 Tuzi tag 并构建签名的全平台完整安装包。
- 客户端已有原生 updater 下载、安装和自动重启链路，因此 CC 发版后生成的 Tuzi 完整版本可直接升级。
- 新增 `tuzi-protected-paths.txt` 硬保护层：CC 合并后先从 Tuzi `develop` 恢复产品专属文件，保证上游更新只改底座、不改 Tuzi 功能。

### 自动同步与 Tuzi 功能保护收口

- 保护清单从合并前的 Tuzi `develop` 读取，并把清单自身和同步工作流纳入保护，防止上游弱化保护边界。
- 基线同时记录正式 Release tag、Release commit 和已整合 commit；新 Release 不包含既有 commit 时停止自动同步。
- 发布 tag 锁定到已通过 CI 的同步 PR 合并 commit，不会混入等待期间进入 `develop` 的其他提交。
- 补齐工作流 `actions: write` 权限和 Windows PowerShell 资产收集语法。
- 强制检查 macOS、Windows、Linux updater 产物和签名，缺失时不创建正式 Release。
- Tuzi 产品契约覆盖品牌、数据目录、更新地址、六线路、会话迁移、官方认证、生图配置和热更新接线。
- 旧设置缺少字段时，官方认证保留和统一会话历史默认开启；用户显式关闭仍被尊重。
- 启动时只补齐兔子 Codex 路线缺失的六个端点，不覆盖密钥、模型、排序或已有自定义端点。
- Web 热更新必须包含 Tuzi 契约和项目切换标记；缺少项目切换能力的旧界面包不会加载。
- 原生更新负责完整应用能力，界面热更新只发布签名前端资源；两条链路均在“通用/关于”更新入口中检查。
- 增加统一入口 `pnpm check:tuzi`，本地和 CI 使用同一产品契约门禁。

## 后续实施事项

1. 合并当前 PR 到 `develop`，并将同步工作流纳入默认分支或将 `develop` 设为默认分支。
2. 评估页面级懒加载，进一步降低主 JavaScript chunk。

测试结果、阻断项和发布环境待验收内容统一记录在独立
[`QA 报告`](./tuzi-switch基于ccswitch整合新版本QA报告.md)中。

## 工作区说明

- 旧工作区保留原有未提交修改，没有被覆盖。
- 旧工作区修改已额外导出补丁并记录 SHA-256，用于异常恢复。
- 新版本实现位于独立工作树，后续修改和提交应在 `codex/tuzi-next` 分支进行。
- 参考用 `cc-switch/` 嵌套仓库不能提交到旧 Tuzi 仓库。
