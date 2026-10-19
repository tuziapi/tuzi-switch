// Visual-only fixture: actual cards with synthetic data; all native calls mocked.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ProviderCard } from "@/components/providers/ProviderCard";
import i18n from "@/i18n";
import "@/index.css";
void i18n.changeLanguage("zh");
mockIPC(() => null);
const noop = () => {};
const systemFace =
  "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;";
const variants = [
  [
    "baseline",
    "原样：系统字体 / 16px / 600",
    systemFace + "font-weight:600;font-size:16px",
  ],
  [
    "medium",
    "仅改字重：系统字体 / 16px / 500",
    systemFace + "font-weight:500;font-size:16px",
  ],
  [
    "pingfang",
    "显式中文字体：苹方 / 16px / 500",
    'font-family:"PingFang SC",sans-serif;font-weight:500;font-size:16px',
  ],
  [
    "size17",
    "仅改字号：系统字体 / 17px / 500",
    systemFace + "font-weight:500;font-size:17px",
  ],
  [
    "pingfang17",
    "苹方 / 17px / 500",
    'font-family:"PingFang SC",sans-serif;font-weight:500;font-size:17px',
  ],
];
function Page() {
  const [width, setWidth] = useState("100%");
  const [long, setLong] = useState(false);
  const name = long
    ? "兔子线路-我的配置-长名称布局检查-Claude Codex Gemini"
    : "兔子线路-我的配置";
  return (
    <main className="p-6 space-y-5">
      <h1>供应商标题字形对照 · 合成数据</h1>
      <div className="flex gap-5">
        <label>
          卡片宽度{" "}
          <select value={width} onChange={(e) => setWidth(e.target.value)}>
            <option>100%</option>
            <option>600px</option>
            <option>360px</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={long}
            onChange={(e) => setLong(e.target.checked)}
          />{" "}
          长名称
        </label>
        <button
          onClick={() => document.documentElement.classList.toggle("dark")}
        >
          切换深浅主题
        </button>
      </div>
      <style>
        {variants
          .map(
            ([id, , css]) =>
              `.${id} h3,.${id} .reference{${css};line-height:24px}`,
          )
          .join("\n")}
      </style>
      {variants.map(([id, label]) => (
        <section
          key={id}
          className={`${id} space-y-2`}
          style={{ width, maxWidth: "100%" }}
        >
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="reference" style={{ overflow: "visible", margin: 0 }}>
            {name}
          </p>
          <ProviderCard
            provider={{
              id: `synthetic-title-${id}`,
              name,
              icon: "tuzi",
              category: "aggregator",
              settingsConfig: {
                config: 'base_url = "https://api.tu-zi.com/v1"',
                auth: { OPENAI_API_KEY: "sk-SYNTHETIC-TITLE-ONLY" },
              },
            }}
            appId="codex"
            isCurrent={false}
            isProxyRunning={false}
            onSwitch={noop}
            onEdit={noop}
            onDelete={noop}
            onConfigureUsage={noop}
            onOpenWebsite={noop}
            onDuplicate={noop}
          />
        </section>
      ))}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Page />
  </QueryClientProvider>,
);
