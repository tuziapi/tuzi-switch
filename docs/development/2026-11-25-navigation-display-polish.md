# NAV-DISPLAY-1125：导航与小窗口展示修正

用户要求检查截图中跳转和展示问题并修复。基线 12fbaa41，分支 codex/embedded-sites-session，仅本地开发、验证与预览更新。

- 四个主入口从工具滚动区分离；品牌、四入口和底部设置保持可见，工具与工作区独立滚动。头尾及折叠按钮禁止 flex 压缩。
- 原生网站因菜单/弹窗遮挡而隐藏时，明确提示关闭后继续浏览，不再永久显示“正在打开网站”。网络加载提示由已有加载事件控制，失败有独立提示；工具条避免操作文字折行。
- 高度不超过 700px 时减少账户连接卡片内外留白和图标尺寸；移除首次进入连接页自动聚焦，避免返回时抢焦点或滚动到输入框。主动连接和已有令牌流程不变。
- 无新增持久字段、API 或凭证改动。

验证：pnpm typecheck 通过；EmbeddedSite、TuziNavigation、WorkspaceScope、account-navigation 共 29 项测试通过，覆盖菜单隐藏/恢复及占位提示。renderer、Mac ARM debug 预览构建和 adhoc 签名校验通过。原生检查 1200×800、约 1000×600：连接卡片/操作完整显示，工具滚动至工作区时四入口和设置仍可见，折叠侧栏后账户标题无重叠；进入直连站仍恢复现有登录页面。菜单提示行为有组件测试覆盖，最终原生菜单状态因自动化点击反馈不稳定未单独确认；不据此声称全部原生交互验收。未测试 Windows/Linux。

预览已原位更新并重启至首页，隔离账户仍未连接；未读取或迁移正式账户令牌。网站持久 profile 保留。旧预览备份在 outputs/embedded-sites/Tuzi Websites Preview-before-display-polish.app。日志 /tmp/tuzi-display-{types,tests,renderer,app}.log。未 push/PR/发布。
