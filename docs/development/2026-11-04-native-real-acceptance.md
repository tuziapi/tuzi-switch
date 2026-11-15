# UC-NATIVE-REAL-01：真实 macOS 客户端验收

日期：2026-11-04。用户要求实际运行验证，不以浏览器模拟接口测试代替。代码基线 `a8aabb09f962f6c2d395d4aabc282ddd8b865602`，本轮没有修改业务代码、推送或发布。

## 运行环境与隔离

重新执行：

```sh
PATH=/Users/sdy09/.rustup/toolchains/1.95-aarch64-apple-darwin/bin:$PATH NODE_OPTIONS=--max-old-space-size=4096 pnpm tauri build --debug --features isolated-profile --bundles app --config src-tauri/tauri.acceptance.conf.json
```

构建成功，日志 `/tmp/tuzi-native-real-20261104-build.log`。应用位于 `src-tauri/target/debug/bundle/macos/Tuzi Assistant Test.app`，bundle ID 为 `com.tuziswitch.desktop.acceptance`，窗口标题“兔子助手 · 集成测试”，实际页面 `tauri://localhost`。没有使用 5197 的 mockIPC 页面，没有启用 `local-preview` 合成 HTTP 特性；账户地址为 `https://api.tu-zi.com`。

二进制 SHA-256：`7a142f9cf3fe14b90e406d60e09af5f02dd08810f843500aa827161667f4c343`。使用独立 profile，不关闭或替换 `/Volumes/兔子助手/兔子助手.app`。测试进程由 PID 20632 正常退出，重启为 PID 24573；原 DMG 进程 PID 71862 保持运行。

## 本轮实际通过

全部通过真实客户端界面和原生操作执行，未直接调用测试桩完成动作。

| 检查 | 实际结果 |
|---|---|
| 进入 opentu | 助手侧栏收起，项目页和自由画布加载 |
| 原生文件选择器导入 | 选取仓库 `src-tauri/icons/128x128.png`，画布显示蓝兔图 |
| 图片右键 | 五项菜单显示；没有提示词的导入图禁用“复制提示词” |
| 自动副本与 Finder | 点击“显示图片文件”，Finder 实际选中隔离 Pictures/兔子助手 下的 PNG |
| 另存为取消 | 实际 macOS Save 面板取消后返回画布，没有“保存成功”提示 |
| 另存为成功 | 保存到 `/tmp/tuzi-native-acceptance-20261104.png`，客户端显示“图片已保存” |
| 导出保真 | 另存为文件和自动副本均为 13,991 字节，与导入文件逐字节一致 |
| 系统剪贴板跨应用 | 原生复制后使用 Chrome 原生 Cmd+V，实际 paste 事件得到 128×128 PNG（16,021 字节），不是文本或链接 |
| 原图预览 | 原生窗口中实际显示蓝兔图片，保存截图 |
| 正常退出/重启恢复 | 重启后“我的画板1”及导入图片仍存在，右键菜单可用 |
| 副本复用 | 重启后再次定位同一原图，该内容哈希对应副本数量仍为 1 |
| Codex 新供应商保存 | 通过表单新增“NATIVE 验收供应商（合成）”，页面提示“供应商已添加”；只使用合成 Key 和 `.invalid` 端点，未启用或调用模型 |
| 实际数据库检查 | 隔离库只读查询测试供应商计数 1，`PRAGMA foreign_key_check` 返回 0 条 |

原图与两个导出文件 SHA-256：`57cfcd344d297a4ea622d327234da6be7a587ef1d42cec7630b141fd05239ed3`。

## 证据与验收过程限制

截图及界面树在 `/tmp/tuzi-native-acceptance-evidence/`：`preview.png`、`restart-menu.png`、`restart-menu-ax.txt`、`provider-save.png`、`provider-save-ax.txt`。

macOS ScreenCaptureKit 在窗口切换时多次返回 -3811/-3812，重新取得明确的测试应用句柄后可继续，并成功取得完整原生截图。系统预览应用的自动化未成功，因此跨应用粘贴改用本机 Chrome 的实际原生键盘，不使用浏览器虚拟剪贴板。Chrome 验收标签页及 5207 临时服务已关闭。

跨应用粘贴证明 PNG 类型及尺寸成功，不声称像素逐字节相同：浏览器解码 RGBA 哈希与 PIL 原始解码不一致，后续同解码器比对受窗口焦点变更影响未完成。另存为与 Finder 副本已独立确认原始编码字节完全相同。首轮无效的剪贴板操作及屏幕捕获失败不计为通过。

原生安全输入框的 AX setValue 没有填入合成 Key；客户端正确提示缺少 Key。改用正常点击和键盘输入后保存成功，不将自动化输入方式失败当作产品缺陷。

## 尚待真实账户与生成验收

用户同意在隔离客户端自行配置测试账户/Key，并允许最多一次 `gpt-image-2` 生图，费用上限尚待补充。本轮截至记录时没有连接真实账户或发起付费生成，不读取或复制日常客户端的真实凭证。

账户配置及费用范围明确后，仍需从实际客户端完成：账户连接/模型配置 → 单次生成 → 任务完成 → 画布实际渲染 → 导出/重启恢复。导入图正常不等于真实生成链已通过；不能据本轮结果宣称“没有任何问题”或全部上线门禁通过。

Windows/Linux、正在生成时退出保护、旧数据迁移、批量及音视频原生导出等既有未完成项仍见上线验收报告。本轮没有重新执行自动化全套来替代上述实测，也没有更新公开安装包。
