// Isolated UI preview. No production credentials, model requests or shared browser storage.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { EcommerceWorkbench } from "../src/EcommerceWorkbench";
import "../src/ecommerce-workbench.css";

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.href,
  );
  if (
    url.origin !== location.origin &&
    !["blob:", "data:"].includes(url.protocol)
  )
    return Promise.reject(
      new Error("这是界面预览，未连接付费模型。请在桌面测试版生成。"),
    );
  return nativeFetch(input, init);
};
function Preview() {
  const [dark, setDark] = useState(false);
  return (
    <div
      className="creative-root"
      data-theme={dark ? "dark" : "light"}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          padding: "9px 22px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: dark ? "#282c28" : "#eef2eb",
          color: dark ? "#eee" : "#455142",
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        <span>
          <strong>电商创作 · B 方案</strong>　交互预览 · 可切换模型、素材与数量
          · 未连接付费服务
        </span>
        <button
          style={{
            background: "transparent",
            border: "1px solid currentColor",
            color: "inherit",
            borderRadius: 5,
            padding: "4px 8px",
            cursor: "pointer",
          }}
          onClick={() => setDark(!dark)}
        >
          切换{dark ? "浅色" : "深色"}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EcommerceWorkbench />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
