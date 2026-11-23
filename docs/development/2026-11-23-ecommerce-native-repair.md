# ECOM-NATIVE-1123：本地桌面构建与电商生成等待修复

日期：2026-11-23（上海）。分支 `codex/ecommerce-desktop-integration`，起始 HEAD `2f82a999`。用户已授权本地修复、构建及真实付费测试；无 push、PR、发布授权。账户契约 `system-token-v1` 不变，无持久化字段或数据库迁移。

## 根因与修复

- 默认 `pnpm build` 按正式配置生成 updater 产物，要求对应现有公钥的私钥。本机缺少该环境变量不代表应用编译失败，但整条正式构建会失败。新增 `pnpm build:local`，复用独立 acceptance 身份及 `isolated-profile`（真实原生传输，不是 mock），明确关闭本地测试包的更新产物；不改正式公钥、正式构建或下载渠道。macOS acceptance 配置使用 ad-hoc 签名封装完整资源，不冒充 Apple 开发者签名/公证。
- 图片进度原来仅在开始设置 8%、完成设置 100%，中间没有真实进度来源；所以停留 8% 不能证明原生桥或供应商故障。改为准备素材、等待模型返回及经过秒数；配置行由“已连接”改为“已配置”。视频仅显示已有轮询进度。
- 图片增加完整操作 15 分钟上限、停止等待、卸载中止及迟到结果隔离；取消信号传给同步图片适配器、Google 图片和异步图片轮询。已提交任务可能仍在服务端执行，不宣称退款或服务端取消，也不自动重新提交。
- 优先沿用当前模型供应商的凭证或账户绑定，避免账户页另一个 Key 覆盖创作配置。缺少凭证时才绑定明确选择的 Key；浏览器上的账户引用提前明确提示需桌面原生连接，手动 API Key 的浏览器请求继续保留。

## 验证

- 创作定向 21 项通过：供应商凭证优先级、无原生桥边界、三种图片路由 signal、成功、失败、停止、超时、重复提交防护及迟到结果。
- 宿主账户桥接 42 项通过。`pnpm typecheck` 通过（宿主检查；创作源码另以定向测试和构建验证）。
- 最终 `pnpm build:local` 成功退出 0，产生独立 `.app` 和 `.dmg`；日志 `/tmp/tuzi-ecommerce-local-final-build-1123.log`。包含本轮最终业务代码，第一轮包不用于结论。
- 最终应用 `codesign --verify --deep --strict` 通过，签名为 ad-hoc，资源已封装；DMG `hdiutil verify` 通过。没有生成 updater 签名，不是 Apple Developer ID / 公证包。
- 原生窗口实际 URL 为 `tauri://localhost`。通过现有账户选取用户指定的测试 Key（仅显示掩码），模型列表真实返回 537 项；保存配置后退出应用，启动最终包，配置与模型仍存在。
- 最终包中实际上传 1254×1254 陶瓷杯参考 PNG，A+/详情页选择 `gpt-image-2.5`，提交一次真实生成。观察“等待模型返回 · 41 秒”、按钮禁用及“停止等待”，随后出现“生成结果”“1 / 1”“插入画布”，生成按钮恢复；不是模拟响应，也不是单独 HTTP 脚本替代 UI。
- 已查看实际结果：米白杯主体、圆弧杯柄和釉面与参考相符，形成暖色主视觉＋材质/杯柄局部＋早餐场景布局，标题 `EVERYDAY CERAMIC` 正确。未证明所有模型或所有工具达到同等效果；没有执行本次结果的插入画布/导出/重启恢复。
- 文件选择器对 `/tmp` 中原图未放行；复制到本任务的 Documents 素材目录后正常选择并上传。不把该自动化/文件位置问题归因为生成接口故障。

## 最终本机产物

- 应用：`src-tauri/target/release/bundle/macos/Tuzi Assistant Test.app`（ARM64），ID `com.tuziswitch.desktop.acceptance`。
- 独立交付包：`/Users/sdy09/Documents/tuzi-switch-artifacts/ecommerce-native-20261123/Tuzi-Assistant-Test-1.6.3-mac-arm64.dmg`。
- DMG SHA-256：`fd83b9bc1de212ca975db69afad2a3b749ebe64f187c07b5e21836ba3aa7c3c5`。
- 应用可执行文件 SHA-256：`cba49ac2decc6bbe6643545e6c9d760aa772cd9ad5264f8c3dcd22da059cb41a`。
- 参考素材另存于同一交付目录 `reference.png`；测试应用留在实际生成结果页供用户查看。未覆盖正式安装，未发布。

## 本机复现

```sh
pnpm build:local
```

默认正式构建仍为 `pnpm build`；正式更新签名须在拥有匹配私钥的受保护构建环境执行。本地 acceptance 包使用独立账户/工具数据目录及应用标识；不会覆盖正式安装，也没有配置自动更新端点。

其他工具/模型、跨平台及正式自动更新不由这一次电商图片验证覆盖。配置来源回归不等于完整预设 UI 的所有组合验收；仍需后续独立覆盖。
