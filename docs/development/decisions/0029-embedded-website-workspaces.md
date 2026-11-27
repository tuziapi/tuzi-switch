# ADR-029：主窗口网站工作区与登录态保存

- 日期：2026-11-25；任务 SITE-EMBED-1125。
- 状态：用户明确确认「主窗口内嵌 WebView＋登录态持久保存」，本地实施。

## 决策

账户、创作、直连站和兔小店使用顶部下拉导航，主内容全宽。两个远程网站分别使用固定 label 的原生 child WebView，进入时按需创建，切出隐藏，返回不重新导航。直连站固定入口 `https://web.tu-zi.com/login`，商店 `https://store.tu-zi.com/`。不向网站注入账户令牌、密码或模型 Key。

macOS 14+ 使用由应用 identifier、网站 label 和固定 v1 名称计算的稳定数据仓库 ID；旧 macOS 由当前 Wry 回落到应用持久默认存储。Windows/Linux 使用 app-local-data/website-data/site-*。不启用 incognito，不清理 Cookie，不修改网站 Cookie 的有效期。网站自己的「保持登录/保持会话」决定服务器是否签发可跨进程复用的凭证。兔小店默认未勾选保持会话，宿主提供提示，不代替用户勾选。

原生网页高于 DOM，助手菜单、Dialog、环境变量提示显示时隐藏网页，关闭后恢复；resize/路由命令串行，防止旧创建覆盖新页面。HTTPS 弹窗交给系统浏览器，其他导航协议拒绝，不绕过证书验证。第三方 OAuth 弹窗和支付回跳尚未验收，不能承诺全部支持。

## 替代方案

iframe 初期成本低，但嵌入响应头、第三方存储和认证兼容受限；独立 WebView 弹窗已有实现，但不满足主内容区完整展示。选中 child WebView 需要启用 Tauri `unstable`（使用已锁定 2.10.3），跨平台回归成本更高。

## 权限与兼容

不配置 remote capability。额外在应用 invoke handler 前校验调用者必须是 main 且本地来源（调试版允许配置的 dev origin）；不能仅依赖插件 ACL，自定义命令在无 app manifest 时并不自动受相同限制。媒体、连接器等命令改按 Webview label 校验。窗口显隐/托盘/轻量模式查找改为 Window，网页导航查找改为 Webview，避免有 child 后 `get_webview_window(main)` 返回 None。退出前关闭网站 child 后保存 window-state；Cookie 仍由系统存储。

新增路由 direct/shop 不持久化，不改账户 system-token-v1、工具凭证或业务数据库。回退代码用 revert；已产生的网站 profile 不主动删除，后续升级保留固定 identity。

## 验证

见 [实施及验收记录](../2026-11-25-embedded-sites.md)。真实账户登录、Windows/Linux 与网站会话有效期必须单列，合成 Cookie 跨进程测试不替代真实登录验收。

## 2026-11-25 实际验收修订：恢复安全平台入口

真实登录后重启回到登录页。核查公开 `/login` 源码，DOMContentLoaded 会清除本域登录身份，因此每次启动固定打开登录页会抵消存储持久化。首次入口仍为用户指定 `/login`，后续仅在允许的平台根页面加载完成后记录安全入口。允许列表来自公开 `/platforms/config`：share/claude/grok 在 tu-zi.com、sydney-ai.com、opentu.ai 的九个 HTTPS origin。只保存固定根地址，不保存查询、fragment、路径、密码或令牌；getToken 过渡地址不记忆。未知域不记忆，显式返回 `/login` 重置为登录入口，会话有效性继续由网站判断。

新增独立 `app_local_data/website-data/direct-entry-v1.json`：`version=1`、`origin` 为再次校验后的固定公共入口。缺失、损坏、未知版本或非规范值回落原登录页；不迁移凭证，不影响 shop，不进入数据库或导出。临时文件原子替换；回退版本忽略该偏好，网站 profile 保留。新增入口净化、文件读写、显式登录重置与无效配置回退测试。
