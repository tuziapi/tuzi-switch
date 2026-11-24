# ECOM-REF-UPLOAD-1124：预览区参考图片上传

用户指出产品精修预览左侧“上传 1–3 张商品原图”应支持选图。沿用 `codex/ecommerce-desktop-integration`，基线 `54eeef3c`；本轮仅本地实现、验证与测试应用更新，不推送、PR 或发布。

## 实现

- 原占位 `div` 改为可键盘操作的上传按钮，与右侧按钮共用一个文件输入和 `files` 状态。商品、服装及视频工作台的图片入口同时生效；参考视频保持原独立入口。
- 选图后立即显示缩略图；不足三张继续显示“添加参考图片”。两处上传均追加，已有图片不被覆盖；同名、大小、类型和修改时间相同的文件不重复添加。
- 限制三张，超出明确提示，不接受非图片。取消选择保留已有图片；重置文件输入，允许删除后再次选择同一文件；满额后右侧提示先移除左侧图片。
- 商品原图和参考图片共用既有图片参考语义，不新增独立风格参考角色、模型能力或持久化字段。图片通过 `references` 交给既有任务和执行器；视频的图片参考仍受所选模型能力限制。

## 验证

- 定向四文件 30 项测试通过：页面生命周期、图片执行器、请求、生成适配。新增场景覆盖两入口、分次追加、去重、取消、超额、非图片、移除重选，以及最终所选文件传到各张生成任务；执行器使用真实 FileReader 验证参考图片转换为 data URL 传给模型适配器。
- `pnpm typecheck` 和 `git diff --check` 通过。测试中的现有 IndexedDB 缺失和 React act 警告仍存在，无测试失败。
- `pnpm build:local` 完整通过，日志 `/tmp/tuzi-reference-upload-build-1124.log`。产物及已安装应用均通过 `codesign --verify --deep --strict`。
- 已安装 Mac ARM 测试版原生验收通过：在产品精修点击左侧入口打开系统文件窗口，双击导入既有杯子参考图；左侧追加第二张，右侧追加第三张，数量和缩略图同步更新。满三张隐藏左侧添加按钮、禁用右侧添加；移除第三张后恢复两处添加入口。未点击生成。系统路径输入和 Open 按钮自动化曾未完成选择，改为文件列表双击后通过；重选同一文件、取消、去重和超额由组件测试覆盖，未冒充全部原生实测。
- 本轮不新增付费生成；上传交互与合成传参验证不等于供应商效果验收。既有发布门禁保持未通过，见 [验收记录](2026-11-23-ecommerce-release-gates.md)。

## 本机交付

- 已更新并打开 `/Applications/Tuzi Assistant Test.app`，测试身份仍为 `com.tuziswitch.desktop.acceptance`，版本 1.6.3。已有项目、生成历史和模型配置可读取。
- 主程序 SHA-256：`3973a08b98f078e4290dcd7933e7e838cddccd89324ecb2241196e30661284cd`。
- DMG：`src-tauri/target/release/bundle/dmg/Tuzi Assistant Test_1.6.3_aarch64.dmg`；SHA-256：`334bac8eac5bda6ebce6a245cf21a75cac9c91c48fdcac128bcf7b86026a7899`。
- 旧测试应用正常退出后移至 `/Users/sdy09/.Trash/Tuzi Assistant Test-before-reference-upload-20261124.app`，可恢复，未清空废纸篓。
- Codex 配置摘要更新前后相同；不改变账户认证、MCP 权限或模型配置。本机包为 ad-hoc 测试包，未公证、未签正式 updater、未发布。
