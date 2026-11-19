# UC-BETA2-RUNTIME-1117：签名运行时修复与品牌图标

最终状态（2026-11-18）：beta.2 已安装、测试版已发布、原下载页已更新。以下过程状态以文末最终交付为准。

用户在 beta.1 报告 Claude 页面“内置运行组件缺失”，并明确要求修复。继续已有测试发布授权：仅测试库与原测试下载页，五平台同 SHA 构建成功后发布 beta.2，不改正式库或正式更新通道。用户随后要求兔小店用其图一，直连站用图二的红色兔子。

## 根因与修复

已下载的公开 Mac ARM DMG 摘要与发布记录一致；最终包的 Node 虽可执行 `--version`，运行脚本却以 SIGTRAP / CodeRange 分配失败退出。Tauri ad-hoc 重签名保留 hardened runtime，但丢失 Node 所需 JIT entitlement。已安装验收版与公开包 Node 摘要相同，故不是用户误装或文件缺失。

构建配置为 Mac 显式附加仅含 `com.apple.security.cs.allow-jit` 的 plist，保留 hardened runtime。使用最终安装包提取的 Node 实际执行脚本、动态函数、loopback HTTP fetch 与 WebSocket 握手；Mac 同时核对签名和 JIT entitlement，Windows 解包 NSIS，Linux 解包 DEB。发布门禁必须具备 packaged-node-script-executed，Mac 还需 node-jit-entitlement，拒绝旧的仅版本号检查证明。界面提示改为“缺失或无法启动”，避免把所有失败都说成文件缺失。

隔离真实回归：复制旧 beta.1 的 Node，旧签名被实际脚本探针拒绝；使用新 plist 重签名后，脚本/fetch/WebSocket 与签名检查通过。未修改用户已安装应用、证书信任或数据。证据见 attachments/beta2-runtime-1117/jit-regression.json。

## 图标

图一原图存为 src/assets/tuzi-shop.png；图二原图存为 src/assets/tuzi-direct-rabbit.png，以界面颜色滤镜显示红色，保持原图轮廓与 alpha。图像编辑工具未返回可用文件，因此使用界面颜色变换，没有改用付费 API 或重新绘制。侧栏截图见 attachments/beta2-runtime-1117/sidebar-icons.jpg。入口顺序仍为 opentu 创作、直连站、兔小店。

## 验证与交付状态

18 项打包脚本测试、3 项发布门禁测试（包含旧检查标志拒绝）、类型检查、25 项相关前端测试和 19 项下载页测试通过。隔离真实签名回归通过。新版本号为 1.6.3-beta.2；完整五平台构建和最终包验收进行中，尚未发布新版本。旧 beta.1 的五平台构建记录保留，但其 Mac 运行时不能据此认定可用。

云端构建：`44064540204`，源码 `5dd5d97600687af0fe30b91f09514e1da3fb342b`，verify 已成功，五平台安装包任务进行中。旧 beta.1 发布说明已添加 Mac 运行时故障提示，未修改旧附件或 tag。

云端 verify 全量结果：899 项宿主、2950 项创作全部通过；两个 Linux 安装包已成功，并通过新增包内脚本/fetch/WebSocket 检查。Mac ARM job 133977248676 因 GitHub 托管 runner 容量不足、15 分钟未取得机器被取消，未编译。平台注记为 `The job was not acquired by Runner of type hosted even after multiple attempts`；其他任务继续，结束后按原源码重试取消任务。

Windows x64 安装包已构建成功，NSIS 解包后的 Node 实际脚本/fetch/WebSocket 门禁通过。Mac Intel 原生集成测试通过，安装包仍在构建。安装前再次只读核实正式应用为 1.6.2、独立验收版为 beta.1；原生界面显示未启动、兔子coding 线路及 25 个模型，仍存在旧运行组件错误。尚未安装新包或切换下载页。

## 五平台成功与本机安装

构建 44064540204 attempt 2 全部成功。首轮 Mac ARM 未取得 runner，被单独重试；其余四平台成功产物保留，同一源码 5dd5d976。五个最终安装包均通过实际 Node 脚本/fetch/WebSocket，Mac 双架构还通过 JIT entitlement 与深度签名检查。结果见 attachments/beta2-runtime-1117/build-result.json。

Mac ARM artifact 14325843019 已分段下载，完整 ZIP 与 GitHub artifact digest 一致；DMG SHA256 为 612f11679139401f51f8573bb40cd46881b393114f2357e11b7535fa0a5d745c。本机只读挂载验证 beta.2、独立身份、深度签名、JIT 和真实脚本/fetch/WebSocket 全部通过，见 local-package-check.json。

已正常退出旧验收版，备份旧 app、SQLite 数据库及 settings 后安装云端 beta.2 到 /Applications/OpenTu 验收版.app，正式兔子助手主程序 SHA256 保持不变，未覆盖数据或新增证书权限。备份及安装证据见 install.json。已启动新包，但 macOS 当前锁屏，CUA 窗口读取失败且 System Events 显示 0 窗口；已请求用户解锁。最终界面复核仍待完成，因此测试 Release 和原下载页尚未切换。

## 解锁后界面复核（2026-11-18）

用户解锁后，重新激活已安装 beta.2，原生界面已确认：直连站红兔子、兔小店原图显示，顺序位于 opentu 创作后；Claude 页显示“准备就绪”，启动按钮可用，旧组件错误消失；原“兔子coding”线路及 25 个模型保留。截图与辅助功能记录见 installed-beta2-ready.jpg / installed-beta2-ready.txt。未发起模型调用，也未据此宣称 Claude 全部业务或跨平台实机验收通过。按既有授权继续发布测试 prerelease，并沿用原测试下载页。

## 最终测试交付（2026-11-18）

- 五平台构建 44064540204 / 源码 5dd5d97600687af0fe30b91f09514e1da3fb342b 成功；Mac ARM 安装与运行时实测、解锁后界面复核通过。
- 发布 44213080095 成功，测试 prerelease `opentu-preview-v1.6.3-beta.2` / Release ID 449389544；八个附件（五安装包、对应源码、摘要、构建清单）摘要均匹配。测试 Latest 保持 v1.5.4。
- 原测试下载页 https://aiw520.github.io/tuzi-switch/ 已切换 beta.2，部署 44213408165 成功，页面来源 fee095625de7f152e3178a6c5060f0ee4578bf17。五种系统/芯片组合逐项选择，全部指向正确 beta.2 文件；五公网安装包 HTTP 200、长度正确，页面图片均已加载。
- 原 beta.1 发布说明已提示下载 beta.2 修复包，未改旧附件或标签。正式 Latest v1.6.2、正式页面 index 与 release.json 的摘要和之前一致。
- 首次发布 44212721142 在创建草稿后列表未及时包含新草稿而中断，未公开半成品。已改用创建响应返回的草稿 ID，增加过时列表回归；4 项发布脚本测试通过，从原草稿继续完成发布。安装包无需重建。
- 发布前 19 项下载页测试及真实 Release/标签/源码/五安装包校验通过。证据：publication.json、build-manifest.json、SHA256SUMS、public-downloads.json、page-platform-links.json、final-publication-check.json、published-beta2-page.jpg。

此轮验收范围是签名运行时故障、图标、安装保留、五平台打包与测试下载交付。未新增付费模型调用，不把按钮恢复可用、编译或探针结果认定为 Claude Chat/Cowork/电脑控制/语音/ChatGPT 客户端完整联调及跨平台实机全部通过。仍待用户测试，不发布正式版。
