import React, { useEffect, useState } from "react";
import {
  isPreviewRelease,
  previewPlatforms,
  previewVersion,
} from "./previewRelease";
import "./opentu-preview.css";

export function OpenTuPreviewPage() {
  const [release, setRelease] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(`${import.meta.env.BASE_URL}preview-release.json`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw Error("metadata unavailable");
        return response.json();
      })
      .then((value) => {
        if (!isPreviewRelease(value)) throw Error("invalid metadata");
        setRelease(value);
      })
      .catch(() => setFailed(true))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  return (
    <div className="preview-page">
      <header className="preview-header">
        <a className="preview-brand" href="./">
          <img src="./tuzi-assistant-assets/icon.png" alt="" />
          兔子助手 <span>测试站</span>
        </a>
        <a href="https://tuziapi.github.io/tuzi-switch/">正式版下载 ↗</a>
      </header>
      <main>
        <section className="preview-hero">
          <div>
            <p className="preview-eyebrow">OPENTU PREVIEW / {previewVersion}</p>
            <h1>
              新画布，新助手。
              <br />
              一起把体验打磨好。
            </h1>
            <p className="preview-intro">
              兔子助手测试版现已整合 OpenTu 画布更新、视频讨论与 Claude
              本地兼容功能。下载独立验收版，体验并反馈。
            </p>
            <a className="preview-primary" href="#installers">
              选择测试安装包 ↓
            </a>
            <p className="preview-caption">
              独立安装 · 配置与正式版分开 · 手动更新
            </p>
          </div>
          <aside className="preview-summary">
            <span className="preview-pill">公开测试 · 非正式版本</span>
            <h2>这次可以测试什么</h2>
            <ul>
              <li>画布原位生成、结果恢复与继续编辑</li>
              <li>视频文件操作、关键帧讨论与画布操作</li>
              <li>Claude 模型配置、Code 对话与文件任务</li>
              <li>ChatGPT MCP 配对与画布接入</li>
            </ul>
            <p>模型调用使用你自己配置的线路，可能产生费用。</p>
          </aside>
        </section>
        <section id="installers" className="preview-installers">
          <div className="preview-section-title">
            <div>
              <p className="preview-eyebrow">DOWNLOAD</p>
              <h2>选择你的设备</h2>
            </div>
            <span>版本 {previewVersion}</span>
          </div>
          <p className="preview-muted">
            五个平台从同一份源码构建。构建与包检查通过，不代表各平台全部功能已实机验收。
          </p>
          {!release && (
            <p role="status" className="preview-status">
              {failed
                ? "暂时无法读取经校验的下载清单，请刷新后重试。"
                : "正在核对测试版下载信息…"}
            </p>
          )}
          <div className="preview-grid">
            {previewPlatforms.map((platform) => {
              const item = release?.downloads.find(
                (entry) => entry.platform === platform.id,
              );
              return (
                <article className="preview-card" key={platform.id}>
                  <span className="preview-platform-icon" aria-hidden="true">
                    {platform.id.startsWith("macos")
                      ? "⌘"
                      : platform.id.startsWith("windows")
                        ? "⊞"
                        : "λ"}
                  </span>
                  <h3>{platform.label}</h3>
                  <p>{platform.detail}</p>
                  {item ? (
                    <>
                      <a className="preview-download" href={item.url}>
                        下载 {platform.extension.slice(1).toUpperCase()}{" "}
                        <span>↓</span>
                      </a>
                      <p className="preview-size">
                        {(item.bytes / 1048576).toFixed(1)} MB · 独立测试版
                      </p>
                      <details>
                        <summary>SHA256 校验值</summary>
                        <code>{item.sha256}</code>
                      </details>
                    </>
                  ) : (
                    <button disabled className="preview-download">
                      下载尚未就绪
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
        <section className="preview-notes">
          <div>
            <h2>安装前请看这里</h2>
            <p>
              应用名为「OpenTu 验收版」（Linux 为 OpenTu
              Preview），可与正式兔子助手共存。首次使用需配置自己的账户或模型线路，不会自动复制正式版凭证和作品。
            </p>
            <p>
              本测试版没有 Apple 开发者签名／公证或 Windows Authenticode
              签名，系统可能提示来源未验证。请核对下载来源与摘要，按系统提示决定是否继续。
            </p>
          </div>
          <div>
            <h2>仍在验收的项目</h2>
            <ul>
              <li>
                Claude 普通 Chat／Cowork 需要准备官方客户端与 VM，VM 下载资源约
                1.25 GB，安装阶段曾要求至少 16.1 GB 可用空间。
              </li>
              <li>
                电脑控制、语音、ChatGPT
                客户端完整联调及跨平台实机功能尚未全部验收。
              </li>
              <li>
                Windows ARM64 暂不提供；Linux 高级能力以官方客户端支持范围为限。
              </li>
            </ul>
          </div>
        </section>
        <section className="preview-feedback">
          <h2>测试通过，再走向正式版。</h2>
          <p>
            反馈时请带上系统、芯片架构、版本和复现步骤；请勿提交
            Key、配对令牌或个人会话内容。
          </p>
          <a href="https://github.com/AiW520/tuzi-switch/issues">
            提交测试反馈 ↗
          </a>
        </section>
      </main>
      <footer className="preview-footer">
        <span>兔子助手 · OpenTu 测试版</span>
        {release && (
          <nav>
            <a href={release.releaseUrl}>发布说明</a>
            <a href={release.sourceUrl}>对应源码</a>
            <span>源码 {release.commit.slice(0, 8)}</span>
          </nav>
        )}
      </footer>
    </div>
  );
}
