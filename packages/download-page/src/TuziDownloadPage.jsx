/* Copyright (C) 2025 QuantumNous. Licensed under AGPL-3.0-or-later. */
import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Github,
  LayoutGrid,
  Moon,
  PanelLeftClose,
  Settings2,
  Sparkles,
  Sun,
  Terminal,
  Unplug,
} from "lucide-react";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa6";
import { isStableRelease, repository } from "./stableRelease";
import { macosInstallCommand } from "./macosInstaller";
import "./tuzi-download.css";

const pageSource =
  import.meta.env.VITE_DOWNLOAD_SOURCE_URL ||
  `https://github.com/${repository}/tree/main/packages/download-page`;
const SOURCE = `https://github.com/${repository}`;
const manualInstallOnly = import.meta.env.VITE_MANUAL_INSTALL_ONLY === "true";
const screens = [
  {
    id: "tools",
    label: "工具管理",
    image: "tools.png",
    icon: LayoutGrid,
    title: "常用工具，各就各位。",
    text: "集中管理工具供应商、MCP 与提示词，让配置更有条理。",
  },
  {
    id: "projects",
    label: "opentu 创作",
    image: "projects.png",
    icon: Sparkles,
    title: "收起配置，展开灵感。",
    text: "进入创作空间，助手导航自动收起；项目与自由画布留在同一个窗口。",
  },
  {
    id: "configuration",
    label: "统一配置",
    image: "configuration.png",
    icon: Settings2,
    title: "沿用配置，也保留选择。",
    text: "关联兔子账户中的模型 Key，或手动填写接口与 Key；创作配置统一放在左侧入口。",
  },
];
const platforms = [
  { id: "macos", label: "macOS", icon: FaApple },
  { id: "windows", label: "Windows", icon: FaWindows },
  { id: "linux", label: "Linux", icon: FaLinux },
];
const faqs = [
  [
    "Mac 提示无法验证开发者或应用打不开怎么办？",
    "此版本未经 Apple 开发者签名或公证。可使用下方 macOS 安装脚本：自动识别芯片、校验正式安装包，在你确认后仅放行兔子助手。也可在确认来源可信后，通过系统设置 → 隐私与安全性 → 仍要打开。若提示恶意软件或启动后闪退，请保留报错信息进一步排查。",
  ],
  [
    "现在下载的版本包含 opentu 吗？",
    "包含。下载兔子助手即可使用工具管理、兔子账户、opentu 项目与自由画布，无需再安装另一款创作客户端。",
  ],
  [
    "已有兔子账户，还需要重复填写 Key 吗？",
    "已连接的兔子账户可继续使用，创作时选择账户中的模型 Key，或使用手动配置。首次使用请先连接账户；账户管理令牌与模型 Key 用途不同。",
  ],
  [
    "如何选择适合自己电脑的安装包？",
    "macOS 请在“关于本机”中确认 Apple Silicon 或 Intel。Windows 提供 x86_64 的 EXE 和 MSI，Linux 提供 DEB、RPM 和 AppImage。点击直接下载安装文件，无需登录 GitHub 或解压 ZIP。",
  ],
  [
    "旧版 opentu 的作品可以直接迁移吗？",
    "完整的旧版数据迁移仍在验收中。请保留旧客户端与原始数据，先导出备份，不要直接覆盖或复制数据库目录。",
  ],
];
function detectPlatform() {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent;
  if (
    /Android|iPhone|iPad/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
  )
    return "windows";
  if (/Mac/i.test(ua)) return "macos";
  return /Linux/i.test(ua) ? "linux" : "windows";
}
export function useRelease() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    loading: true,
    release: null,
    error: false,
  });
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setAttempt((v) => v + 1);
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 15 * 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 18000);
    setState({ loading: true, release: null, error: false });
    fetch(`${import.meta.env.BASE_URL}release.json`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Release unavailable");
        const release = await response.json();
        if (!isStableRelease(release)) throw new Error("Invalid release");
        if (!disposed) setState({ loading: false, release, error: false });
      })
      .catch(() => {
        if (!disposed) setState({ loading: false, release: null, error: true });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

// Shared by standalone HTML and the existing in-site route; no separate release logic.
export function TuziDownloadView({
  t = (text) => text,
  compact = false,
  standalone = false,
}) {
  const ids = useId().replace(/:/g, "");
  const anchor = (name) => `td-${ids}-${name}`;
  const [screen, setScreen] = useState(0);
  const [platform, setPlatform] = useState(detectPlatform);
  const [packageId, setPackageId] = useState("deb");
  const [copied, setCopied] = useState({});
  const [dark, setDark] = useState(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const { release, loading, error, retry } = useRelease();
  const installCommand = macosInstallCommand(release);
  const pinnedInstallCommand = macosInstallCommand(release, { pinned: true });
  const tracker = useRef(null),
    trackerReady = useRef(false),
    events = useRef([]),
    copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (!standalone) return;
    const receive = (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== window.parent ||
        event.source === window
      )
        return;
      if (["dark", "light"].includes(event.data?.themeMode))
        setDark(event.data.themeMode === "dark");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [standalone]);
  const downloads = release?.downloads || [];
  const choices = downloads.filter((item) =>
    platform === "macos"
      ? ["macos", "macos-intel"].includes(item.id)
      : platform === "windows"
        ? ["windows", "msi"].includes(item.id)
        : ["deb", "rpm", "appimage"].includes(item.id),
  );
  const selected = choices.find((item) => item.id === packageId) || choices[0];
  const current = screens[screen];
  const PlatformIcon = platforms.find((item) => item.id === platform).icon;
  const track = (item) => {
    const message = {
      type: "tuzi-download-click",
      platform: item.id,
      version: release.tag,
    };
    if (trackerReady.current && tracker.current?.contentWindow)
      tracker.current.contentWindow.postMessage(message, location.origin);
    else if (events.current.length < 20) events.current.push(message);
  };
  const trackerLoaded = () => {
    trackerReady.current = true;
    events.current
      .splice(0)
      .forEach((message) =>
        tracker.current?.contentWindow?.postMessage(message, location.origin),
      );
  };
  const copy = async (key, command) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied({ key, message: t("已复制") });
    } catch {
      setCopied({ key, message: t("复制失败，请手动复制") });
    }
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied({}), 3500);
  };
  const external = { target: "_blank", rel: "noopener noreferrer" };
  return (
    <div
      className={`tuzi-download ${compact ? "is-compact" : ""} ${!standalone && !compact ? "is-site-page" : ""}`}
      data-theme={standalone ? (dark ? "dark" : "light") : undefined}
    >
      <iframe
        ref={tracker}
        src={`${import.meta.env.BASE_URL}tuzi-download-analytics.html`}
        title={t("下载统计")}
        hidden
        tabIndex={-1}
        onLoad={trackerLoaded}
        referrerPolicy="no-referrer"
      />
      <a className="td-skip" href={`#${anchor("downloads")}`}>
        {t("跳到下载区域")}
      </a>
      <div className="td-shell">
        <header className="td-header">
          <a
            className="td-brand"
            href={`#${anchor("top")}`}
            aria-label={t("兔子助手首页")}
          >
            <span className="td-logo">
              <img
                className="td-brand-icon"
                src={`${import.meta.env.BASE_URL}tuzi-assistant-assets/icon.png`}
                alt=""
              />
            </span>
            <span>
              {t("兔子助手")}
              <small>TUZI ASSISTANT</small>
            </span>
          </a>
          <nav className="td-nav" aria-label={t("页面导航")}>
            <a href={`#${anchor("workspace")}`}>{t("工作区")}</a>
            <a href={`#${anchor("downloads")}`}>{t("下载安装")}</a>
            <a href={`#${anchor("faq")}`}>{t("常见问题")}</a>
          </nav>
          <div className="td-header-actions">
            {standalone && (
              <button
                className="td-icon-button"
                aria-label={dark ? t("切换到浅色") : t("切换到深色")}
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}
            <a href={SOURCE} {...external} className="td-source">
              <Github size={18} />
              <span>GitHub</span>
              <ArrowUpRight size={13} />
            </a>
          </div>
        </header>
        <main id={anchor("top")}>
          <section className="td-hero" aria-labelledby={anchor("title")}>
            <div className="td-hero-copy">
              <p className="td-eyebrow">
                <span />
                {t("一个桌面，更多可能")}
              </p>
              <h1 id={anchor("title")}>
                {t("工具与灵感，")}
                <br />
                <em>{t("在一个桌面相遇。")}</em>
              </h1>
              <p className="td-intro">
                {t("从 AI 工具管理，到 opentu 自由创作。")}
                <br className="td-desktop-break" />
                {t("把常用配置和灵感，放进同一个兔子助手。")}
              </p>
              <div className="td-hero-actions">
                <a
                  className="td-button td-button-primary"
                  href={`#${anchor("downloads")}`}
                >
                  <ArrowDownToLine size={18} />
                  {t("下载兔子助手")}
                </a>
                <a className="td-text-link" href={`#${anchor("workspace")}`}>
                  {t("探索统一工作区")}
                  <ArrowRight size={17} />
                </a>
              </div>
              <p className="td-hero-note">
                macOS · Windows · Linux<span> / </span>
                {t("已包含 opentu 创作")}
              </p>
            </div>
            <div className="td-hero-art" aria-hidden="true">
              <div className="td-art-orbit td-orbit-one" />
              <div className="td-art-orbit td-orbit-two" />
              <div className="td-art-label td-art-tools">
                <LayoutGrid size={18} />
                <span>{t("工具管理")}</span>
              </div>
              <div className="td-art-label td-art-creative">
                <Sparkles size={18} />
                <span>opentu {t("创作")}</span>
              </div>
              <div className="td-art-center">
                <img
                  className="td-brand-icon"
                  src={`${import.meta.env.BASE_URL}tuzi-assistant-assets/icon.png`}
                  alt=""
                />
              </div>
              <span className="td-art-caption">ONE PLACE. YOUR SPACE.</span>
              <span className="td-art-plus td-plus-one">+</span>
              <span className="td-art-plus td-plus-two">+</span>
            </div>
          </section>
          <section
            className="td-workspace"
            id={anchor("workspace")}
            aria-label={t("统一工作区预览")}
          >
            <div className="td-workspace-bar">
              <div
                className="td-screen-tabs"
                role="tablist"
                aria-label={t("产品画面")}
              >
                {screens.map((item, index) => (
                  <button
                    key={item.id}
                    role="tab"
                    id={anchor(`tab-${item.id}`)}
                    aria-selected={screen === index}
                    aria-controls={anchor("screen")}
                    tabIndex={screen === index ? 0 : -1}
                    onClick={() => setScreen(index)}
                    onKeyDown={(event) => {
                      let next;
                      if (event.key === "ArrowRight")
                        next = (index + 1) % screens.length;
                      if (event.key === "ArrowLeft")
                        next = (index + screens.length - 1) % screens.length;
                      if (event.key === "Home") next = 0;
                      if (event.key === "End") next = screens.length - 1;
                      if (next !== undefined) {
                        event.preventDefault();
                        setScreen(next);
                        document
                          .getElementById(anchor(`tab-${screens[next].id}`))
                          ?.focus();
                      }
                    }}
                  >
                    <item.icon size={16} />
                    {t(item.label)}
                  </button>
                ))}
              </div>
              <span className="td-preview-badge">
                <span />
                {t("统一客户端")}
              </span>
            </div>
            <div
              className="td-screen-panel"
              role="tabpanel"
              id={anchor("screen")}
              aria-labelledby={anchor(`tab-${current.id}`)}
              tabIndex={0}
            >
              <img
                src={`${import.meta.env.BASE_URL}tuzi-assistant-assets/${current.image}`}
                width="1180"
                height="800"
                alt={t(current.title)}
                decoding="async"
              />
            </div>
            <div className="td-screen-caption">
              <div>
                <strong>{t(current.title)}</strong>
                <p>{t(current.text)}</p>
              </div>
              <span>
                0{screen + 1}
                <small> / 03</small>
              </span>
            </div>
            <p className="td-preview-note">
              {t(
                "画面使用示例数据，下载兔子助手即可体验工具管理与 opentu 创作。",
              )}
            </p>
          </section>
          <section className="td-benefits" aria-labelledby={anchor("benefits")}>
            <div className="td-section-heading">
              <p className="td-eyebrow">MADE FOR YOUR FLOW</p>
              <h2 id={anchor("benefits")}>{t("少一点切换，多一点专注。")}</h2>
              <p>{t("熟悉的工具管理，加上更开阔的创作空间。")}</p>
            </div>
            <div className="td-benefit-grid">
              <article>
                <span className="td-feature-icon">
                  <LayoutGrid size={23} />
                </span>
                <span className="td-feature-index">01 / TOOLS</span>
                <h3>{t("工具配置，集中管理")}</h3>
                <p>
                  {t(
                    "Claude Code、Codex、Gemini CLI 等常用工具，连同供应商、MCP 与提示词，都有清晰的入口。",
                  )}
                </p>
                <div className="td-tool-names">
                  <span>Claude Code</span>
                  <span>Codex</span>
                  <span>Gemini CLI</span>
                </div>
              </article>
              <article>
                <span className="td-feature-icon">
                  <PanelLeftClose size={23} />
                </span>
                <span className="td-feature-index">02 / CREATE</span>
                <h3>{t("进入创作，画布展开")}</h3>
                <p>
                  {t(
                    "助手侧栏向上收起，项目与画布自然接续。随时返回工具管理，不用再开另一个客户端。",
                  )}
                </p>
                <div className="td-mini-flow">
                  <span>{t("兔子助手")}</span>
                  <ArrowRight size={15} />
                  <span>opentu</span>
                </div>
              </article>
              <article>
                <span className="td-feature-icon">
                  <Unplug size={23} />
                </span>
                <span className="td-feature-index">03 / CONNECT</span>
                <h3>{t("账户关联，手动也可以")}</h3>
                <p>
                  {t(
                    "从兔子账户选择模型 Key，沿用已有供应商配置。需要接入其他服务时，也能手动填写。",
                  )}
                </p>
                <div className="td-config-tags">
                  <span>
                    <Check size={13} />
                    {t("账户关联")}
                  </span>
                  <span>
                    <Check size={13} />
                    {t("手动配置")}
                  </span>
                </div>
              </article>
            </div>
          </section>
          <section
            className="td-download-section"
            id={anchor("downloads")}
            aria-labelledby={anchor("download-title")}
          >
            <div className="td-download-intro">
              <p className="td-eyebrow">READY WHEN YOU ARE</p>
              <h2 id={anchor("download-title")}>{t("从你的桌面开始。")}</h2>
              <p>{t("下载包含 opentu 的兔子助手，选择适合电脑的安装包。")}</p>
              <div className="td-release-status" role="status">
                <span className={error || release?.stale ? "is-stale" : ""} />
                {loading
                  ? t("正在获取版本…")
                  : release
                    ? `兔子助手 ${release.tag}`
                    : t("版本暂时无法获取")}
              </div>
              <p className="td-release-boundary">
                {t("工具管理、兔子账户与 opentu 创作，一个客户端即可使用。")}
              </p>
            </div>
            <div className="td-download-box">
              {platform === "macos" && (
                <p className="td-preview-note">
                  {t(
                    installCommand
                      ? "macOS：终端安装会自动识别芯片；也可选择下方安装包手动安装。"
                      : "macOS：请先退出旧版，将 DMG 中的兔子助手拖入“应用程序”并替换，再从“应用程序”打开。",
                  )}
                </p>
              )}
              <div
                className="td-platform-picker"
                role="group"
                aria-label={t("选择操作系统")}
              >
                {platforms.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={platform === item.id}
                    onClick={() => setPlatform(item.id)}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="td-package-heading">
                <span className="td-os-icon">
                  <PlatformIcon size={30} />
                </span>
                <div>
                  <h3>
                    {platforms.find((item) => item.id === platform).label}
                  </h3>
                  <p>
                    {selected?.subtitle ||
                      (platform === "macos"
                        ? "Apple Silicon / Intel"
                        : "Intel / AMD · x86_64")}
                  </p>
                </div>
                {selected && (
                  <span className="td-format">{selected.format}</span>
                )}
              </div>
              {platform === "macos" && installCommand && (
                <div className="td-terminal">
                  <div className="td-terminal-heading">
                    <span className="td-terminal-title">
                      <Terminal size={18} />
                      {t("终端一键安装")}
                    </span>
                    <small>{t("自动识别 Apple 芯片 / Intel")}</small>
                  </div>
                  {[
                    ["current", t("安装当前版本"), installCommand],
                    [
                      "pinned",
                      `${t("指定版本")} ${release.tag}`,
                      pinnedInstallCommand,
                    ],
                  ].map(([key, label, command]) => (
                    <div className="td-terminal-command" key={key}>
                      <div className="td-terminal-heading">
                        <span>{label}</span>
                        <button
                          onClick={() => copy(key, command)}
                          aria-label={`${t("复制")}${label}`}
                        >
                          <Copy size={14} />
                          {copied.key === key ? copied.message : t("复制命令")}
                        </button>
                      </div>
                      <pre tabIndex={0}>
                        <code>{command}</code>
                      </pre>
                    </div>
                  ))}
                  <div className="td-terminal-footer">
                    <p>
                      {t("粘贴到终端，按提示确认。当前支持：")} {release.tag}
                    </p>
                    <a
                      href={release.macosInstaller.href}
                      download={`install-macos-${release.tag}.sh`}
                    >
                      {t("查看脚本")}
                    </a>
                  </div>
                  <span className="td-copy-status" role="status">
                    {copied.message}
                  </span>
                </div>
              )}
              {choices.length > 1 && (
                <label className="td-package-select">
                  {t(platform === "macos" ? "芯片类型" : "安装格式")}
                  <select
                    value={selected.id}
                    onChange={(event) => setPackageId(event.target.value)}
                  >
                    {choices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {platform === "macos"
                          ? item.subtitle
                          : `${item.format} · ${item.subtitle}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {error ? (
                <div className="td-download-error" role="alert">
                  <p>{t("安装包暂时无法获取，请重试或查看版本发布页。")}</p>
                  <button onClick={retry}>{t("重新获取")}</button>
                </div>
              ) : selected ? (
                <a
                  className="td-button td-download-link"
                  href={selected.href}
                  {...external}
                  onClick={() => track(selected)}
                  onAuxClick={(event) => {
                    if (event.button === 1) track(selected);
                  }}
                >
                  <ArrowDownToLine size={18} />
                  {t("下载兔子助手")} {release.tag}
                  <ArrowUpRight size={17} />
                </a>
              ) : (
                <button className="td-button td-download-link" disabled>
                  {loading ? t("正在获取安装包…") : t("此版本暂无对应安装包")}
                </button>
              )}
              <p className="td-package-note">
                {platform === "macos"
                  ? t(
                      "请在“关于本机”中确认芯片类型，下载后打开 DMG，将兔子助手拖入“应用程序”。",
                    )
                  : platform === "windows"
                    ? t(
                        "下载后双击 EXE 或 MSI，按提示安装。适用于 Intel / AMD 64 位电脑。",
                      )
                    : t(
                        "选择 DEB、RPM 或 AppImage；DEB 适合 Debian / Ubuntu。",
                      )}
              </p>
              <p className="td-cache-notice">
                {platform === "macos"
                  ? t(
                      installCommand
                        ? "Mac 版未经 Apple 开发者签名或公证。如被系统拦截，可使用上方终端安装，确认后仅放行兔子助手。"
                        : "Mac 版未经 Apple 开发者签名或公证，系统可能提示无法验证发布者。",
                    )
                  : t("安装包尚未进行开发者签名，系统可能提示无法验证发布者。")}
              </p>
              {manualInstallOnly && (
                <p className="td-cache-notice">
                  {t(
                    installCommand
                      ? "此版本请下载安装包或使用 Mac 安装脚本；应用内自动更新暂不可用。"
                      : "此版本请下载后手动安装；应用内自动更新暂不可用。",
                  )}
                </p>
              )}
              {release?.stale && (
                <p className="td-cache-notice" role="status">
                  {t("版本同步暂不可用，当前为上次确认的版本。")}
                </p>
              )}
              <a
                className="td-release-link"
                href={release?.sourceUrl || `${SOURCE}/releases`}
                {...external}
              >
                {t("查看更新说明与全部安装包")}
                <ArrowUpRight size={14} />
              </a>
            </div>
          </section>
          <section
            className="td-faq"
            id={anchor("faq")}
            aria-labelledby={anchor("faq-title")}
          >
            <div>
              <p className="td-eyebrow">A FEW THINGS TO KNOW</p>
              <h2 id={anchor("faq-title")}>
                {t("开始之前，")}
                <br />
                {t("你可能想知道。")}
              </h2>
            </div>
            <div className="td-faq-list">
              {faqs.map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {t(question)}
                    <ChevronDown size={17} />
                  </summary>
                  <p>{t(answer)}</p>
                </details>
              ))}
            </div>
          </section>
        </main>
        <footer className="td-footer">
          <span>
            <img
              className="td-brand-icon"
              src={`${import.meta.env.BASE_URL}tuzi-assistant-assets/icon.png`}
              alt=""
            />
            <strong>{t("兔子助手")}</strong>
            <span>{t("让工具顺手，让灵感自由。")}</span>
          </span>
          <a href={SOURCE} {...external}>
            GitHub <ArrowUpRight size={13} />
          </a>
          <a href={pageSource} {...external}>
            页面源码 · AGPL-3.0
          </a>
        </footer>
      </div>
    </div>
  );
}
export default function TuziDownloadPage(props) {
  const { t } = useTranslation();
  return <TuziDownloadView {...props} t={t} />;
}
