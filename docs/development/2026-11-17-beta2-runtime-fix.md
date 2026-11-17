# UC-BETA2-RUNTIME-1117：签名运行时修复与品牌图标

用户在 beta.1 报告 Claude 页面“内置运行组件缺失”，并明确要求修复。继续已有测试发布授权：仅测试库与原测试下载页，五平台同 SHA 构建成功后发布 beta.2，不改正式库或正式更新通道。用户随后要求兔小店用其图一，直连站用图二的红色兔子。

## 根因与修复

已下载的公开 Mac ARM DMG 摘要与发布记录一致；最终包的 Node 虽可执行 `--version`，运行脚本却以 SIGTRAP / CodeRange 分配失败退出。Tauri ad-hoc 重签名保留 hardened runtime，但丢失 Node 所需 JIT entitlement。已安装验收版与公开包 Node 摘要相同，故不是用户误装或文件缺失。

构建配置为 Mac 显式附加仅含 `com.apple.security.cs.allow-jit` 的 plist，保留 hardened runtime。使用最终安装包提取的 Node 实际执行脚本、动态函数、loopback HTTP fetch 与 WebSocket 握手；Mac 同时核对签名和 JIT entitlement，Windows 解包 NSIS，Linux 解包 DEB。发布门禁必须具备 packaged-node-script-executed，Mac 还需 node-jit-entitlement，拒绝旧的仅版本号检查证明。界面提示改为“缺失或无法启动”，避免把所有失败都说成文件缺失。

隔离真实回归：复制旧 beta.1 的 Node，旧签名被实际脚本探针拒绝；使用新 plist 重签名后，脚本/fetch/WebSocket 与签名检查通过。未修改用户已安装应用、证书信任或数据。证据见 attachments/beta2-runtime-1117/jit-regression.json。

## 图标

图一原图存为 src/assets/tuzi-shop.png；图二原图存为 src/assets/tuzi-direct-rabbit.png，以界面颜色滤镜显示红色，保持原图轮廓与 alpha。图像编辑工具未返回可用文件，因此使用界面颜色变换，没有改用付费 API 或重新绘制。侧栏截图见 attachments/beta2-runtime-1117/sidebar-icons.jpg。入口顺序仍为 opentu 创作、直连站、兔小店。

## 验证与交付状态

18 项打包脚本测试、3 项发布门禁测试（包含旧检查标志拒绝）、类型检查、25 项相关前端测试和 19 项下载页测试通过。隔离真实签名回归通过。新版本号为 1.6.3-beta.2；完整五平台构建和最终包验收进行中，尚未发布新版本。旧 beta.1 的五平台构建记录保留，但其 Mac 运行时不能据此认定可用。
