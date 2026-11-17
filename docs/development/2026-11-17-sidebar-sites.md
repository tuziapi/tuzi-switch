# UC-SIDEBAR-SITES-1117：侧栏站点入口

用户要求在 opentu 创作后依次加入直连站 https://web.tu-zi.com/ 和兔小店 https://store.tu-zi.com/ 。

实现复用 TuziSidebar 的菜单样式与 settingsApi.openExternal，在系统默认浏览器打开 HTTPS 地址；失败显示提示。侧栏展开、收起及创作页共用导航均保留入口，收起时有图标、可访问名称和浏览器打开提示。不新增账户字段或修改网站登录流程。

验证：pnpm typecheck、该组件 Prettier 检查、现有 TuziSidebar/TuziNavigation 共 9 项测试、git diff --check 通过。现有 ui04 合成浏览器预览核对菜单顺序、展开/收起及点击后页面保持，截图见 attachments/sidebar-sites-1117/sidebar.jpg。合成 IPC 没有真正启动系统浏览器，不冒充安装包实测。

仅本地实现与提交，尚未重新构建、安装或发布；已发布的 1.6.3-beta.1 安装包不包含本次入口。未修改 API 契约、生产配置或现有应用数据。
