# ECOM-SLIDESHOW-REMOVE-1124：撤销图片自动播放

用户反馈“看着怪怪的，不要了吧”，撤销新增的自动播放按钮、计时器及切换动画，恢复手动上一张、下一张、缩略图和插入画布。无持久化字段或接口变化。

- 本地 `git revert 180c6a00`，回退提交 `69d0696a`。创作目录与添加前的 `9107299c` 完全一致，保留参考图上传和官方 MCP 改进。
- 三个定向测试文件共 22 项通过：`pnpm --dir packages/creative-workspace exec vitest run tests/ecommerce-workbench-lifecycle.test.ts tests/ecommerce-workbench-config.test.ts tests/ecommerce-jobs.test.ts`。原有 IndexedDB/React 测试环境警告仍存在，无失败。
- 本次未重新构建；恢复此前已验证的 `9107299c` 本地包至 `/Applications/Tuzi Assistant Test.app`，恢复前后签名完整性校验通过。主程序 SHA-256：`4221916353e98d530ac0baac8fc9323cbce8f44ea2d645053754562232abf094`。
- 含轮播的原安装应用可从 `/Users/sdy09/.Trash/Tuzi Assistant Test-rejected-slideshow-20261124.app` 恢复。未清理用户数据，原商品两张、服装三张结果和模型选择均恢复显示。
- 原生窗口确认自动播放按钮消失；服装图手动从 1/3 切至 2/3、再返回 1/3，缩略图选中状态同步。
- `src-tauri/target/release/bundle` 内上次构建的应用和 DMG 仍含轮播，不能作为本次回退包分发。用户使用 `/Applications` 下已恢复的应用。
- 仅本地回退与验收，无付费生成、推送、PR、发布或下载页更新；既有发布门禁不变。
