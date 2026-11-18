# UC-BETA2-REAL-1118：已发布安装包真实验收

> 最终状态（2026-11-18）：beta.3 五平台测试版、原下载页更新与本机 Mac ARM 安装复验已完成。下文保留过程；构建中/未发布仅表示当时状态，当前交付见文末。

2026-11-18，继续用户已授权的独立 OpenTu 验收版测试。目标为测试库公开 beta.2，安装包源码 `5dd5d97600687af0fe30b91f09514e1da3fb342b`。没有把旧 Debug 包的结果当成本次结果，也没有修改正式应用或发布正式版。

## 本次真实结果

- 使用验收版已有“兔子coding”线路，当前默认 `gpt-6.1-sol`。启动官方 Claude 5.11492.5 私有副本成功，宿主显示客户端已连接；未新增证书信任或系统权限。
- 从对话入口提交合成短提示，真实返回 `TUZI-BETA2-1118-OK`；第二轮正确取回前文标记并返回 `CONTEXT-OK`。实际会话为本地 Cowork 路由，此结果只证明对话文本，不等于 Cowork 文件、电脑控制或语音验收。
- Code 在已授权的 `Documents/Tuzi-Acceptance-1117` 中创建 `beta2-1118-result.txt`，只允许一次检查过的命令；模型读回内容，独立核对文件为 `TUZI-BETA2-FILE-OK\n`。不读取用户其他文件。
- 五笔本次推理记录实际路由均为 `gpt-6.1-sol`，请求别名 `claude-gpt-6.1-sol`，均 HTTP 200 / 流式。这是实际配置线路结果，不是假定其仍为旧 Sonnet 线路。
- 正常退出 Claude、停止兼容服务，退出宿主并确认进程消失。重启宿主/Claude 后，Code 文件任务及对话两轮内容均恢复。
- OpenTu 原两个项目保留，合成项目 `SYNTHETIC OpenTu sync 1117` 的图片、参考图及生成草稿在冷启动后恢复。未提交生成请求，不重复用户已验收的图片拆分。
- 正式兔子助手仍为 1.6.2，主程序 SHA256 与此前相同。

结构化记录及截图见 `attachments/beta2-real-1118/`。只保存合成会话和选定脱敏请求字段，不保存 Key、完整日志或用户业务数据。CUA 曾报 ScreenCaptureKit 参数错误；使用已有授权的 AppleScript 激活/调整验收窗口后恢复。Code AX 点击未执行，按截图坐标点击后才确认成功，不将失败点击计作完成。

## 实测发现的更新通道错误与 beta.3 修复

beta.2 在宿主和画布左上角提示 `test-f86531a4 (#15)`。未点击下载。原生将所有 `isolated-profile` 都声明为旧 acceptance 通道，导致独立预览版比较另一工作流的运行序号，违反已约定的“测试版暂不自动更新”。

修复让 `opentu-preview` 返回专有 `preview` 通道，检查直接返回 disabled，不访问旧验收或正式更新源；手动检查说明从原测试下载页安装，不误报“已是最新”。设置里的更新日志指向原测试下载页，显示实际 beta 版本。旧 acceptance 和正式 stable 通道保持原有流程。

跨端改动：原生 channel 和 TypeScript 联合类型同步；检查返回 disabled，Context 的 null 结果由唯一手动调用方 AboutSection 明确处理；三种语言提示补齐；无数据库字段或迁移。补齐 Linux ARM64 平台标识，并将原生通道测试纳入五平台现有 local_ 筛选。

本地 41 项定向回归、类型检查、18 项打包脚本和 4 项发布脚本测试通过。新增 About 测试首轮因夹具未提供构建常量失败，补齐夹具后通过，未将首轮失败算作通过。准备 beta.3 五平台新构建；不覆盖 beta.2 已发布附件，原下载页须待全部产物验证后再切换。

## Cowork 文件任务追加验收

在同一个 beta.2 包中，从 Cowork 入口通过原生目录窗口选择已授权的合成测试目录，仅允许本次会话。真实读取 `beta2-1118-result.txt`，新建 `beta2-cowork-1118.txt` 并读回；独立文件核验为 `TUZI-BETA2-FILE-OK\nCOWORK-FILE-OK\n`。相关七笔流式推理均为 gpt-6.1-sol / HTTP 200。结果见 cowork-file.png / .txt 与 real-acceptance.json 的 cowork 节。

此追加验收证明目录选择、授权及 Cowork 文件读写；没有扩展到用户其他目录，也未将目录授权设为“始终允许”。Cowork 文件任务的升级后恢复将在新包检查，不能用已有 Code 的重启结果替代。

beta.3 构建 `44216753049`，固定源码 `be5bd7bb2f61cdc289504837bbacc181a24b3d3a`；云端 verify 已通过，宿主 907 项、创作 2950 项全部通过，五平台原生构建进行中。下载页暂保持 beta.2，未发布 beta.3。

正式门槛仍未完成：电脑控制、麦克风 UI、目标 ChatGPT MCP 全链路、其他平台实机及正式身份签名升级。此次对话/Code/Cowork/恢复通过不能替代这些项目。

## beta.3 本机新包复验

同一构建的 Mac ARM artifact 14390897159 全部 ZIP SHA256 与 GitHub digest 一致；DMG 摘要 a80ebea13f6c14f4e1914231021f84640e9217ae8f59c96ebefac232080fb0d0。只读挂载后验证独立身份、版本、深度签名、Node JIT 及真实脚本/fetch/WebSocket，通过后安装。旧 app、SQLite 一致备份和 settings 存于 `~/Library/Application Support/Tuzi Local Backups/beta3-install-20261118-101930`；正式应用摘要保持不变。

实际新包显示 v1.6.3-beta.3；手动检查提示独立验收版应从原测试页安装，没有旧 test-f86531a4 更新提醒。原两个项目及带参考图草稿保留。Claude 再次启动，Cowork 文件任务完整恢复；在恢复会话里发送合成升级后检查，真实返回 TUZI-BETA3-UPGRADE-OK，网关实际 gpt-6.1-sol / HTTP 200。证据见 `attachments/beta3-channel-1118/`。未复测拆分/OCR，未发布正式版。

## beta.3 测试发布与最终交付

- 构建 `44216753049` 成功，安装包源码固定为 `be5bd7bb2f61cdc289504837bbacc181a24b3d3a`。Mac ARM64/Intel、Windows x64、Linux x64/ARM64 五包原生回归与包内运行检查通过；Mac 双架构还完成 JIT entitlement 和签名完整性检查。云端宿主 907 项、创作 2950 项及下载页 19 项通过。
- 发布 `44223976786` 成功，流程源码 `a288aff1e6e1bd607be9082a0f5c6a0135933d51`；测试 Release `opentu-preview-v1.6.3-beta.3` / ID `449450876` 为 prerelease，没有替换 Latest。八附件（五安装包、源码、摘要、构建清单）与构建摘要匹配。
- 原测试下载页 https://aiw520.github.io/tuzi-switch/ 继续使用。部署 `44224244282` 成功，页面源码 `e06e2bfd2f6366ee4c75bd52ed47a5cb62ac8c82`，与安装包源码分开记录。公网五附件 HTTP 200、长度匹配；浏览器实际切换每个系统和架构，五项按钮均指向 beta.3 对应文件。见 `page-platform-links.json`、`public-downloads.json` 与 `download-page.jpg`。
- beta.2 发布说明补充引导至已发布 beta.3；未覆盖旧 tag 或附件。正式仓库未推送，正式 Latest 保持 `v1.6.2`，正式页面 HTML / release.json 摘要与前次一致。
- 本机安装的是本次 Mac ARM 云端包。对话两轮、Code/Cowork 文件读写在 beta.2 完成；beta.3 实测范围为更新通道修复、项目/草稿/历史恢复和升级后真实模型回复，不将旧包文件测试写成新包全量重测。

剩余正式门禁：电脑控制、麦克风 UI、目标独立 ChatGPT MCP 全链路、其他平台实机、正式身份签名升级及用户最终验收。五平台构建通过不等于五平台完整实机通过。本轮只交付测试版。
