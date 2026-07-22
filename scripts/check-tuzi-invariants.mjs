import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function baseVersion(version) {
  return version.replace(/-tuzi\.\d+$/, "");
}

const baseline = readJson("upstream-base.json");
const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const tauriWindowsConfig = readJson("src-tauri/tauri.windows.conf.json");
const infoPlist = read("src-tauri/Info.plist");
const cargoToml = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const productRs = read("src-tauri/src/product.rs");
const tuziPresets = read("src/config/tuziProviderPresets.ts");
const tuziPresetTests = read("src/config/tuziProviderPresets.test.ts");
const codexTemplates = read("src/config/codexTemplates.ts");
const codexConfigRs = read("src-tauri/src/codex_config.rs");
const codexHistoryRs = read("src-tauri/src/codex_history_migration.rs");
const settingsRs = read("src-tauri/src/settings.rs");
const providerSeedsRs = read("src-tauri/src/database/dao/providers_seed.rs");
const providersDaoRs = read("src-tauri/src/database/dao/providers.rs");
const trayRs = read("src-tauri/src/tray.rs");
const appTsx = read("src/App.tsx");
const appVisibilitySettings = read(
  "src/components/settings/AppVisibilitySettings.tsx",
);
const profileSwitcher = read("src/components/profiles/ProfileSwitcher.tsx");
const codexAuthSettings = read("src/components/settings/CodexAuthSettings.tsx");
const updateContext = read("src/contexts/UpdateContext.tsx");
const aboutSection = read("src/components/settings/AboutSection.tsx");
const settingsApi = read("src/lib/api/settings.ts");
const updaterTs = read("src/lib/updater.ts");
const libRs = read("src-tauri/src/lib.rs");
const readmeZh = read("README_ZH.md");
const legacyReleaseWorkflow = read(".github/workflows/release.yml");
const tuziReleaseWorkflow = read(".github/workflows/tuzi-release.yml");
const protectedPaths = read("tuzi-protected-paths.txt")
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter((value) => value && !value.startsWith("#"));
const tuziIconHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(root, "src-tauri/icons/icon.png")))
  .digest("hex");

requireValue(
  baseline.schemaVersion === 1,
  "upstream-base.json schemaVersion 必须为 1",
);
requireValue(
  baseline.upstream?.repository === "https://github.com/farion1231/cc-switch",
  "上游仓库必须固定为 farion1231/cc-switch",
);
requireValue(baseline.upstream?.branch === "main", "上游分支必须固定为 main");
requireValue(
  /^v\d+\.\d+\.\d+$/.test(baseline.upstream?.releaseTag ?? ""),
  "上游基线必须记录最新已处理的正式 Release tag",
);
requireValue(
  /^[0-9a-f]{40}$/.test(baseline.upstream?.commit ?? ""),
  "上游基线必须记录完整的 40 位 commit SHA",
);
requireValue(
  /^[0-9a-f]{40}$/.test(baseline.upstream?.releaseCommit ?? ""),
  "上游基线必须记录正式 Release 对应的 40 位 commit SHA",
);
requireValue(
  packageJson.name === "tuzi-switch",
  "package.json name 必须为 tuzi-switch",
);
requireValue(
  packageJson.scripts?.["check:tuzi"] ===
    "node scripts/check-tuzi-invariants.mjs",
  "package.json 必须保留统一的 Tuzi 门禁脚本",
);
requireValue(
  tauriConfig.productName === "兔子switch",
  "Tauri productName 必须为 兔子switch",
);
requireValue(
  tauriConfig.identifier === "com.tuziswitch.desktop",
  "Tauri identifier 必须为 com.tuziswitch.desktop",
);
requireValue(
  tauriConfig.plugins?.["deep-link"]?.desktop?.schemes?.includes("tuziswitch"),
  "必须注册 tuziswitch:// 深链接",
);
requireValue(
  tauriConfig.plugins?.updater?.endpoints?.some((url) =>
    url.includes("tuziapi/tuzi-switch"),
  ),
  "更新源必须指向 tuziapi/tuzi-switch",
);
requireValue(
  tauriConfig.plugins?.updater?.endpoints?.every(
    (url) => !url.includes("farion1231/cc-switch"),
  ),
  "更新源不能回退到 CC Switch 发布仓库",
);
requireValue(
  tauriWindowsConfig.app?.windows?.[0]?.title === "兔子switch",
  "Windows 主窗口标题必须为 兔子switch",
);
requireValue(
  infoPlist.includes("Tuzi Switch Deep Link") &&
    infoPlist.includes("<string>tuziswitch</string>"),
  "macOS 深链接品牌或协议被上游覆盖",
);
requireValue(
  updaterTs.includes(
    "https://api.github.com/repos/tuziapi/tuzi-switch/releases/latest",
  ) && !updaterTs.includes("farion1231/cc-switch"),
  "前端更新兜底地址必须指向 Tuzi Release",
);
requireValue(
  readmeZh.includes("https://github.com/tuziapi/tuzi-switch/releases") &&
    readmeZh.includes("`tuziswitch://`") &&
    readmeZh.includes("~/.tuzi-switch/tuzi-switch.db"),
  "README 的下载、深链或数据目录仍未指向 Tuzi 产品",
);
requireValue(
  legacyReleaseWorkflow.includes(
    "if: github.repository == 'farion1231/cc-switch'",
  ),
  "CC 上游 release workflow 必须禁止在 Tuzi 仓库执行",
);
for (const protectedPath of [
  "src/config/tuziProviderPresets.ts",
  "src-tauri/src/product.rs",
  "src-tauri/src/web_hot_update.rs",
  "src-tauri/icons",
  "tuzi-protected-paths.txt",
  ".github/workflows/sync-cc-upstream.yml",
  ".github/workflows/tuzi-release.yml",
]) {
  requireValue(
    protectedPaths.includes(protectedPath),
    `Tuzi 保护清单缺少 ${protectedPath}`,
  );
}
requireValue(
  /^name\s*=\s*"tuzi-switch"$/m.test(cargoToml),
  "Cargo package name 必须为 tuzi-switch",
);

for (const [marker, message] of [
  [
    'APP_CONFIG_DIR_NAME: &str = ".tuzi-switch"',
    "默认配置目录必须为 ~/.tuzi-switch",
  ],
  [
    'DATABASE_FILE_NAME: &str = "tuzi-switch.db"',
    "数据库文件必须为 tuzi-switch.db",
  ],
  ['LOG_FILE_NAME: &str = "tuzi-switch.log"', "日志文件必须为 tuzi-switch.log"],
  [
    'DEEP_LINK_PREFIX: &str = "tuziswitch://"',
    "深链接前缀必须为 tuziswitch://",
  ],
  [
    'LATEST_RELEASE_URL: &str = "https://github.com/tuziapi/tuzi-switch/releases/latest"',
    "发布仓库必须指向 tuziapi/tuzi-switch",
  ],
]) {
  requireValue(productRs.includes(marker), message);
}

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"$/m)?.[1] ?? "";
const cargoLockVersion = cargoLock.match(
  /\[\[package\]\]\nname = "tuzi-switch"\nversion = "([^"]+)"/,
)?.[1];
for (const [source, version] of [
  ["package.json", packageJson.version],
  ["tauri.conf.json", tauriConfig.version],
  ["Cargo.toml", cargoVersion],
  ["Cargo.lock", cargoLockVersion ?? ""],
]) {
  requireValue(
    baseVersion(version) === baseline.upstream?.version,
    `${source} 版本 ${version} 未对齐 CC 基线 ${baseline.upstream?.version}`,
  );
}

for (const marker of [
  "兔子线路",
  "codex订阅",
  "gaccode",
  "TUZI_CODEX_ROUTES",
  "https://test-coding.tu-zi.com",
  "https://sub2api-origin.sydney-ai.com",
]) {
  requireValue(tuziPresets.includes(marker), `Tuzi 预设层缺少 ${marker}`);
}
requireValue(
  codexTemplates.includes('model_provider = "tuziswitch"'),
  "Codex 默认配置必须使用 tuziswitch 统一桶",
);
requireValue(
  codexTemplates.includes("x-openai-actor-authorization"),
  "Codex 第三方生图兼容请求头不能丢失",
);
requireValue(
  tuziPresets.includes('TUZI_CODEX_MODEL = "gpt-5.6-sol"') &&
    codexTemplates.includes('model = "${TUZI_CODEX_MODEL}"'),
  "Codex 默认模型必须保留 Tuzi 的 gpt-5.6-sol",
);
for (const [source, text, markers] of [
  [
    "src-tauri/src/codex_config.rs",
    codexConfigRs,
    [
      "preserve_codex_official_auth_on_switch()",
      "inject_codex_unified_session_bucket",
      "write_codex_live_config_atomic",
      "should_write_auth",
      "third_party_switch_preserves_official_auth_when_enabled",
      "third_party_switch_writes_auth_when_preservation_is_disabled",
      "official_switch_only_writes_auth_with_login_material",
    ],
  ],
  [
    "src-tauri/src/codex_history_migration.rs",
    codexHistoryRs,
    [
      'join("archived_sessions")',
      "CODEX_SQLITE_HOME",
      "sqlite_home",
      "restore_codex_official_history_from_backups",
      "OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID",
      "OFFICIAL_CODEX_MODEL_PROVIDER_ID",
      "NamedTempFile::new_in",
    ],
  ],
  [
    "src-tauri/src/settings.rs",
    settingsRs,
    [
      "preserve_codex_official_auth_on_switch: true",
      "unify_codex_session_history: true",
      '#[serde(default = "default_true")]',
      "unify_codex_migrate_existing",
    ],
  ],
  [
    "src-tauri/src/database/dao/providers_seed.rs",
    providerSeedsRs,
    [
      "TUZI_CODEX_ROUTE_ENDPOINTS",
      "https://test-coding.tu-zi.com",
      "https://sub2api-origin.sydney-ai.com",
      "x-openai-actor-authorization",
      "http://coding.tu-zi.com",
      'model = \\"gpt-5.6-sol\\"',
    ],
  ],
  [
    "src-tauri/src/database/dao/providers.rs",
    providersDaoRs,
    [
      "init_default_tuzi_providers",
      "ensure_provider_endpoints",
      "WHERE NOT EXISTS",
    ],
  ],
  [
    "src/components/settings/CodexAuthSettings.tsx",
    codexAuthSettings,
    [
      "preserveCodexOfficialAuthOnSwitch",
      "unifyCodexSessionHistory",
      "restoreCodexUnifiedHistory",
    ],
  ],
  [
    "src/contexts/UpdateContext.tsx",
    updateContext,
    ["checkForUpdate", "checkWebHotUpdate", "settings.webUpdateReady"],
  ],
  [
    "src/components/settings/AboutSection.tsx",
    aboutSection,
    ["getWebHotUpdateStatus", "checkWebHotUpdate", "settings.webHotUpdate"],
  ],
  [
    "src/lib/api/settings.ts",
    settingsApi,
    [
      "restoreCodexUnifiedHistory",
      "getWebHotUpdateStatus",
      "checkWebHotUpdate",
    ],
  ],
  [
    "src-tauri/src/lib.rs",
    libRs,
    [
      "web_hot_update::register_protocol",
      "web_hot_update::navigate_main_window_if_available",
      "commands::restore_codex_unified_history",
      "web_hot_update::check_web_hot_update",
      "commands::install_update_and_restart",
    ],
  ],
  [
    "src/config/tuziProviderPresets.test.ts",
    tuziPresetTests,
    ["TUZI_CODEX_ROUTES", "TUZI_AGENT_ROUTES", "endpointCandidates"],
  ],
]) {
  for (const marker of markers) {
    requireValue(
      text.includes(marker),
      `${source} 缺少 Tuzi 行为契约：${marker}`,
    );
  }
}
requireValue(
  appTsx.includes("ProfileSwitcher") &&
    appVisibilitySettings.includes("showProfileSwitcher") &&
    profileSwitcher.includes("data-tuzi-profile-switcher") &&
    trayRs.includes("submenu_profiles") &&
    trayRs.includes("handle_profile_tray_event"),
  "主界面、通用设置或托盘缺少项目切换入口",
);
for (const marker of [
  "tuzi-switch-macos-universal.app.tar.gz",
  "tuzi-switch-macos-universal.app.tar.gz.sig",
  "tuzi-switch-windows-x86_64.msi.sig",
  "tuzi-switch-windows-aarch64.msi.sig",
  "tuzi-switch-linux-x86_64.AppImage.sig",
  "tuzi-switch-linux-aarch64.AppImage.sig",
  "requiredCapabilities",
  '"analytics.trackProductEvent"',
  '"update.checkWeb"',
]) {
  requireValue(
    tuziReleaseWorkflow.includes(marker),
    `Tuzi 发布流程缺少更新契约：${marker}`,
  );
}
requireValue(
  tuziIconHash ===
    "0ac46b55e71b60d46874ca24ded5a98228967753e9dc9333d52f4faa157cf9bc",
  "Tuzi 主图标被上游品牌资产覆盖",
);

if (errors.length > 0) {
  for (const error of errors)
    console.error(`::error title=Tuzi invariant::${error}`);
  process.exit(1);
}

console.log(
  `Tuzi invariants passed (CC ${baseline.upstream.version} @ ${baseline.upstream.commit.slice(0, 12)}).`,
);
