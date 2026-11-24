# ECOM-SLIDESHOW-1124：生成图片自动播放

用户确认给预览区增加自动播放/暂停。在 `codex/ecommerce-desktop-integration`、基线 `9107299c` 上本地实现并验证；不推送、不发布，不新增模型调用。

## 行为

- 商品和服装共用图片预览；至少两张已生成图片时显示“自动播放”，默认关闭。
- 开启后每 4 秒切换到下一张，最后一张循环回第一张。按钮切换为“暂停播放”。新生成的结果纳入当前组的轮播，不额外生成图片。
- 鼠标悬停预览区暂停计时，移开后重新计时；按钮提示说明悬停行为。
- 手动上一张/下一张、选择结果缩略图、聚焦其他预览操作、插入画布均停止播放。播放按钮本身允许键盘启动/暂停。
- 切换工具或生成记录、页面卸载、窗口失焦/切到后台后停止；重新进入需手动开启。计时器和事件监听随页面清理。
- 单张图片和视频不显示图片轮播按钮。切图使用轻微淡入；系统减少动态效果时不播放淡入动画。窄窗口操作栏允许换行。
- 状态仅在组件内存保存，无新增持久化字段、接口、模型参数或账户变更。

## 验证与交付

- `pnpm --dir packages/creative-workspace exec vitest run tests/ecommerce-workbench-lifecycle.test.ts tests/ecommerce-workbench-config.test.ts tests/ecommerce-jobs.test.ts`：三文件 24 项通过，新增计时循环、悬停/手动暂停、缩略图选择、键盘焦点、后台/失焦及重新挂载覆盖；验证轮播不新增模型调用。原有 IndexedDB/React act 测试环境警告仍存在，无失败。
- `pnpm typecheck` 通过。
- `pnpm build:local` 通过；构建与安装应用的 `codesign --verify --deep --strict`、DMG 的 `hdiutil verify` 通过。沿用 1.6.3 本地 ad-hoc 测试身份，非正式发行签名/公证或 updater 发布。
- 已安装应用的 `tauri://localhost` 原生界面，使用用户已有三张服装图，实测从 3/3 自动循环至 1/3，继续切换时结果缩略图选中状态同步；悬停图片超过 5 秒保持 2/3，移开后恢复。点击“暂停播放”并移开鼠标，超过 5 秒仍保持 2/3，按钮恢复“自动播放”。最终界面截图确认按钮布局正常，停留服装组图页面供用户试用。
- 此轮未点击生成、未新增付费调用。单张隐藏、键盘焦点、后台与重挂载由组件测试覆盖，不冒充全平台原生验收。

## 本机产物与回退

- 最新应用：`/Applications/Tuzi Assistant Test.app`，主程序 SHA-256 `e20301f050b36a893d456ee704ceaa2053925357bce643d1424631f0d7aed6bc`，与构建产物一致。
- DMG：`src-tauri/target/release/bundle/dmg/Tuzi Assistant Test_1.6.3_aarch64.dmg`，SHA-256 `0f88420a9cfd425edb2eeb2c750f8584227500548697e6ccb749ad524134a76e`。
- 旧应用正常退出后移动至 `/Users/sdy09/.Trash/Tuzi Assistant Test-before-slideshow-20261124.app`；可恢复，未清空废纸篓。全部项目、历史图片及配置保留。
- 本轮仅本地交付，无推送、PR、发布或下载页更新；此前官方 MCP 生产授权、视频及整体上线门禁不因此改变。
