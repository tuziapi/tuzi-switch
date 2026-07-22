const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const paths = {
  packageJson: path.join(root, "package.json"),
  tauriConf: path.join(root, "src-tauri/tauri.conf.json"),
  cargoToml: path.join(root, "src-tauri/Cargo.toml"),
  cargoLock: path.join(root, "src-tauri/Cargo.lock"),
};

const args = process.argv.slice(2);
const dryRunIndex = args.indexOf("--dry-run");
const dryRun = dryRunIndex !== -1;
if (dryRun) args.splice(dryRunIndex, 1);

if (args.length > 1 || args.includes("--help") || args.includes("-h")) {
  console.log(`用法:
  node scripts/bump-version.cjs                  # 3.17.0-tuzi.1 -> 3.17.0-tuzi.2
  node scripts/bump-version.cjs 5                # 设置为当前 CC 基线的 tuzi.5
  node scripts/bump-version.cjs 3.18.0-tuzi.1    # 切换 CC 基线并设置 Tuzi 修订号
  node scripts/bump-version.cjs --dry-run        # 只显示结果，不写文件`);
  process.exit(args.length > 1 ? 1 : 0);
}

if (args[0]?.startsWith("--")) {
  throw new Error(`未知选项：${args[0]}`);
}

const packageJson = JSON.parse(fs.readFileSync(paths.packageJson, "utf8"));
const currentVersion = packageJson.version;
const currentMatch = /^(\d+\.\d+\.\d+)-tuzi\.(\d+)$/.exec(currentVersion);
if (!currentMatch) {
  throw new Error(
    `当前版本 ${currentVersion} 不符合 <CC版本>-tuzi.<修订号>，请显式传入完整版本。`,
  );
}

const requested = args[0];
let nextVersion;
if (!requested || requested === "next") {
  nextVersion = `${currentMatch[1]}-tuzi.${Number(currentMatch[2]) + 1}`;
} else if (/^\d+$/.test(requested)) {
  nextVersion = `${currentMatch[1]}-tuzi.${Number(requested)}`;
} else if (/^\d+\.\d+\.\d+-tuzi\.\d+$/.test(requested)) {
  nextVersion = requested;
} else {
  throw new Error(
    `无效版本 ${requested}；应为修订号（如 2）或完整版本（如 3.18.0-tuzi.1）。`,
  );
}

if (nextVersion === currentVersion) {
  throw new Error(`目标版本与当前版本相同：${currentVersion}`);
}

const tauriConf = JSON.parse(fs.readFileSync(paths.tauriConf, "utf8"));
const cargoToml = fs.readFileSync(paths.cargoToml, "utf8");
const cargoLock = fs.readFileSync(paths.cargoLock, "utf8");

const packagePattern = /(^\[package\]\s*\nname = "tuzi-switch"\s*\nversion = ")[^"]+("\s*$)/m;
const lockPattern = /(^\[\[package\]\]\s*\nname = "tuzi-switch"\s*\nversion = ")[^"]+("\s*$)/m;

if (!packagePattern.test(cargoToml)) {
  throw new Error("未在 src-tauri/Cargo.toml 找到 tuzi-switch package 版本。");
}
if (!lockPattern.test(cargoLock)) {
  throw new Error("未在 src-tauri/Cargo.lock 找到 tuzi-switch package 版本。");
}

const outputs = new Map();
packageJson.version = nextVersion;
outputs.set(paths.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`);

tauriConf.version = nextVersion;
outputs.set(paths.tauriConf, `${JSON.stringify(tauriConf, null, 2)}\n`);
outputs.set(
  paths.cargoToml,
  cargoToml.replace(packagePattern, `$1${nextVersion}$2`),
);
outputs.set(
  paths.cargoLock,
  cargoLock.replace(lockPattern, `$1${nextVersion}$2`),
);

console.log(`${currentVersion} -> ${nextVersion}${dryRun ? " (dry-run)" : ""}`);
if (!dryRun) {
  for (const [file, content] of outputs) {
    fs.writeFileSync(file, content);
    console.log(`已同步 ${path.relative(root, file)}`);
  }
}
