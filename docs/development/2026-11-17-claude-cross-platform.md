# CL-LOCAL-PLATFORM-01：Claude 本地兼容跨平台适配

2026-11-17。用户最新要求为“全部适配好先”，覆盖此前“首版只验收 Mac ARM”的开发范围。**当前仍未满足全平台验收或发布条件。** 本文记录可审查的源码改动和测试方式，不把生成运行时、单元测试或候选构建等同于实机验收。

## 已确认的范围

| 平台 | 架构 | 客户端策略 | 功能范围与状态 |
|---|---|---|---|
| macOS | ARM64、x64 | 继续官方签名的固定版本私有副本 | 聊天、Code、汉化、语音、Cowork、电脑控制；只有 ARM 的部分旧候选流程有实测 |
| Windows | x64、ARM64 | 用户已选择：复用注册的官方 MSIX，使用独立数据目录，启动前严格校验版本和签名 | 同上；代码适配待原生编译、安装、权限及实际任务验收 |
| Linux | x64、ARM64 | 使用官方 Debian 包安装路径，隔离数据目录，启动前校验包版本及安装文件权限 | 用户已选择：聊天、Code、汉化、Cowork；官方暂不支持的听写和电脑控制明确禁用。待原生编译及实机验收 |

本轮固定 Claude 5.11492.5；Windows 只额外接受等价的 5.11492.5.0。拒绝其他版本、后缀版本，不自动放宽允许范围。Node 固定 24.22.3。

Windows 不再复制 MSIX 目录：官方说明 Cowork 的虚拟机后台服务依赖安装注册。Linux 官方包的 AppArmor 配置绑定 `/usr/lib/claude-desktop/claude-desktop`，直接复制可能破坏 Chromium 沙盒。两者保留官方安装位置，不修改系统更新策略；官方更新后若版本不匹配，兼容启动停止，等待重新适配。Mac 继续原有副本策略。

## 本轮源码变化

- 六架构 Node 下载均固定官方 SHA-256，限制解包大小，拒绝重复成员和链接，校验 Mach-O / PE / ELF 架构。来源记录区分本机执行与异架构静态检查。Windows 下载文件先关闭句柄再重命名。
- 候选构建使用各目标独立的 sidecar、许可证和 provenance，防止资源混装；提供跨平台 Python 构建入口。安装包内只使用自带 Node，缺失就报错。
- Windows 校验注册包家族、包状态、版本及 EXE 的 Authenticode；保持包原位置和独立 profile。私有状态目录设置当前用户和 SYSTEM 的 ACL，语音收据不再错误地依赖 POSIX `0600` 位。
- Linux 接入官方安装目录、dpkg 版本检测、资源位置和当前用户进程检测；普通用户不能改写的系统安装文件才允许准备。该检查不等于验证所有包文件的签名或摘要，发行前仍须在官方安装包上验收。
- Linux 的显式证书操作覆盖 Electron 使用的 NSS 库与 VM 使用的系统根证书；通过系统 `pkexec` 授权，失败报错，不关闭 TLS。新旧 NSS 路径兼容；按证书指纹生成独立名称，移除时不删除内容不匹配的系统文件。授权中断可点击移除清理部分导入。
- 新增 `capabilities` 状态字段，Rust、TypeScript、三语言文案和界面测试同步补齐。Linux 不显示语音模型下载操作，也不能从 IPC 启用语音或电脑控制；旧配置中的开关不会绕过平台限制。
- 聊天支持 gzip、deflate、br 请求；损坏、未知编码及超限正文在调用模型前失败。历史接口补齐 REST / RPC 消息、改名及删除；策略限制和目录、激活任务响应使用新版所需结构。补齐 Windows 电脑控制开关的客户端门控，不代替系统权限。
- Mac 进程检测限当前用户；Windows 限当前会话；Linux 只读取当前用户、官方可执行路径对应的进程。

没有合并整个新上游模板。参考仓库已 fetch 到 `cd5e69a7b654f7191b0d96ae1ebc306929d9254e`，本轮按需求择取 `f057c161`、`a5d3fec`、`c7534d8`、`c0121fb`、`2d1b81a` 的相关修正，保留兔子网关绑定、严格模型、个人数据隔离和更新保护。

## 验证证据与限制

详见同目录 `attachments/claude-local-p0/cross-platform-2026-11-17.json`。本机宿主 866 项、核心 60 项、打包脚本 15 项通过；运行时及最终候选结果以该证据文件为准。没有重跑未改动的创作工作区全部测试；其上一轮 2823 项结果不算本轮新验证。

六份 Node 官方归档及架构已校验，只有 Mac ARM 做了实际运行探测。Linux 官方 amd64 Debian 包 SHA-256 为 `b96208b207e450b740f7dbe304f6077fed80e7f3d37ddd545991c4e8201564cf`，已下载并核对，用于确认安装位置和系统证书读取方式；没有安装到本机。

Mac 交叉检查 Linux 核心在编译 `ring` 的 C 依赖时被缺失的 Linux 工具链 / sysroot 阻断；不记录为 Linux 编译成功。Linux 证书模块另在 Mac 的核心测试构建中做 Rust 类型检查和指纹隔离测试，这不能代替 Linux 上的 NSS、pkexec、VM 验证。Windows 与 Linux 完整候选尚须对应系统生成。

Mac ARM 正常身份的未签名 Debug 候选已构建，版本 1.6.2，主程序 SHA-256 为 `669fdf618739487038f8adf4f37ab963f804ef0461a9cfc02a41c4146ea898b9`。ZIP 首次因磁盘不足失败，删除残件并仅清理本任务可重新生成的编译缓存后，重新打包及全部条目 CRC 校验通过；归档摘要见证据文件。初次打包时尚未安装或启动；后续本机安装见下文。本包不可作为自动更新包。

## 构建及环境采集

六平台校验和候选构建写入 `.github/workflows/claude-local-tests.yml`。在测试仓库 `AiW520/tuzi-switch` 中，推送 `codex/claude-local-p0` 分支将生成候选；也可在工作流可见后手动开启 `build_candidates`。产物标为 `UNSIGNED-TEST-ONLY`，不会创建 Release、上传更新清单或安装到机器。本轮未推送、未触发远端流程；需要用户授权该测试分支推送后才能生成其他系统的包。

本地需要 Python 3.9+、Node / pnpm 9、仓库固定的 Rust 1.95，以及 Tauri 的系统依赖。在目标操作系统运行：

```sh
pnpm install --frozen-lockfile
python3 scripts/build-claude-local-candidate.py
```

Windows 可用 `py -3` 代替 `python3`。Mac Intel 交叉构建可显式传 `--target x86_64-apple-darwin`；其他系统的安装包必须在对应操作系统构建。`--dry-run` 只输出计划。构建不安装、不启动、不改版本、不发布。

只读环境报告：

```sh
python3 scripts/qa/claude-local-platform-preflight.py --output claude-preflight.json
```

报告不读 API Key、不变更证书、不调用模型；`functionalAcceptance` 始终为 false。Linux 用户需安装官方 Debian 包、NSS 工具及系统授权组件。Cowork 按官方要求准备 KVM 权限、QEMU / virtiofsd、至少 8 GB 内存和约 25 GB 可用磁盘；Windows 需官方安装器完整安装、虚拟机平台和后台服务。

## 同一候选上的验收表

每个系统 / 架构单独保留包摘要、预检报告、客户端版本和结果。用专用测试目录和无敏感内容的测试窗口；API Key 在应用内输入，不写入报告。

| 流程 | 通过标准 |
|---|---|
| 安装、首次启动 | 包可安装和冷启动；旧兔子配置、正式 Claude 个人数据保持可读；默认不自动启动兼容模式 |
| 资源、版本、运行时 | 内置 Node 就绪；缺少 sidecar、客户端版本不匹配及错误签名均明确阻止启动 |
| 证书 | 取消授权后给出可恢复错误；确认后校验通过；停止后移除信任，原证书不受影响 |
| 供应商与普通聊天 | 真实回复、中文、多轮、附件、取消、错误提示、历史恢复；消费归属为 Claude Desktop |
| Code | 测试目录内读、写、修改；停止后重启恢复会话；模型和供应商不漂移 |
| 汉化 | 主页面、设置、功能入口及新开窗口文字、交互正常 |
| Cowork | VM 成功启动；完成指定测试目录任务；权限不足、空间不足、停止及重启均有明确结果 |
| 语音（Mac / Windows） | 真实麦克风授权、录音、转写、填入、取消和重试全部通过；服务转写成功不算 UI 通过 |
| 电脑控制（Mac / Windows） | 仅在授权后操作指定测试窗口，拒绝授权和停止均有效 |
| Linux 功能范围 | 听写和电脑控制显示不可用；无语音模型下载；其他支持项逐项通过 |
| 退出、更新及恢复 | 活跃会话阻止兔子更新；退出 Claude 后可停止和更新；异常退出有恢复入口；新 Claude 版本被版本门槛拦截 |
| 升级及回退 | 同一正式身份的升级、旧数据保留、回退和签名单独验收；Debug 候选不作为自动更新包 |

## 仍未完成

1. Windows、Intel Mac、Linux 对应环境的完整编译 / 安装及上述实机任务；用户已确认协助验收，当前尚无这些系统的通过证据。
2. Mac 的普通聊天、附件、Cowork、电脑控制和语音入口完整验收；追加 CA Basic X.509 信任用途及语音入口方案仍待此前问题的答复。
3. 正式签名、安装升级 / 回退、许可分发材料及发布授权。当前所有候选均不得标为“全平台已验收”或直接上线。

## 官方依据（2026-11-17 核对）

- [Claude Desktop 安装及 Linux 范围](https://support.claude.com/en/articles/10065433-install-claude-desktop)
- [Windows MSIX 与 Cowork 安装要求](https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows)
- [Chromium Linux NSS 证书库路径](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/cert_management.md)
- [Node 24.22.3 官方校验表](https://nodejs.org/dist/v24.22.3/SHASUMS256.txt)
- [GitHub 托管运行器及架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

## 2026-11-17 本机安装交付

用户明确要求更新本地兔子助手供亲自测试。确认任务队列生成中为 0，正常退出旧版后，备份原应用、`.tuzi-switch`、应用支持目录和 WebKit 数据，再替换 `/Applications/兔子助手.app`。安装的是上述 `d50c1d50` 对应的 Mac ARM 未签名 Debug 候选，版本仍为 1.6.2，主程序与内置 Node 摘要均匹配。不是远端发布或自动更新。

新版本已正常启动并打开原生 Claude Desktop 配置页，兼容面板可见、内置 Node 就绪。该正常身份的兼容目录是首次使用，页面尚无供应商，资源未准备、证书未信任；未自动从 P0 迁移证书或凭证，也未启动模型请求。安装及配置入口检查通过，不代表普通聊天、Cowork、语音、电脑控制完整验收通过。用户可在此页导入兼容供应商、准备资源并亲自进行系统证书授权。

原应用和本地数据备份位置：`/Users/sdy09/Library/Application Support/Tuzi Local Backups/claude-local-20261117-103105`。备份目录权限 0700，含本地私有数据，不进入源码归档或公开上传；具体安装收据见本机备份目录及跨平台证据的 `localInstallation`。
