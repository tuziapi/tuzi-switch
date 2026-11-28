import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { settingsApi } from "@/lib/api/settings";

export type Website = "direct" | "shop";
const urls = {
  direct: "https://web.tu-zi.com/login",
  shop: "https://store.tu-zi.com/",
};
// Serialize show/hide/resize across route changes and StrictMode remounts.
let pending: Promise<unknown> = Promise.resolve();
export function syncSite(args: Record<string, unknown>) {
  const next = pending
    .catch(() => {})
    .then(() => invoke("sync_embedded_site", args));
  pending = next;
  return next;
}

export function EmbeddedSite({ site }: { site: Website | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [covered, setCovered] = useState(false);
  const [retry, setRetry] = useState(0);
  const native = isTauri();

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const subscription = listen<{ site: Website; loading: boolean }>(
      "embedded-site-load",
      (event) => {
        if (!disposed && event.payload.site === site)
          setLoading(event.payload.loading);
      },
    );
    return () => {
      disposed = true;
      void subscription.then((stop) => stop());
    };
  }, [native, site]);

  useEffect(() => {
    setError("");
    setLoading(false);
    if (!native) return;
    if (!site) {
      void syncSite({ site: null, bounds: null }).catch(() => {});
      return;
    }
    let disposed = false;
    let frame = 0;
    let last = "";
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = host.current?.getBoundingClientRect();
        // Native child views are above DOM overlays. Hide them while menus,
        // dialogs or the environment warning are visible, then restore in place.
        const covered = !!document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-env-warning]',
        );
        setCovered(covered);
        const args =
          site &&
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          !covered &&
          !document.hidden
            ? {
                site,
                bounds: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              }
            : { site: null, bounds: null };
        const key = JSON.stringify(args);
        if (key === last) return;
        last = key;
        void syncSite(args).catch(() => {
          if (!disposed) setError("网站加载失败，请重试或在浏览器中打开。");
        });
      });
    };
    const resize = new ResizeObserver(update);
    if (host.current) resize.observe(host.current);
    const overlays = new MutationObserver(update);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "data-state"],
    });
    window.addEventListener("resize", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
      void syncSite({ site: null, bounds: null }).catch(() => {});
    };
  }, [native, site, retry]);

  if (!site) return null;
  const action = (action: string) => {
    setError("");
    void invoke("embedded_site_action", { site, action }).catch(() =>
      setError("操作失败，请重试。"),
    );
  };
  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-background"
      aria-label={site === "direct" ? "直连站页面" : "兔小店页面"}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-5 text-xs text-muted-foreground">
        <button
          aria-label="网页后退"
          className="rounded-md p-2 hover:bg-muted"
          disabled={!native}
          onClick={() => action("back")}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          aria-label="刷新网页"
          className="rounded-md p-2 hover:bg-muted"
          disabled={!native}
          onClick={() => action("reload")}
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="min-w-0 truncate">{new URL(urls[site]).hostname}</span>
        <span className="ml-auto hidden whitespace-nowrap sm:inline">
          {loading
            ? "正在加载…"
            : site === "shop"
              ? "登录时勾选“保持会话”"
              : "登录状态保存在本机"}
        </span>
        <button
          className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md p-2 hover:bg-muted sm:ml-0"
          onClick={() =>
            void settingsApi
              .openExternal(urls[site])
              .catch(() => setError("无法打开浏览器。"))
          }
        >
          <ExternalLink size={14} />
          浏览器打开
        </button>
      </div>
      {error && (
        <div
          role="status"
          className="flex items-center gap-3 bg-muted px-5 py-2 text-sm"
        >
          {error}
          <button
            className="underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {!native
            ? "请在兔子助手桌面应用中使用内嵌网站"
            : covered
              ? "关闭菜单或弹窗后继续浏览"
              : error
                ? "网站暂不可用"
                : loading
                  ? "正在加载网站…"
                  : "网站视图"}
        </div>
      </div>
    </section>
  );
}
