// Synthetic display fixture: no model requests, credentials or persisted jobs.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EcommerceBatchPanel } from "../../packages/creative-workspace/src/EcommerceBatchPanel";
import type { EcommerceBatch } from "../../packages/creative-workspace/src/ecommerce-jobs";
import "../../packages/creative-workspace/dist/creative-workspace.css";

const labels = [
  "首屏主视觉",
  "核心卖点图",
  "使用场景图",
  "多角度图",
  "效果对比图",
];
const urls = Object.fromEntries(
  labels.map((_, i) => [
    String(i),
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${["#e7ddcc", "#e5d3be", "#d5ddd1", "#d9dbdf", "#dcd5cc"][i]}"/><ellipse cx="48" cy="82" rx="28" ry="5" fill="#b7aa97" opacity=".3"/><path d="M67 36h7c18 0 18 29 0 29h-7" fill="none" stroke="#faf5e7" stroke-width="8"/><path d="M23 29h46v40q0 13-23 13T23 69Z" fill="#faf5e7"/><ellipse cx="46" cy="29" rx="23" ry="7" fill="#cdbfa7"/></svg>`)}`,
  ]),
);
const batch: EcommerceBatch = {
  version: 1,
  id: "synthetic-visual",
  createdAt: 1795420800000,
  title: "AI 商品套图",
  tool: "product-set",
  modelRef: { profileId: null, modelId: "gpt-image-2.5-1k" },
  owner: null,
  size: "1024x1024",
  references: [],
  items: labels.map((label, i) => ({
    id: String(i),
    label,
    prompt: "SYNTHETIC",
    status: "complete",
    image: new Blob(["synthetic"], { type: "image/png" }),
    attempts: [
      {
        requestId: `synthetic-request-${i}`,
        stage: "saving",
        startedAt: 1795420800000,
        endedAt: 1795420846000,
        httpStatus: 200,
      },
    ],
  })),
};
function Preview() {
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [scenario, setScenario] = useState("complete");
  const [selected, setSelected] = useState("0");
  const [notice, setNotice] = useState("");
  const items = batch.items.map((item, i) =>
    scenario === "complete" || i < 2
      ? item
      : {
          ...item,
          image: undefined,
          status:
            i === 2
              ? scenario === "running"
                ? ("running" as const)
                : ("unknown" as const)
              : ("pending" as const),
          error:
            i === 2 && scenario === "failed"
              ? "等待已超时，请核对调用记录后再重试这一张。"
              : undefined,
          attempts:
            i === 2
              ? [
                  {
                    ...item.attempts[0],
                    stage: "sending" as const,
                    httpStatus: undefined,
                    endedAt: undefined,
                  },
                ]
              : [],
        },
  );
  return (
    <main
      className="creative-root"
      data-theme={dark ? "dark" : "light"}
      style={{
        minHeight: "100vh",
        padding: "28px",
        boxSizing: "border-box",
        background: dark ? "#191d19" : "#f7f7f5",
        color: dark ? "#eee" : "#262b27",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "14px",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <strong>图片记录 · 合成样式验收</strong>
        <button onClick={() => setDark(!dark)}>切换深浅色</button>
        <button onClick={() => setNarrow(!narrow)}>切换窄窗口</button>
        <select
          aria-label="演示状态"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        >
          <option value="complete">全部完成</option>
          <option value="running">逐张生成中</option>
          <option value="failed">失败与未发送</option>
        </select>
      </div>
      <div style={{ maxWidth: narrow ? 360 : 1180 }}>
        <EcommerceBatchPanel
          batch={{ ...batch, items }}
          busy={scenario === "running"}
          selectedItemId={selected}
          previewUrls={Object.fromEntries(
            items.filter((i) => i.image).map((i) => [i.id, urls[i.id]]),
          )}
          onPreview={(id) => {
            setSelected(id);
            setNotice(`查看：${labels[Number(id)]}`);
          }}
          onSave={(_, name) => setNotice(`保存：${name}`)}
          onResume={() => setNotice("继续未发送的图片")}
          onRetry={(id) => setNotice(`重试：${labels[Number(id)]}`)}
          history={
            <label className="ecommerce-history">
              生成记录
              <select aria-label="生成记录">
                <option>
                  2026/11/23 17:45 ·{" "}
                  {items.filter((item) => item.status === "complete").length}/5
                  张
                </option>
              </select>
            </label>
          }
        />
      </div>
      <p role="status">{notice}</p>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
