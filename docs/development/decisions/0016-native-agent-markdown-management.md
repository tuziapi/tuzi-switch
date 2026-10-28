# ADR-016 用户级原生 Agent Markdown 管理

日期：2026-10-27。状态：按用户“下一阶段可以开始”的授权实施，作用域为 UI-07，本地验证；不授权远程或发布。

现有 Agents 页只有占位。参考项目没有可复用的统一 Agent 管理器；Claude Code 和 OpenCode 的用户级 Agent 均有文档明确的 Markdown 目录，但 frontmatter 和标识语义不同。Codex 子代理并发、OpenClaw defaults 与这两类文件不是同一对象，继续使用既有专属入口。

选择两个独立工具原生文件适配，用户显式选择目标；直接编辑 YAML frontmatter 与 Markdown 原文，未知字段不重序列化。Claude Code 用 name 标识并拒绝同名，OpenCode 用文件名标识。不引入统一中间格式、SQLite 存储或自动跨工具同步，避免丢失工具专有字段与权限。当前不执行 Agent，不扫描项目/插件目录，不管理内置 Agent。

替代方案：统一表单和跨工具同步更易上手，但必需维护字段映射、权限差异、项目发现和同步事务；作用域未冻结时容易造成错误改写。仅展示只读文件列表代价低，但不能满足本阶段可用管理目标。因此先交付用户级原文编辑，后续扩展独立决策。

固定根目录、相对 .md 白名单、符号链接拒绝、大小/数量上限、文件集 revision、原子私有写和进程锁作为本地边界。单步恢复记录绑定根目录和写后 revision；外部文件变化拒绝覆盖。新增内容字段必须显式存在，null 代表删除，缺字段拒绝；保存失败保留旧恢复记录。文件名大小写冲突拒绝，避免 macOS/Windows 将新增别名视为覆盖。

回退以本地提交 git revert 实施。用户原生文件与恢复记录保留，不自动删除或迁移。无 API、账户令牌、OAuth、模型请求、数据库迁移或 WebDAV 契约改变。

格式依据（2026-10-27读取）：[Claude Code subagents](https://code.claude.com/docs/en/sub-agents)、[OpenCode agents](https://opencode.ai/docs/agents/)。官方路径只证明文档格式；真实已安装工具版本的发现与运行仍须单独验收。
