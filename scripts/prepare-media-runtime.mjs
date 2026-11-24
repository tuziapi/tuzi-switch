// Build an offline-only FFmpeg sidecar from pinned source. Source + notices travel with it.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform;
if (!["darwin", "linux", "win32"].includes(platform) || !["x64", "arm64"].includes(process.arch)) throw new Error("Unsupported compression build platform");
const targetArch = { aarch64: "arm64", x86_64: "x64", arm64: "arm64", x64: "x64" }[process.env.TAURI_ENV_ARCH] || process.arch;
if (targetArch !== process.arch) throw new Error("Build the offline media engine on the target architecture; use the native five-platform installer matrix.");
const build = path.join(root, "src-tauri/target/media-build", `${platform}-${process.arch}`);
const output = path.join(root, "src-tauri/target/media-runtime");
const prefix = path.join(build, "prefix");
const sources = [
  { name: "ffmpeg", file: "ffmpeg-9.1.tar.xz", url: "https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz", sha256: "1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433" },
  { name: "x264", file: "x264-31e19f92.tar.gz", url: "https://codeload.github.com/mirror/x264/tar.gz/31e19f92f00c7003fa115047ce50978bc98c3a0d", sha256: "d053c9d86988d6bc78237ca5205865c5ddf99c98ef4cd9927eec8f6d388f6dd9" },
  { name: "pkgconf", file: "pkgconf-2.5.1.tar.xz", url: "https://distfiles.ariadne.space/pkgconf/pkgconf-2.5.1.tar.xz", sha256: "cd05c9589b9f86ecf044c10a2269822bc9eb001eced2582cfffd658b0a50c243" },
];
const hash = data => createHash("sha256").update(data).digest("hex");
const recipeHash = hash(await readFile(fileURLToPath(import.meta.url)));
const executable = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const engine = path.join(output, executable);
try {
  const manifest = JSON.parse(await readFile(path.join(output, "provenance.json"), "utf8"));
  if (manifest.platform === platform && manifest.arch === process.arch && manifest.recipeHash === recipeHash && manifest.binarySha256 === hash(await readFile(engine))) {
    for (const source of sources) if (hash(await readFile(path.join(output,"sources",source.file))) !== source.sha256) throw new Error("Missing source archive");
    console.log("Verified packaged offline video engine");
    process.exit(0);
  }
} catch {}
await mkdir(build, { recursive: true });
await mkdir(output, { recursive: true });
await mkdir(path.join(output, "sources"), { recursive: true });
function run(command, args, cwd = build, extraEnv = {}) {
  const result = spawnSync(command, args, {cwd, env: {...process.env, ...extraEnv}, stdio:"inherit", shell:false});
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}); install a C compiler and make${platform === "win32" ? " in MSYS2 UCRT64" : ""}.`);
}
const shellPath = value => platform === "win32" ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : value;
for (const source of sources) {
  const archive = path.join(output, "sources", source.file);
  let data;
  try { data = await readFile(archive); } catch {}
  if (!data || hash(data) !== source.sha256) {
    console.log(`Downloading pinned ${source.name} source`);
    const response = await fetch(source.url, { signal: AbortSignal.timeout(1200000) });
    if (!response.ok) throw new Error(`Source download failed: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (hash(data) !== source.sha256) throw new Error(`Integrity mismatch: ${source.name}`);
    await writeFile(archive, data);
  }
  const dir = path.join(build, source.name);
  await mkdir(dir, {recursive:true});
  run("tar", ["-xf", shellPath(archive), "--strip-components=1", "-C", shellPath(dir)]);
}
const jobs = "-j2";
const prefixArg = `--prefix=${shellPath(prefix)}`;
// pkgconf's autotools build does not set the static API macro on MinGW.
// Without it the CLI imports DLL symbols while linking the static archive.
const pkgconfEnv = platform === "win32"
  ? { CPPFLAGS: [process.env.CPPFLAGS, "-DPKGCONFIG_IS_STATIC"].filter(Boolean).join(" ") }
  : {};
run("sh", ["./configure",prefixArg,"--disable-shared","--enable-static","--disable-dependency-tracking"],path.join(build,"pkgconf"),pkgconfEnv);
if (platform === "win32") run("make",["clean"],path.join(build,"pkgconf"));
run("make",[jobs],path.join(build,"pkgconf"));
run("make",["install"],path.join(build,"pkgconf"));
const env = {PKG_CONFIG_PATH:shellPath(path.join(prefix,"lib/pkgconfig"))};
run("sh",["./configure",prefixArg,"--enable-static","--enable-pic","--disable-cli","--disable-opencl","--disable-asm"],path.join(build,"x264"),env);
run("make",[jobs],path.join(build,"x264"),env);
run("make",["install"],path.join(build,"x264"),env);
const flags = ["./configure",prefixArg,"--disable-shared","--enable-static","--disable-debug","--disable-doc","--disable-network","--disable-autodetect","--disable-everything","--disable-ffplay","--disable-ffprobe","--disable-x86asm","--enable-ffmpeg","--enable-gpl","--enable-libx264",
  "--enable-protocol=file,pipe","--enable-demuxer=mov,matroska","--enable-muxer=mp4","--enable-decoder=h264,hevc,vp8,vp9,av1,aac,opus,vorbis,prores,mpeg4,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le","--enable-parser=h264,hevc,vp8,vp9,av1,aac,opus,vorbis,mpeg4video","--enable-encoder=libx264,aac","--enable-filter=scale,format,setsar,aresample,aformat,anull,null,transpose,hflip,vflip","--enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb",
  `--pkg-config=${shellPath(path.join(prefix,"bin",platform === "win32" ? "pkgconf.exe" : "pkgconf"))}`,"--pkg-config-flags=--static",`--extra-cflags=-I${shellPath(path.join(prefix,"include"))}`,`--extra-ldflags=-L${shellPath(path.join(prefix,"lib"))}${platform === "win32" ? " -static" : ""}`];
run("sh",flags,path.join(build,"ffmpeg"),env);
run("make",[jobs],path.join(build,"ffmpeg"),env);
await cp(path.join(build,"ffmpeg",executable),engine);
await chmod(engine,0o755);
if (platform === "darwin") {
  const deps = spawnSync("otool",["-L",engine],{encoding:"utf8"});
  if (deps.status !== 0 || deps.stdout.split("\n").slice(1).some(line => line.trim() && !/^\s*\/(usr\/lib|System\/Library)\//.test(line))) throw new Error("Compression engine depends on non-system libraries");
}
run(engine,["-version"]);
await cp(path.join(build,"ffmpeg","COPYING.GPLv2"),path.join(output,"COPYING.GPLv2"));
await cp(path.join(build,"x264","COPYING"),path.join(output,"COPYING.x264"));
await cp(path.join(build,"pkgconf","COPYING"),path.join(output,"COPYING.pkgconf"));
await cp(fileURLToPath(import.meta.url),path.join(output,"sources","prepare-media-runtime.mjs"));
await writeFile(path.join(output,"README.txt"),"Offline video compression engine: FFmpeg 9.1 + x264. Separate executable, GPLv2 or later. Complete unmodified sources, build recipe and notices are included in sources/. pkgconf is a build tool only. To rebuild, place this recipe in scripts/prepare-media-runtime.mjs under an empty project root and run with Node.js, a C compiler, make and tar (MSYS2 UCRT64 on Windows). No remote URLs or shell arguments are accepted from app users.\n");
await writeFile(path.join(output,"provenance.json"),JSON.stringify({schemaVersion:1,platform,arch:process.arch,recipeHash,binarySha256:hash(await readFile(engine)),bytes:(await stat(engine)).size,sources},null,2)+"\n");
console.log("Packaged offline video engine ready");
