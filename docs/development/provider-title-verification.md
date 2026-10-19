# B14 供应商标题字形（2026-10-19）

用户要求按“卡片与裸文字、字重、中文字体、字号、最终客户端”的顺序排查顶部削平观感。此次仅改变供应商标题：优先指定 PingFang SC，字重600改500，保留16px字号和24px行高；其他平台继续沿字体栈回退，不改变全局字体、账户/供应商行为或API。

客户端代码 `80354e6bc68bc3182c1ed470d408e75bda936e2e`，API未修改且HEAD为 `21cd7acd51349407cdc5d332a763907d065f9a86`，两仓均在 `codex/tuzi-assistant-system-token`，契约 `system-token-v1` 不变。工作期间另一轮B13代码提交 `d7b41dc` 进入当前分支，本次仅提交标题、局部字体规则和合成视觉夹具；B13及其他既有改动未被覆盖或整批纳入。

## 排查和选择

此前独立WebKit对照显示，去掉裁切容器、行高从24增至32仍有同样字顶形状。此次添加 `tests/visual/provider-title.html` / `provider-title.tsx`，使用真实 ProviderCard、项目CSS和Mock IPC；每组同时显示无裁切参考文字和卡片标题，使用合成名称/Key，不读取实际配置。

按顺序在Safari WebKit比较系统字体16px/600、16px/500、显式苹方16px/500、系统字体17px/500、苹方17px/500。参考文字和卡片标题未观察到额外笔画缺失；仅减轻字重效果较小，显式苹方500的字形更舒展，增加字号又改变布局。因此选16px/500显式中文字体，不继续增大行高或修改裁切容器。

客户端 Inspect Element / 调试快捷键未获得可操作面板，未注入运行时参考文字或读取其实际字体映射；替代为Safari中同WebKit、真实组件的同页对照，之后重建客户端核查最终字形。结论支持字体映射/小字号字重的视觉表现，不宣称已经从原生渲染器内部证明所有可能裁切原因，也不以截图代替用户最终观感验收。

## 验证

- `pnpm typecheck` 通过。
- `pnpm exec vitest run tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx`：8项通过。纯样式调整未新增复述CSS实现的单元测试，未重跑无关原生/API测试。
- `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh` 通过；既有构建警告保留。测试/构建使用包含既有未提交改动的工作树，不声明独立干净提交覆盖其他任务。
- Safari WebKit检查真实卡片与参考文字；内嵌浏览器600px窗口检查长中文/英文混合标题，各组标题边界均在卡片内，深色主题 document.scrollWidth 未超过视口。窄窗口检查属于隔离组件验证，不冒充原生跨平台验收。
- 21:01:08完成最新macOS预览产物，确认无未保存表单后退出旧进程、按完整 `.app` 路径重启；实际客户端账户恢复并切入Codex列表，截图确认新字形已加载。没有修改供应商数据、启用配置或调用模型。
- `git diff --check` 通过。原生窄窗口及Windows/Linux字体回退未实测，用户观感验收待完成。仅本地提交/预览，无push/PR/部署。

## 证据与回退

- [用户原截图](provider-title-evidence/reported-before.png)
- [最终原生标题裁图](provider-title-evidence/native-after.png)
- [WebKit真实组件对照](provider-title-evidence/webkit-variants.png)
- [600px长名称深色对照](provider-title-evidence/narrow-dark.png)

截图中的字体对照均为合成界面；最终原生裁图仅保留标题，不含Key。可独立revert标题提交及文档，无接口、数据库或迁移影响，不恢复/删除用户工具配置。
