#!/bin/bash
# Tuzi Assistant v1.5.6. Only official, checksum-pinned macOS installers.
set -euo pipefail
umask 077

VERSION=1.5.6
REPO=tuziapi/tuzi-switch
APP_NAME='兔子助手.app'
APP_ID=com.tuziswitch.desktop
VERIFY_ONLY=false
NO_OPEN=false
INSTALL_DIR=''
REQUESTED_ARCH=''
TMP_DIR=''
STAGE_DIR=''
MOUNTED=false
BACKUP_DIR=''
DEST=''
LOCK_DIR=''

fail() { printf '\n错误：%s\n' "$*" >&2; exit 1; }
cleanup() {
  local result=$?
  trap - EXIT
  if $MOUNTED; then hdiutil detach "$TMP_DIR/mount" -quiet >/dev/null 2>&1 || true; fi
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR/$APP_NAME" && ! -e "$DEST" ]]; then
    mv "$BACKUP_DIR/$APP_NAME" "$DEST" || printf '请从此处恢复旧版：%s\n' "$BACKUP_DIR" >&2
  fi
  [[ -z "$STAGE_DIR" ]] || rm -rf "$STAGE_DIR"
  [[ -z "$LOCK_DIR" ]] || rmdir "$LOCK_DIR" 2>/dev/null || true
  # Never remove a directory while a disk image may still be mounted there.
  if [[ -n "$TMP_DIR" ]]; then
    if mount | grep -F " on $TMP_DIR/mount (" >/dev/null; then
      printf '磁盘映像尚未卸载，请在 Finder 中推出：%s\n' "$TMP_DIR/mount" >&2
    else
      rm -rf "$TMP_DIR"
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  cat <<'EOF'
兔子助手 v1.5.6 macOS 安装器（仅从 tuziapi/tuzi-switch 下载）
  bash install-macos.sh                         交互安装
  bash install-macos.sh --verify-only           仅下载、挂载并校验，不安装
  bash install-macos.sh --verify-only --arch x64 校验 Intel 包
  --install-dir /绝对路径                       指定安装目录
  --no-open                                    安装后不启动应用
不支持无人确认放行，不需要 sudo，不修改账户配置或系统全局安全设置。
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=true; shift ;;
    --no-open) NO_OPEN=true; shift ;;
    --install-dir) [[ $# -ge 2 ]] || fail '缺少安装目录'; INSTALL_DIR=$2; shift 2 ;;
    --arch) [[ $# -ge 2 ]] || fail '缺少架构'; REQUESTED_ARCH=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done
[[ "$(uname -s)" == Darwin ]] || fail '此脚本仅适用于 macOS。'
[[ "$EUID" -ne 0 ]] || fail '请以普通用户运行，不要使用 sudo。'
ARCH=$(uname -m)
# A terminal running under Rosetta still needs the native Apple Silicon package.
if [[ "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then ARCH=arm64; fi
if [[ -n "$REQUESTED_ARCH" ]]; then
  $VERIFY_ONLY || fail '--arch 仅限 --verify-only；安装时自动识别芯片。'
  ARCH=$REQUESTED_ARCH
fi
case "$ARCH" in
  arm64|aarch64)
    ARCH=arm64; MACH_ARCH=arm64
    SHA256=2851fc1583ef3aecda6b37da10bec6fa7b71db7a4d34e956c0752592c2f6087b ;;
  x64|x86_64)
    ARCH=x64; MACH_ARCH=x86_64
    SHA256=45b2a82cc287e229dab2199c6ce70f13c8505a2709c9e27d98ed624a2884624c ;;
  *) fail "不支持的 Mac 架构：$ARCH" ;;
esac
FILE="tuzi-assistant-macos-$ARCH.dmg"
URL="https://github.com/$REPO/releases/download/v$VERSION/$FILE"

confirm() {
  local answer=''
  printf '\n%s [y/N] ' "$1" > /dev/tty
  read -r answer < /dev/tty || return 1
  [[ "$answer" == y || "$answer" == Y ]]
}
check_running() {
  if ps -axo comm= | awk 'index($0, "/") == 1 && index($0, "/兔子助手.app/Contents/MacOS/") {found=1} END {exit !found}'; then
    fail '兔子助手正在运行，请先完全退出应用，再重新执行安装。'
  fi
}
if ! $VERIFY_ONLY; then
  [[ -n "$INSTALL_DIR" ]] || {
    if [[ -e "$HOME/Applications/$APP_NAME" && ! -e "/Applications/$APP_NAME" ]]; then
      INSTALL_DIR="$HOME/Applications"
    elif [[ -w /Applications || -e "/Applications/$APP_NAME" ]]; then
      INSTALL_DIR=/Applications
    else
      INSTALL_DIR="$HOME/Applications"
    fi
  }
  [[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != / ]] || fail '安装目录必须是绝对路径，不能是根目录。'
  DEST="$INSTALL_DIR/$APP_NAME"
  [[ ! -L "$INSTALL_DIR" && ! -L "$DEST" ]] || fail '安装目录或目标应用是符号链接，请改用普通目录。'
  if [[ -e "$DEST" ]]; then
    [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist" 2>/dev/null || true)" == "$APP_ID" ]] || fail '目标位置有其他应用，停止覆盖。'
    OLD_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist")
    [[ "$OLD_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail '无法识别已安装版本，停止覆盖。'
    if awk -v old="$OLD_VERSION" -v new="$VERSION" 'BEGIN {split(old,a,"."); split(new,b,"."); for(i=1;i<=3;i++) {if(a[i]+0>b[i]+0) exit 0; if(a[i]+0<b[i]+0) exit 1} exit 1}'; then
      fail "已安装较新版本 ${OLD_VERSION}；此脚本不会降级至 ${VERSION}。"
    fi
  fi
  check_running
  printf '即将安装兔子助手 v%s（%s）到：%s\n来源：%s\n' "$VERSION" "$ARCH" "$DEST" "$URL"
  printf '本版本未经 Apple 开发者签名或公证。将校验 SHA-256、应用身份和包内签名完整性。\n旧版应用会备份，账户和作品配置不会被修改。\n'
  confirm '确认下载并安装？' || { printf '\n已取消，未安装。\n'; exit 0; }
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tuzi-install.XXXXXX")
printf '\n正在下载 %s …\n' "$URL"
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --show-error \
  --retry 2 --connect-timeout 20 --max-time 1800 --speed-limit 1024 --speed-time 90 --output "$TMP_DIR/$FILE" "$URL"
printf '%s  %s\n' "$SHA256" "$TMP_DIR/$FILE" | shasum -a 256 -c - || fail '下载文件 SHA-256 不匹配，已停止，未安装。'
mkdir "$TMP_DIR/mount"
# Mark before attaching so cleanup also handles a partially successful attach.
MOUNTED=true
hdiutil attach "$TMP_DIR/$FILE" -readonly -nobrowse -mountpoint "$TMP_DIR/mount" -quiet
SOURCE_APP="$TMP_DIR/mount/$APP_NAME"
[[ -d "$SOURCE_APP" && ! -L "$SOURCE_APP" ]] || fail 'DMG 缺少预期应用。'
PLIST="$SOURCE_APP/Contents/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")" == "$APP_ID" ]] || fail '应用身份不匹配。'
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")" == "$VERSION" ]] || fail '应用版本不匹配。'
EXECUTABLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST")
[[ -n "$EXECUTABLE" && "$EXECUTABLE" != */* && "$EXECUTABLE" != .* ]] || fail '无效的应用可执行文件名。'
# Use the built-in file utility; lipo can require Xcode Command Line Tools.
file -b "$SOURCE_APP/Contents/MacOS/$EXECUTABLE" | grep -Eq "Mach-O.*(^|[^[:alnum:]_])$MACH_ARCH([^[:alnum:]_]|$)" || fail '应用架构不匹配。'
codesign --verify --deep --strict "$SOURCE_APP" || fail '应用签名完整性校验失败，不能通过放行修复。'
printf '下载、SHA-256、应用身份、版本、架构及包内完整性校验通过。\n'
if $VERIFY_ONLY; then printf '仅校验完成：未安装、未移除隔离标记、未启动应用。\n'; exit 0; fi

mkdir -p "$INSTALL_DIR"
[[ -w "$INSTALL_DIR" ]] || fail "目录不可写：${INSTALL_DIR}。可使用 --install-dir \"\$HOME/Applications\"。"
mkdir "$INSTALL_DIR/.tuzi-installer-lock" 2>/dev/null || fail '此目录已有安装任务；如上次异常中断，请确认没有安装进程后移除 .tuzi-installer-lock 空目录。'
LOCK_DIR="$INSTALL_DIR/.tuzi-installer-lock"
STAGE_DIR=$(mktemp -d "$INSTALL_DIR/.tuzi-install.XXXXXX")
ditto "$SOURCE_APP" "$STAGE_DIR/$APP_NAME"
codesign --verify --deep --strict "$STAGE_DIR/$APP_NAME" || fail '复制后的应用完整性校验失败。'
# Downloaded via curl: explicitly quarantine the staged app before asking to
# remove this app's quarantine. A declined prompt leaves the old app untouched.
xattr -w com.apple.quarantine "0083;$(printf '%x' "$(date +%s)");TuziInstaller;" "$STAGE_DIR/$APP_NAME"
printf '\n下一步将仅移除此兔子助手副本的下载隔离标记，绕过其 Gatekeeper 隔离检查。\n这不是 Apple 签名或公证，也不会关闭其他应用的系统检查。\n'
confirm '确认信任此正式仓库安装包并仅放行兔子助手？' || { printf '\n已取消，原应用未改动。可改用 DMG 手动安装。\n'; exit 0; }
xattr -dr com.apple.quarantine "$STAGE_DIR/$APP_NAME" || fail '移除应用隔离标记失败。'
codesign --verify --deep --strict "$STAGE_DIR/$APP_NAME" || fail '最终完整性校验失败。'
hdiutil detach "$TMP_DIR/mount" -quiet
MOUNTED=false
check_running
[[ ! -L "$DEST" ]] || fail '安装期间目标变为符号链接，已停止。'
if [[ -e "$DEST" ]]; then
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist")" == "$APP_ID" ]] || fail '安装期间目标应用身份改变，已停止。'
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist")" == "${OLD_VERSION:-}" ]] || fail '安装期间目标版本改变，请重新运行脚本。'
  BACKUP_DIR=$(mktemp -d "$INSTALL_DIR/.tuzi-backup-$VERSION.XXXXXX")
  mv "$DEST" "$BACKUP_DIR/$APP_NAME"
fi
mv "$STAGE_DIR/$APP_NAME" "$DEST"
printf '\n安装完成：%s\n' "$DEST"
[[ -z "$BACKUP_DIR" ]] || printf '旧版备份：%s/%s\n' "$BACKUP_DIR" "$APP_NAME"
if ! $NO_OPEN; then
  if confirm '现在打开兔子助手？'; then
    open "$DEST" || fail "应用已安装，但启动失败。请从 Finder 打开 $DEST 并保留报错信息。"
  fi
fi
printf '如仍无法打开，请保留系统报错原文；本脚本不能修复应用崩溃或恶意软件警告。\n'
