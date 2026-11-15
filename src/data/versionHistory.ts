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
 * 正式版本档案（2026-10-29 核对 GitHub Releases）。
 * 仅收录已公开且非预发布的语义版本；不将 Git Tag 等同正式发布。
 * 日期使用 Release published_at（Asia/Shanghai），按实际发布时间倒序排列。
 * 摘要依据发布说明及版本间提交，来源清单见 docs/development/version-history-sources.json。
 */
export const productReleases: ProductRelease[] = [
  release("v1.4.2", "2026-10-22", "1a3230108820cd4f9917e8d3f4f1bd9e11a2e0ed", [
    {
      category: "fix",
      title: "修复 Codex 模型列表缺失，优化模型下拉滚动及数量提示。",
    },
    {
      category: "compatibility",
      title: "完善 Claude/Gemini 协议识别，保持模型展示与保存校验一致。",
    },
    {
      category: "fix",
      title: "修复 Codex TOML 编辑光标跳动、配置反复改写及保存异常。",
    },
    {
      category: "fix",
      title: "修复账户生成的 Codex 配置检查时误报 API Key not found。",
    },
    {
      category: "enhancement",
      title:
        "支持不同供应商卡片使用相同的 model_provider 标识，并独立保存凭证。",
    },
    {
      category: "fix",
      title: "加强 Codex 保存与启用失败后的配置、凭证及当前状态恢复。",
    },
  ]),
  release("v1.4.1", "2026-10-21", "9b4e702b2ae973571221c9aa877f8fec0498c045", [
    {
      category: "feature",
      title: "新增兔子账户系统令牌连接、账户概要及 API 密钥管理。",
    },
    {
      category: "feature",
      title: "支持 API 密钥创建、编辑、启停、删除及配置到七种开发工具。",
    },
    {
      category: "enhancement",
      title: "优化模型兼容识别、多模型校验、供应商预填及保存反馈。",
    },
    {
      category: "enhancement",
      title: "更新账户图标与导航体验，保留既有工具配置能力。",
    },
    {
      category: "compatibility",
      title: "修复 Windows 安装包产品标识，沿用既有 MSI 升级标识。",
    },
  ]),
  release("v1.3.1", "2026-10-08", "8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98", [
    { category: "fix", title: "修复 Codex 兔子线路的 API 环境变量路由。" },
    { category: "enhancement", title: "更新供应商默认模型名称。" },
  ]),
  release("v1.3.0", "2026-09-22", "4030b898439c70fc11f3807008bb59c90e493c00", [
    {
      category: "feature",
      title: "新增 Codex 供应商安全票据导入，完善确认提示与启用状态保留。",
    },
    { category: "feature", title: "整合 Codex 图片渲染兼容模式。" },
    {
      category: "fix",
      title: "修复 Codex 线路令牌切换、旧线路共享令牌及重复模型配置。",
    },
    {
      category: "fix",
      title: "保留 Codex 配置编辑内容，完善模型字段 TOML 注入防护。",
    },
    { category: "compatibility", title: "修复 Windows 稳定版 Rust 构建失败。" },
  ]),
  release("v1.2.1", "2026-07-24", "275be5ae15bf8353d2e82644095d1c5bffa4a15c", [
    {
      category: "engineering",
      title: "发布 v1.2.1 安装包，同步应用版本元数据及变更记录。",
    },
  ]),
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
  release("v1.1.2", "2026-05-31", "a7e6c571fc643c28cab513caf13ce8c8efb011b1", [
    {
      category: "feature",
      title: "新增 Windows 环境变量写入支持，兼容 setx 与注册表。",
    },
  ]),
  release("v1.1.3", "2026-05-30", "26dc5470b25fe07bd7dedd9741ad40dc1b745f47", [
    { category: "compatibility", title: "适配 Codex 新版配置写入方式。" },
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
  release("v1.0.2", "2026-05-24", "fe84fe98b5b3e82f19217232efc1eaa409ebc44e", [
    { category: "fix", title: "修复 Codex 兔子线路 API 请求地址。" },
    {
      category: "enhancement",
      title: "完善 Windows 版本适配及供应商充值、查询链接展示。",
    },
  ]),
  release("v1.0.1", "2026-05-21", "e7a8501b7e8818c1ce1c4b8f7d55850d6d86f1a6", [
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
    [{ category: "enhancement", title: "完善快捷访问可靠性。" }],
  ),
  release(
    "v3.12.18",
    "2026-05-07",
    "75f74253f22880412cd8bf488c5ed2e55e0f6e8c",
    [{ category: "enhancement", title: "完善应用可靠性并更新安装包。" }],
  ),
  release(
    "v3.12.16",
    "2026-04-21",
    "e1ccff9172b4f43135675059c406705e4025fb06",
    [
      {
        category: "enhancement",
        title: "整合快捷访问、状态同步与会话标题体验优化。",
      },
      { category: "fix", title: "完善业务路由同步及安装流程。" },
    ],
  ),
  release(
    "v3.12.10",
    "2026-04-09",
    "cd8ce7ff3844817853959e8d75b16e120c04c42b",
    [
      { category: "feature", title: "新增 Gemini 快捷访问入口。" },
      { category: "enhancement", title: "优化用量面板的信息层级。" },
      { category: "fix", title: "区分 Codex 兔子主站与 Coding 线路配置。" },
    ],
  ),
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
];
