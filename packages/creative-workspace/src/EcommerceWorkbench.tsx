import { useMemo, useState } from "react";
import { Check, ImagePlus, LayoutTemplate, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import type { CreativeAccountBridge } from "./bridge-types";
import "./ecommerce-workbench.css";

const modules = [
  ["首屏主视觉", "传递核心价值", true],
  ["核心卖点图", "突出差异化优势", true],
  ["使用场景图", "呈现真实使用场景", true],
  ["多角度图", "多角度呈现外观", true],
  ["效果对比图", "展示使用前后差异", true],
  ["品牌故事图", "传递品牌价值", false],
  ["工艺制作图", "展示工艺制作过程", false],
  ["尺寸尺码图", "展示规格信息", false],
  ["规格/参数表", "展示详细商品数据", false],
  ["配件/赠品图", "明确收货所有物品", false],
  ["系列展示图", "多色或多 SKU 展示", false],
  ["售后保障图", "说明质保退换政策", false],
] as const;

type Props = { accountBridge?: CreativeAccountBridge };

export function EcommerceWorkbench({ accountBridge }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [platform, setPlatform] = useState("亚马逊");
  const [language, setLanguage] = useState("英文");
  const [ratio, setRatio] = useState("高级 A+（Web端）");
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState(() => new Set(modules.filter(([, , on]) => on).map(([name]) => name)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [tool, setTool] = useState("商品套图");
  const [template, setTemplate] = useState(0);
  const previews = useMemo(() => files.map(file => URL.createObjectURL(file)), [files]);

  const toggle = (name: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const generate = async () => {
    if (!files.length || busy) return;
    setBusy(true); setError(""); setResult(null);
    try {
      if (!accountBridge?.request || !accountBridge.selectedKeyId) throw new Error("请先在创作配置中选择账户 API Key。");
      const body = new FormData();
      body.append("model", "seedream-4-0-250828");
      body.append("prompt", [
        `生成${platform}电商${ratio}商品详情图`,
        `语言：${language}`,
        prompt.trim() || "保持商品外观准确，突出材质、卖点和真实使用场景",
        `模块：${Array.from(selected).join("、")}`,
      ].join("。"));
      body.append("size", "2048x2048");
      for (const file of files.slice(0, 3)) body.append("image", file, file.name);
      const response = await accountBridge.request(`tuzi-account:${accountBridge.selectedKeyId}`, "https://api.tu-zi.com/v1/images/edits", { method: "POST", body });
      if (!response.ok) throw new Error(`生成失败（HTTP ${response.status}）`);
      const data = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> };
      const item = data.data?.[0];
      if (!item?.url && !item?.b64_json) throw new Error("模型未返回可预览图片。");
      setResult(item.url ?? `data:image/png;base64,${item.b64_json}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败，请稍后重试。");
    } finally { setBusy(false); }
  };

  return <section className="ecommerce-workbench" aria-label="电商生图工作台">
    <nav className="ecommerce-tool-tabs" aria-label="商品工具类型">{["商品套图", "A+/详情页", "爆款复刻", "产品精修", "产品换色", "白底精修"].map(name => <button key={name} className={tool === name ? "is-active" : ""} onClick={() => setTool(name)}><LayoutTemplate size={14} />{name}</button>)}</nav>
    <aside className="ecommerce-workbench__rail"><div className="ecommerce-workbench__rail-title">创作类型</div><button className="is-active"><ImagePlus size={16} />商品图片</button><button><Sparkles size={16} />营销海报</button><button><Upload size={16} />素材变体</button></aside>
    <main className="ecommerce-workbench__main">
      <div className="ecommerce-workbench__heading"><div><span className="eyebrow">AI PRODUCT STUDIO</span><h1>电商商品详情图</h1><p>上传商品原图，直接生成适配平台规范的高转化视觉素材。</p></div><span className="ecommerce-workbench__status"><span />实时生成</span></div>
      <div className="ecommerce-template-row" aria-label="模板预览">{["商品原图", "电商长图", "平台规范图"].map((name, index) => <button key={name} className={template === index ? "is-active" : ""} onClick={() => setTemplate(index)}>{name}<span>{index === 0 ? "3 张商品图" : index === 1 ? "长图详情页" : "多模块组合"}</span></button>)}</div>
      <div className="ecommerce-preview">
        <div className="ecommerce-preview__strip">{previews.length ? previews.map((src, index) => <div className="ecommerce-preview__source" key={src}><img src={src} alt={`商品原图 ${index + 1}`} /><button aria-label="移除图片" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={13} /></button></div>) : <div className="ecommerce-preview__empty"><ImagePlus size={24} /><span>上传 1–3 张商品原图</span></div>}</div>
        <div className="ecommerce-preview__canvas">{result ? <img src={result} alt="生成结果" /> : <div><Sparkles size={34} /><strong>生成结果将在这里展示</strong><span>先上传商品图，再完善右侧生成参数</span></div>}</div>
      </div>
    </main>
    <aside className="ecommerce-workbench__panel">
      <label className="ecommerce-upload"> <input type="file" accept="image/*" multiple onChange={event => setFiles(Array.from(event.target.files ?? []).slice(0, 3))} /><Upload size={18} /><span>{files.length ? `已选择 ${files.length} 张图片` : "上传商品原图"}</span><small>支持 JPG、PNG，最多 3 张</small></label>
      <div className="ecommerce-fields"><label>上架平台<select value={platform} onChange={event => setPlatform(event.target.value)}><option>亚马逊</option><option>淘宝</option><option>独立站</option></select></label><label>语言<select value={language} onChange={event => setLanguage(event.target.value)}><option>英文</option><option>中文</option><option>日文</option></select></label><label>图片比例<select value={ratio} onChange={event => setRatio(event.target.value)}><option>高级 A+（Web端）</option><option>方图 1:1</option><option>长图 3:4</option></select></label></div>
      <label className="ecommerce-prompt">商品卖点与要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：突出轻量、防水、适合通勤，画面干净，避免添加不存在的功能" /></label>
      <div className="ecommerce-modules"><div className="ecommerce-modules__title"><strong>快捷优化项</strong><span>选择常用优化方向，可多选</span></div><div className="ecommerce-modules__grid">{modules.map(([name, hint]) => <button key={name} className={selected.has(name) ? "is-selected" : ""} onClick={() => toggle(name)}><span className="ecommerce-check">{selected.has(name) && <Check size={12} />}</span><span><strong>{name}</strong><small>{hint}</small></span></button>)}</div></div>
      {error && <p className="ecommerce-error" role="alert">{error}</p>}
      <button className="ecommerce-generate" disabled={!files.length || busy} onClick={() => void generate()}>{busy ? <><LoaderCircle className="spin" size={17} />正在生成…</> : <><Sparkles size={17} />生成详情页</>}</button>
    </aside>
  </section>;
}

export default EcommerceWorkbench;
