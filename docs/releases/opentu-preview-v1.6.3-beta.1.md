兔子助手 / OpenTu `1.6.3-beta.1` 公开测试版。先使用独立验收版测试，确认后再考虑正式上线。

- 整合画布原位生成、结果恢复、继续编辑、视频文件操作与讨论改进。
- 整合 Claude 本地兼容、统一模型配置、Code 对话与文件任务，以及 ChatGPT MCP 配对入口。
- 提供 macOS Apple Silicon / Intel、Windows x64、Linux x64 / ARM64（DEB）五种安装包。Windows ARM64 暂不提供。

应用名为「OpenTu 验收版」（Linux 为 OpenTu Preview），使用独立配置与数据目录，手动安装与更新。已有正式版配置和凭证不会自动迁移。

五平台构建及包检查通过不代表全部功能实机验收。前一整合候选的 Mac Code 多轮、文件读写和 Sonnet→Haiku 切换已实测；普通 Chat/Cowork 的 VM 初始化、电脑控制、语音、ChatGPT 客户端完整联调和跨平台实机仍需继续测试。Claude VM 官方压缩下载约 1.25 GB，初始化阶段曾要求至少 16.1 GB 可用空间。模型调用使用自行配置的线路，可能计费。

Mac 使用 ad-hoc 签名，未经 Apple 开发者签名或公证；Windows 未做 Authenticode 签名。安装请确认来源并按系统提示操作。

附件提供 SHA256SUMS、构建清单及对应源码。反馈请附系统、架构、版本与复现步骤，不要提交 Key、配对令牌或个人会话内容。本轮改动尚未发布正式版。
