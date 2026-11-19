兔子助手 / OpenTu `1.6.3-beta.2` 公开测试版。

- 修复 Mac 安装包签名丢失 Node JIT 权限，导致 Claude 页面提示“内置运行组件缺失”的问题。
- 侧栏在 opentu 创作后新增“直连站”和“兔小店”，点击在默认浏览器打开，并使用用户指定的兔小店图标和红色兔子图标。
- 从最终安装包解包后实际验证 Node 脚本、HTTP fetch 与 WebSocket，不再仅以 `--version` 判断运行正常。

提供 Mac Apple Silicon / Intel、Windows x64、Linux x64 / ARM64 五种独立验收安装包。安装后为“OpenTu 验收版”（Linux 为 OpenTu Preview），可替换旧验收版，保留正式兔子助手。配置与数据独立，测试版暂不自动更新。

Mac 为 ad-hoc 签名，未做 Apple 开发者签名或公证；Windows 未做 Authenticode 签名。Chat/Cowork VM、电脑控制、语音、目标 ChatGPT 客户端完整联调及跨平台完整实机功能仍需继续验收，不代表正式版已放行。

附件包含 SHA256SUMS、构建清单及对应源码；反馈请附版本、系统与复现步骤，不要提交密钥或个人会话内容。
