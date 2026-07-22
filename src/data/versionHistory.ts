export type ReleaseChangeCategory =
  | "feature"
  | "enhancement"
  | "fix"
  | "performance"
  | "compatibility"
  | "security"
  | "architecture"
  | "engineering"
  | "documentation";

export interface ReleaseChange {
  category: ReleaseChangeCategory;
  title: string;
  description?: string;
}

export interface ProductRelease {
  version: string;
  publishedAt: string;
  commit: string;
  releaseUrl: string;
  changes: ReleaseChange[];
}

const release = (
  version: string,
  publishedAt: string,
  commit: string,
  changes: ReleaseChange[],
): ProductRelease => ({
  version,
  publishedAt,
  commit,
  releaseUrl: `https://github.com/tuziapi/tuzi-switch/releases/tag/${version}`,
  changes,
});

/**
 * 正式版本档案。
 *
 * 内容依据对应 Git Tag、相邻 Tag 间的提交记录及 CHANGELOG 整理；
 * 数组严格按 Tag 的实际提交日期倒序排列。
 */
export const productReleases: ProductRelease[] = [
  release("v1.2.0", "2026-07-14", "09fff2c146386f088cc91cab4f82d5c5499ae788", [
    {
      category: "feature",
      title: "新增 Codex 官方登录状态保留与会话历史统一能力。",
    },
    {
      category: "fix",
      title: "修复统一历史迁移及功能关闭后的共享数据残留问题。",
    },
    {
      category: "engineering",
      title: "修正 Linux 构建产品名称，确保 DEB 包名符合规范。",
    },
  ]),
  release("v1.1.31", "2026-06-23", "e6c20d7660c563aa8b9e790d38defdafee9ddff3", [
    { category: "fix", title: "修复 Codex 订阅供应商的请求路由配置。" },
  ]),
  release("v1.1.30", "2026-06-16", "7dfb27c6a6d4e57853560ec09df556a9541e1511", [
    { category: "fix", title: "完善 Codex 环境变量写入与应用更新发布链路。" },
  ]),
  release("v1.1.29", "2026-06-15", "0b59bacf8e07d9be8839fa09594a8df850ec8cb8", [
    { category: "compatibility", title: "适配模型供应商的最新配置格式。" },
    { category: "fix", title: "修复自动更新及 Codex 供应商配置持久化问题。" },
  ]),
  release("v1.1.28", "2026-06-13", "db310c55474d89015011317d34d2c9db8159c21e", [
    {
      category: "fix",
      title: "修复更新器卡住或返回空结果时无法提示新版本的问题。",
    },
    {
      category: "fix",
      title: "修复原生更新安装后的重启流程可能被退出保护拦截的问题。",
    },
    {
      category: "fix",
      title: "修复 Windows 更新清单选择未压缩 MSI 导致签名包不可用的问题。",
    },
  ]),
  release("v1.1.27", "2026-06-11", "96f0646b1e6aa2409fc1c3ff7a8d5599d24a6dc5", [
    {
      category: "fix",
      title: "修复多个 Codex 供应商可能共享同一 API Key 的凭据串号问题。",
    },
    {
      category: "fix",
      title: "修复供应商配置回填可能丢失 profiles 覆盖项的问题。",
    },
    {
      category: "documentation",
      title: "补充 Codex 凭据隔离事故复盘及配置边界说明。",
    },
  ]),
  release("v1.1.26", "2026-06-10", "33e92a3b79bcc6489a50ec84bc7cc48619b976ca", [
    {
      category: "enhancement",
      title: "为 Codex 订阅供应商新增双备用 API 端点及复用查询入口。",
    },
  ]),
  release("v1.1.25", "2026-06-09", "39efd0a2bad4846b28d04923d275525479c469f9", [
    {
      category: "fix",
      title: "修复 Codex 供应商编辑页无法回显 API Key 的问题。",
    },
  ]),
  release("v1.1.24", "2026-06-08", "a16853f1767b17bf60acd01f0c5fab05df9ebf09", [
    {
      category: "engineering",
      title: "完成 v1.1.24 正式版本构建与发布配置同步。",
    },
  ]),
  release("v1.1.23", "2026-06-08", "b3b26e622458d75153f058347863402b7737aec6", [
    {
      category: "enhancement",
      title: "优化自动更新清单的端点优先级与回退顺序。",
    },
  ]),
  release("v1.1.22", "2026-06-08", "a41078056d2ac87d788102536d64653bb3999781", [
    {
      category: "engineering",
      title: "完成 v1.1.22 正式版本构建与发布配置同步。",
    },
  ]),
  release("v1.1.21", "2026-06-08", "986a49856dae23b090e6046162bdc0ad171e4310", [
    { category: "feature", title: "新增更新器自动安装验证入口。" },
    { category: "fix", title: "修复更新清单的分支发布方式。" },
  ]),
  release("v1.1.20", "2026-06-08", "c2559136539ddf46dff65ba0fd90868e1944b760", [
    {
      category: "engineering",
      title: "完成 v1.1.20 正式版本构建与发布配置同步。",
    },
  ]),
  release("v1.1.19", "2026-06-08", "7d126610a31364d0b622a3b2ec7089d9d8dbe346", [
    { category: "fix", title: "修复更新签名密码环境变量的传递配置。" },
  ]),
  release("v1.1.18", "2026-06-08", "d1d5574a19ae3ad85990da4890c56565e7603132", [
    { category: "fix", title: "修复更新签名密钥密码配置。" },
  ]),
  release("v1.1.17", "2026-06-08", "34f9b3764c0378b8746b204a8430ec5d1873c6ae", [
    { category: "fix", title: "修复更新包签名及发布链路。" },
  ]),
  release("v1.1.16", "2026-06-08", "d48f5689746fbaf397cece17653b4d3ca938d1bb", [
    {
      category: "engineering",
      title: "发布更新检测链路验证版本，确认 GitHub Release 回退机制可用。",
    },
  ]),
  release("v1.1.15", "2026-06-08", "fcca15fbbbd713bf4acae99ed21eb033c5957a61", [
    {
      category: "fix",
      title: "在原生更新清单缺失时回退至 GitHub 最新版本检测。",
    },
    { category: "enhancement", title: "无签名更新清单时改用手动下载流程。" },
  ]),
  release("v1.1.14", "2026-06-07", "6ec638c81000b506f18f309fe2d36a9ca47a1bf0", [
    {
      category: "fix",
      title: "修复缺少可选签名密钥时安装包构建被阻断的问题。",
    },
    {
      category: "fix",
      title: "修复 Windows 中文产品名导致安装器构建失败的问题。",
    },
  ]),
  release("v1.1.13", "2026-06-07", "cead935ddbae2d746b0145f042944e35cd83198f", [
    {
      category: "fix",
      title: "修复原生更新清单不可用时阻断界面热更新检测的问题。",
    },
    {
      category: "enhancement",
      title: "统一安装包、窗口、关于页及发布说明中的产品名称。",
    },
  ]),
  release("v1.1.12", "2026-06-07", "72c096f4fde18e8e8bf62fe8e059a38a3dc6e526", [
    { category: "enhancement", title: "优化供应商卡片的连接及配置状态展示。" },
  ]),
  release("v1.1.11", "2026-06-07", "95c9ddeb2a216f90089b1ae0e0fdbb643771a661", [
    { category: "feature", title: "在供应商表单中集成 Codex 端点管理与测速。" },
    {
      category: "enhancement",
      title: "支持双端点候选及最快可用端点自动选择。",
    },
    { category: "fix", title: "修复订阅端点候选在编辑供应商时丢失的问题。" },
  ]),
  release("v1.1.10", "2026-06-07", "2e4ee81f98f5479c1e9b61786501b97a330b2ac5", [
    {
      category: "fix",
      title: "使用 GitHub CLI 更新 latest 标识，修复 Release 发布接口调用。",
    },
  ]),
  release("v1.1.9", "2026-06-07", "cba0cc733bc6f92aab596ef219ab48014c814101", [
    {
      category: "engineering",
      title: "允许未配置更新签名时继续发布安装包资产。",
    },
    { category: "engineering", title: "签名更新产物缺失时跳过更新清单生成。" },
  ]),
  release("v1.1.8", "2026-06-07", "bdce3592ba48357a356942d6b5a0d0317a73244a", [
    { category: "fix", title: "将 Tauri 签名密钥密码调整为可选发布配置。" },
  ]),
  release("v1.1.7", "2026-06-07", "2ff0ab67a7fd287e13e9d5fd76bbe222345b14e6", [
    {
      category: "fix",
      title: "修复 GitHub Actions 在作业级读取 secrets 导致的工作流校验失败。",
    },
    {
      category: "engineering",
      title: "将前端热更新发布设为不阻塞原生版本发布的可选步骤。",
    },
  ]),
  release("v1.1.6", "2026-06-07", "81c8c4db24702ed2bb32601810403f4cb8636c83", [
    { category: "fix", title: "修复 Tauri 更新产物的签名环境变量配置。" },
    {
      category: "engineering",
      title: "新增发布密钥前置校验及热更新可选发布机制。",
    },
  ]),
  release("v1.1.5", "2026-06-07", "92f954ad0448898db79592342f9d606dfead12ce", [
    { category: "feature", title: "新增带签名产物的 Tauri 官方更新流程。" },
    { category: "feature", title: "新增 Vite/React 前端资源签名热更新能力。" },
    {
      category: "architecture",
      title: "引入 Capability Facade v1，统一原生能力发现与调用。",
    },
    {
      category: "security",
      title: "移除远程安装脚本执行，并增加 SHA-256 与 minisign 校验。",
    },
  ]),
  release("v1.1.4", "2026-06-04", "c753af9fb52802c5f6ce5c0639977e8ea5ea7c60", [
    {
      category: "compatibility",
      title: "适配 Codex CLI 0.134.0 及新版 model_provider 配置格式。",
    },
    {
      category: "fix",
      title: "修复 Codex env_key 回填、API Key 展示及多供应商配置冲突。",
    },
    { category: "fix", title: "修复 OpenCode 供应商 API Key 识别问题。" },
  ]),
  release("v1.1.3", "2026-05-30", "26dc5470b25fe07bd7dedd9741ad40dc1b745f47", [
    { category: "compatibility", title: "适配 Codex 新版配置写入方式。" },
  ]),
  release("v1.1.2", "2026-05-28", "a7e6c571fc643c28cab513caf13ce8c8efb011b1", [
    {
      category: "feature",
      title: "新增 Windows 环境变量写入支持，兼容 setx 与注册表。",
    },
  ]),
  release("v1.1.1", "2026-05-28", "9bd354f83e70883b6cce57a49d12c50c6ed8b425", [
    {
      category: "documentation",
      title: "重建项目入口文档并同步 v1.1 系列版本信息。",
    },
  ]),
  release("v1.1.0", "2026-05-28", "bd4213d01349d1222b965d2d1a4e7b953a1f3a21", [
    {
      category: "architecture",
      title: "重构 Codex 配置读写逻辑并对齐官方配置规范。",
    },
  ]),
  release("v1.0.2", "2026-05-26", "fe84fe98b5b3e82f19217232efc1eaa409ebc44e", [
    { category: "fix", title: "修复 Codex 兔子线路 API 请求地址。" },
    {
      category: "enhancement",
      title: "完善 Windows 版本适配及供应商充值、查询链接展示。",
    },
  ]),
  release("v1.0.1", "2026-05-22", "e7a8501b7e8818c1ce1c4b8f7d55850d6d86f1a6", [
    { category: "fix", title: "修复编辑供应商时 API Key 输入框不回显的问题。" },
    { category: "enhancement", title: "新增供应商 API Key 同步能力。" },
    { category: "engineering", title: "移除 macOS Intel 构建目标。" },
  ]),
  release("v1.0.0", "2026-05-21", "3be53a4267de7bdb016a7ea1929754c8955f34b0", [
    {
      category: "engineering",
      title: "建立 Windows、macOS 与 Linux 的统一正式发布流程。",
    },
    {
      category: "compatibility",
      title: "修复安装脚本在 macOS Bash 3.2 下的语法兼容问题。",
    },
    {
      category: "enhancement",
      title: "安装脚本改为直接解析最新 Release，降低 GitHub API 依赖。",
    },
  ]),
  release(
    "v3.12.19",
    "2026-05-09",
    "38b1e2c07d05e8d667ea5e9f860fb5667c18a0a5",
    [
      {
        category: "fix",
        title: "修复业务快捷入口在安装、状态刷新及异常恢复场景下的可靠性问题。",
      },
      {
        category: "enhancement",
        title: "完善跨平台产品安装器的执行流程与结果反馈。",
      },
    ],
  ),
  release(
    "v3.12.18",
    "2026-05-07",
    "75f74253f22880412cd8bf488c5ed2e55e0f6e8c",
    [
      {
        category: "fix",
        title: "修复跨平台 CLI 安装流程中的环境识别与异常恢复问题。",
      },
      {
        category: "compatibility",
        title:
          "扩展 Node.js 与 npm 可执行路径识别，兼容常见版本管理器及 Windows 安装环境。",
      },
      {
        category: "enhancement",
        title: "新增缺失 Node.js/npm 时的依赖检测、安装确认与结果反馈。",
      },
    ],
  ),
  release(
    "v3.12.17",
    "2026-04-30",
    "80b0a484d73a83b3b58029b5b5918a38a4f624b1",
    [
      {
        category: "documentation",
        title: "更新安装命令、产品截图及版本规划说明。",
      },
    ],
  ),
  release(
    "v3.12.16",
    "2026-04-21",
    "e1ccff9172b4f43135675059c406705e4025fb06",
    [
      {
        category: "feature",
        title: "扩展跨平台产品安装器，完善 CLI 检测、安装、升级及卸载流程。",
      },
      {
        category: "enhancement",
        title: "重构业务快捷入口的状态管理、操作反馈与并发任务协调机制。",
      },
      {
        category: "fix",
        title: "修复供应商状态、用量查询及流式检测链路中的同步与异常处理问题。",
      },
      {
        category: "documentation",
        title: "新增当前业务路由逻辑说明，明确路由选择与状态同步规则。",
      },
    ],
  ),
  release(
    "v3.12.15",
    "2026-04-17",
    "be05789974531d74dda91e3960a61ccf7a2f314b",
    [
      {
        category: "enhancement",
        title: "优化快捷入口界面的信息层级与交互体验。",
      },
    ],
  ),
  release(
    "v3.12.14",
    "2026-04-16",
    "31d656e6548acb77cd2363272ceec54b2564f387",
    [
      {
        category: "engineering",
        title: "稳定自动化校验套件并完善版本发布验证。",
      },
    ],
  ),
  release(
    "v3.12.13",
    "2026-04-14",
    "d3d2c39e55d0eb530d39fbb61eebdc9c7c088b08",
    [
      {
        category: "enhancement",
        title: "优化业务状态同步机制及会话标题展示。",
      },
    ],
  ),
  release(
    "v3.12.12",
    "2026-04-13",
    "df049dc17dcee42e48b4ce2d89870003e0e5a3c1",
    [{ category: "fix", title: "强化业务路由同步及安装器回退流程。" }],
  ),
  release(
    "v3.12.11",
    "2026-04-10",
    "fb44fe2a08803532fb44ecfcc0e97f699d3d5859",
    [{ category: "enhancement", title: "完善快捷入口与用量查看工作流。" }],
  ),
  release(
    "v3.12.10",
    "2026-04-09",
    "cd8ce7ff3844817853959e8d75b16e120c04c42b",
    [
      { category: "feature", title: "新增 Gemini 快捷入口。" },
      { category: "fix", title: "拆分 Codex 兔子主线路与编程线路的请求路由。" },
      { category: "enhancement", title: "优化用量仪表盘的信息层级。" },
    ],
  ),
  release("v3.12.9", "2026-04-08", "c23ed3d9b3772aedf71c3dd7f95cf767f9210cad", [
    { category: "enhancement", title: "优化兔子服务引导流程及用量工作区。" },
    {
      category: "documentation",
      title: "将中文说明设为默认项目文档并更新路线图。",
    },
  ]),
  release("v3.12.8", "2026-04-07", "6c12a98983e6ef26f8ffd0d5f62e03c13d778e24", [
    { category: "feature", title: "新增兔子 Codex 订阅线路。" },
    { category: "feature", title: "新增跨平台一键安装脚本。" },
    { category: "documentation", title: "补充未签名 macOS 应用的启动说明。" },
  ]),
  release("v3.12.7", "2026-04-07", "9423158eec427849a819a9af49e5ea87ff1e74a2", [
    { category: "engineering", title: "支持发布未签名的 macOS 安装资产。" },
    {
      category: "documentation",
      title: "更新产品工作流截图及 macOS 安装说明。",
    },
  ]),
  release("v3.12.6", "2026-04-03", "836ac050d3327c3dd2605575cae8de550b6663de", [
    {
      category: "engineering",
      title: "未配置签名时停止生成不可用的更新器产物。",
    },
  ]),
  release("v3.12.5", "2026-04-03", "4776154b0dd88c6aa73602a81d48a71860003714", [
    {
      category: "engineering",
      title: "放宽正式版本发布对签名配置的强制要求。",
    },
    { category: "documentation", title: "更新仓库首页的产品介绍与展示内容。" },
  ]),
  release("v3.12.4", "2026-04-03", "367566ddfbc1c2dbf632112933a72f39a990c4ec", [
    {
      category: "engineering",
      title: "建立 tuzi-switch v3.12.4 正式版本构建与发布基线。",
    },
  ]),
];
