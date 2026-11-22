import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ImagePlus,
  LayoutTemplate,
  LoaderCircle,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import type { CreativeAccountBridge } from "./bridge-types";
import "./ecommerce-workbench.css";

type Category = "product" | "video" | "apparel";
type ToolId =
  | "product-set"
  | "detail-page"
  | "viral-replicate"
  | "product-retouch"
  | "product-color"
  | "white-retouch"
  | "video-replicate"
  | "video-commerce"
  | "video-remove-background"
  | "video-4k"
  | "video-enhance"
  | "video-remove-watermark"
  | "video-compress"
  | "apparel-set"
  | "model-wear"
  | "underwear-change"
  | "shoe-tryon"
  | "ai-wear"
  | "pose-change";

const categories: Array<{ id: Category; label: string; icon: typeof ImagePlus }> = [
  { id: "product", label: "商品", icon: ImagePlus },
  { id: "video", label: "视频", icon: Video },
  { id: "apparel", label: "穿戴", icon: LayoutTemplate },
];

const tools: Record<Category, Array<{ id: ToolId; label: string }>> = {
  product: [
    { id: "product-set", label: "商品套图" },
    { id: "detail-page", label: "A+/详情页" },
    { id: "viral-replicate", label: "爆款复刻" },
    { id: "product-retouch", label: "产品精修" },
    { id: "product-color", label: "产品换色" },
    { id: "white-retouch", label: "白底精修" },
  ],
  video: [
    { id: "video-replicate", label: "视频复刻" },
    { id: "video-commerce", label: "带货视频" },
    { id: "video-remove-background", label: "视频背景移除" },
    { id: "video-4k", label: "视频4K超分" },
    { id: "video-enhance", label: "视频变清晰" },
    { id: "video-remove-watermark", label: "视频去水印" },
    { id: "video-compress", label: "视频压缩" },
  ],
  apparel: [
    { id: "apparel-set", label: "服装组图" },
    { id: "model-wear", label: "模特穿戴" },
    { id: "underwear-change", label: "内衣更换" },
    { id: "shoe-tryon", label: "AI 试鞋" },
    { id: "ai-wear", label: "AI 万戴" },
    { id: "pose-change", label: "模特换姿" },
  ],
};

const detailModules = [
  ["首屏主视觉", "传递核心价值", true],
  ["核心卖点图", "突出差异化优势", true],
  ["使用场景图", "呈现真实使用场景", true],
  ["多角度图", "多角度呈现外观", true],
  ["品牌故事图", "传递品牌价值", false],
  ["效果对比图", "展示使用前后差异", true],
  ["工艺制作图", "展示工艺制作过程", false],
  ["尺寸尺码图", "展示规格信息", false],
  ["规格/参数表", "展示详细商品数据", false],
  ["配件/赠品图", "明确收货所有物品", false],
  ["系列展示图", "多色或多 SKU 展示", false],
  ["售后保障图", "说明质保退换政策", false],
] as const;

const toolMeta: Record<ToolId, { title: string; description: string; media: "image" | "video" }> = {
  "product-set": { title: "AI 商品套图", description: "上传商品图，AI 即刻生成符合多电商平台规范的高转化率商品套图。", media: "image" },
  "detail-page": { title: "A+ 详情页", description: "上传商品图，生成适配电商平台规范的高转化率详情页素材。", media: "image" },
  "viral-replicate": { title: "AI 爆款复刻", description: "上传参考图和商品图，复刻爆款构图、风格与营销表达。", media: "image" },
  "product-retouch": { title: "AI 产品精修", description: "自动修复光影、瑕疵和材质表现，得到可直接使用的产品图。", media: "image" },
  "product-color": { title: "AI 产品换色", description: "保持产品结构和材质，生成指定颜色的商品视觉。", media: "image" },
  "white-retouch": { title: "AI 白底精修", description: "生成符合平台规范的白底商品精修图。", media: "image" },
  "video-replicate": { title: "AI 视频复刻", description: "上传参考视频和商品图，复刻原片结构、转场与风格。", media: "video" },
  "video-commerce": { title: "AI 带货视频", description: "将商品图转化为适合投放和带货的短视频内容。", media: "video" },
  "video-remove-background": { title: "视频背景移除", description: "移除视频背景并保留主体边缘与运动细节。", media: "video" },
  "video-4k": { title: "视频 4K 超分", description: "提升视频清晰度和细节，输出更高分辨率素材。", media: "video" },
  "video-enhance": { title: "视频变清晰", description: "增强视频清晰度、光照和细节表现。", media: "video" },
  "video-remove-watermark": { title: "视频去水印", description: "移除画面中的水印并尽量修复背景。", media: "video" },
  "video-compress": { title: "视频压缩", description: "在保持观感的前提下压缩视频体积。", media: "video" },
  "apparel-set": { title: "AI 服装组图", description: "分析款式和面料，生成模特穿戴、白底精修、3D 展示等图组。", media: "image" },
  "model-wear": { title: "AI 模特穿戴", description: "将服装自然穿戴到指定模特形象上，保持款式和材质准确。", media: "image" },
  "underwear-change": { title: "AI 内衣更换", description: "替换模特服装并保留姿态、光线和身体结构。", media: "image" },
  "shoe-tryon": { title: "AI 试鞋", description: "将鞋款自然呈现在脚部或模特穿搭场景中。", media: "image" },
  "ai-wear": { title: "AI 万戴", description: "将商品应用到不同人物和场景，生成可投放的穿戴素材。", media: "image" },
  "pose-change": { title: "模特换姿", description: "保持服装和人物特征，生成新的模特姿势和构图。", media: "image" },
};

type Props = { accountBridge?: CreativeAccountBridge; onOpenCanvas?: () => void };
type ResultPayload = { urls: string[]; taskId?: string; status?: string };
export const PENDING_CANVAS_IMAGE_KEY = "opentu-pending-canvas-image";
export const PENDING_CANVAS_IMAGE_EVENT = "opentu:canvas-image-pending";

function responseItems(payload: unknown): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") {
      items.push({ value });
      return;
    }
    const record = value as Record<string, unknown>;
    items.push(record);
    [record.data, record.images, record.outputs, record.results, record.output].forEach(candidate => {
      if (candidate !== undefined && candidate !== value) visit(candidate, depth + 1);
    });
  };
  visit(payload, 0);
  return items;
}

function parseResult(payload: unknown): ResultPayload {
  const value = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const urls = Array.from(new Set(responseItems(payload).flatMap(item => {
    const candidate = item.url ?? item.output_url ?? item.image_url ?? item.video_url ?? item.value;
    if (typeof candidate === "string" && candidate) return [candidate];
    const b64 = item.b64_json ?? item.base64;
    return typeof b64 === "string" && b64 ? [`data:image/png;base64,${b64}`] : [];
  })));
  const taskId = responseItems(payload)
    .flatMap(item => [item.task_id, item.request_id, item.id])
    .find(v => typeof v === "string") as string | undefined;
  const status = responseItems(payload)
    .map(item => item.status)
    .find(v => typeof v === "string") as string | undefined;
  return { urls, taskId, status };
}

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export function EcommerceWorkbench({ accountBridge, onOpenCanvas }: Props) {
  const [category, setCategory] = useState<Category>("product");
  const [tool, setTool] = useState<ToolId>("product-set");
  const [files, setFiles] = useState<File[]>([]);
  const [referenceVideo, setReferenceVideo] = useState<File | null>(null);
  const [template, setTemplate] = useState(0);
  const [platform, setPlatform] = useState("亚马逊");
  const [market, setMarket] = useState("美国");
  const [language, setLanguage] = useState("英文");
  const [ratio, setRatio] = useState("1:1");
  const [prompt, setPrompt] = useState("");
  const [structure, setStructure] = useState<"smart" | "custom">("smart");
  const [selected, setSelected] = useState(() => new Set(detailModules.filter(([, , on]) => on).map(([name]) => name)));
  const [apparelTypes, setApparelTypes] = useState(() => new Set(["白底精修图", "3D 立体效果图", "人台图"]));
  const [videoMode, setVideoMode] = useState("完全复刻");
  const [modelSource, setModelSource] = useState("AI 生成");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [resultKind, setResultKind] = useState<"image" | "video">("image");
  const [activeResult, setActiveResult] = useState(0);
  const previews = useMemo(() => files.map(file => URL.createObjectURL(file)), [files]);
  const currentTool = toolMeta[tool];

  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);
  useEffect(() => { setTool(tools[category][0].id); setTemplate(0); }, [category]);

  const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? []).slice(0, 3));
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, name: string) => setter(current => {
    const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next;
  });

  const buildRequest = () => {
    const body = new FormData();
    const isVideo = currentTool.media === "video";
    body.append("model", isVideo ? "doubao-seedance-2-0-260128" : "doubao-seedream-4-0-250828");
    body.append("prompt", [currentTool.title, `平台：${platform}`, `市场：${market}`, `语言：${language}`, `比例：${ratio}`, prompt.trim() || "保持商品外观、材质和结构准确，画面自然且适合商业投放", `工具参数：${tool === "detail-page" ? Array.from(selected).join("、") : tool === "product-set" ? structure : tool === "apparel-set" ? Array.from(apparelTypes).join("、") : tool === "video-replicate" ? videoMode : modelSource}`].join("。"));
    body.append("size", ratio);
    body.append("tool", tool);
    files.forEach(file => body.append("input_reference", file, file.name));
    if (referenceVideo) body.append("reference_video", referenceVideo, referenceVideo.name);
    return body;
  };

  const poll = async (reference: string, taskId: string, kind: "image" | "video") => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await wait(1500);
      setProgress(Math.min(95, 35 + attempt * 3));
      const url = kind === "image" ? `https://api.tu-zi.com/v1/images/generations/result?request_id=${encodeURIComponent(taskId)}` : `https://api.tu-zi.com/v1/videos/${encodeURIComponent(taskId)}`;
      const response = await accountBridge!.request(reference, url, { method: "GET" });
      if (!response.ok) throw new Error(`查询生成任务失败（HTTP ${response.status}）。`);
      const parsed = parseResult(await response.json());
      if (parsed.urls.length) return parsed.urls;
      if (["failed", "error", "cancelled"].includes(parsed.status ?? "")) throw new Error("生成任务失败，请检查模型权限或稍后重试。");
    }
    throw new Error("生成任务超时，请稍后在任务记录中查询结果。");
  };

  const generate = async () => {
    if ((!files.length && currentTool.media === "image") || busy) return;
    setBusy(true); setProgress(8); setError(""); setResultUrls([]); setResultKind(currentTool.media); setActiveResult(0);
    try {
      if (!accountBridge?.request || !accountBridge.selectedKeyId) throw new Error("请先在创作配置中选择账户 API Key。");
      const reference = `tuzi-account:${accountBridge.selectedKeyId}`;
      const endpoint = currentTool.media === "video" ? "https://api.tu-zi.com/v1/videos" : "https://api.tu-zi.com/v1/images/edits";
      const response = await accountBridge.request(reference, endpoint, { method: "POST", body: buildRequest() });
      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.clone().json() as Record<string, unknown>;
          detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
        } catch { /* keep generic HTTP error */ }
        throw new Error(detail || `提交生成任务失败（HTTP ${response.status}）。`);
      }
      const parsed = parseResult(await response.json());
      const urls = parsed.urls.length ? parsed.urls : parsed.taskId ? await poll(reference, parsed.taskId, currentTool.media) : [];
      if (!urls.length) throw new Error("模型未返回图片或视频结果，请检查模型响应格式。");
      setProgress(100); setResultUrls(urls);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成失败，请稍后重试。");
    } finally { setBusy(false); }
  };

  const queueCanvasInsert = () => {
    if (resultKind !== "image") return;
    const url = resultUrls[activeResult];
    if (!url) return;
    sessionStorage.setItem(PENDING_CANVAS_IMAGE_KEY, url);
    window.dispatchEvent(new CustomEvent(PENDING_CANVAS_IMAGE_EVENT));
    onOpenCanvas?.();
  };

  const changeCategory = (next: Category) => { setCategory(next); setFiles([]); setReferenceVideo(null); setResultUrls([]); setResultKind("image"); setError(""); };
  const changeTool = (next: ToolId) => { setTool(next); setTemplate(0); setFiles([]); setReferenceVideo(null); setResultUrls([]); setResultKind(toolMeta[next].media); setError(""); };

  return <section className="ecommerce-workbench" aria-label="电商生图工作台">
    <nav className="ecommerce-category-tabs" aria-label="工具分类">{categories.map(({ id, label, icon: Icon }) => <button key={id} className={category === id ? "is-active" : ""} onClick={() => changeCategory(id)}><Icon size={14} />{label}</button>)}</nav>
    <nav className="ecommerce-tool-tabs" aria-label="工具类型">{tools[category].map(({ id, label }) => <button key={id} className={tool === id ? "is-active" : ""} onClick={() => changeTool(id)}><LayoutTemplate size={14} />{label}</button>)}</nav>
    <aside className="ecommerce-workbench__rail">{categories.map(({ id, label, icon: Icon }) => <button key={id} className={category === id ? "is-active" : ""} onClick={() => changeCategory(id)}><Icon size={16} />{label}</button>)}</aside>
    <main className="ecommerce-workbench__main">
      <div className="ecommerce-workbench__heading"><h1>{currentTool.title}</h1><p>{currentTool.description}</p></div>
      <div className="ecommerce-template-row" aria-label="模板预览">{["商品原图", "细节与卖点", "平台成品"].map((name, index) => <button key={name} className={template === index ? "is-active" : ""} onClick={() => setTemplate(index)}>{name}<span>{index === 0 ? "输入素材" : index === 1 ? "重点展示" : "可直接投放"}</span></button>)}</div>
      <div className="ecommerce-preview">
        <div className="ecommerce-preview__strip">{previews.length ? previews.map((src, index) => <div className="ecommerce-preview__source" key={src}><img src={src} alt={`上传素材 ${index + 1}`} /><button aria-label="移除素材" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={13} /></button></div>) : <div className="ecommerce-preview__empty"><ImagePlus size={24} /><span>{currentTool.media === "video" ? "上传商品图或视频素材" : "上传 1–3 张商品原图"}</span></div>}</div>
        <div className="ecommerce-preview__canvas">{resultUrls.length ? <>{resultKind === "video" ? <video src={resultUrls[activeResult]} controls playsInline aria-label="生成视频" /> : <img src={resultUrls[activeResult]} alt="生成结果" />}<div className="ecommerce-result-nav"><button disabled={activeResult === 0} onClick={() => setActiveResult(index => index - 1)}>上一张</button><span>{activeResult + 1} / {resultUrls.length}</span><button disabled={activeResult === resultUrls.length - 1} onClick={() => setActiveResult(index => index + 1)}>下一张</button>{resultKind === "image" && <button onClick={queueCanvasInsert}>插入画布</button>}</div></> : <div><Sparkles size={34} /><strong>{busy ? `生成中 ${progress}%` : "生成结果将在这里展示"}</strong><span>{busy ? "正在提交并查询模型任务" : "先上传素材，再完善右侧生成参数"}</span></div>}</div>
      </div>
    </main>
    <aside className="ecommerce-workbench__panel">
      <label className="ecommerce-upload"><input type="file" accept="image/*" multiple onChange={selectFiles} /><Upload size={18} /><span>{files.length ? `已选择 ${files.length} 张图片` : "上传商品原图"}</span><small>支持 JPG、PNG，最多 3 张</small></label>
      {currentTool.media === "video" && <label className="ecommerce-upload ecommerce-upload--video"><input type="file" accept="video/*" onChange={event => setReferenceVideo(event.target.files?.[0] ?? null)} /><Video size={18} /><span>{referenceVideo ? `已选择 ${referenceVideo.name}` : "上传参考视频"}</span><small>支持 MP4、MOV，视频复刻时使用</small></label>}
      <div className="ecommerce-fields"><label>上架平台<select value={platform} onChange={event => setPlatform(event.target.value)}><option>亚马逊</option><option>淘宝</option><option>独立站</option></select></label><label>市场地区<select value={market} onChange={event => setMarket(event.target.value)}><option>美国</option><option>中国</option><option>日本</option></select></label><label>语言<select value={language} onChange={event => setLanguage(event.target.value)}><option>英文</option><option>中文</option><option>日文</option></select></label><label>图片/视频比例<select value={ratio} onChange={event => setRatio(event.target.value)}><option value="1:1">1:1</option><option value="adaptive">A+ 长图</option><option value="3:4">3:4</option><option value="9:16">9:16</option></select></label></div>
      <label className="ecommerce-prompt">{currentTool.media === "video" ? "商品卖点（可选）" : category === "apparel" ? "补充要求" : "商品卖点与要求"}<textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：突出材质、核心卖点、使用场景和画面风格" /></label>
      {tool === "product-set" && <div className="ecommerce-choice"><strong>套图结构配置</strong><label><input type="radio" checked={structure === "smart"} onChange={() => setStructure("smart")} />智能匹配<span>AI 分析商品图并匹配 Listing 套图</span></label><label><input type="radio" checked={structure === "custom"} onChange={() => setStructure("custom")} />自定义配置<span>自由调整各类型图片数量</span></label></div>}
      {tool === "video-replicate" && <div className="ecommerce-choice"><strong>视频复刻模式</strong><label><input type="radio" checked={videoMode === "完全复刻"} onChange={() => setVideoMode("完全复刻")} />完全复刻<span>仅替换视频中的商品</span></label><label><input type="radio" checked={videoMode === "相似复刻"} onChange={() => setVideoMode("相似复刻")} />相似复刻<span>复刻镜头和转场但保持差异</span></label></div>}
      {category === "apparel" && <div className="ecommerce-modules"><div className="ecommerce-modules__title"><strong>生成类型</strong><span>可多选</span></div><div className="ecommerce-modules__grid">{["白底精修图", "3D 立体效果图", "人台图", "细节特写图", "卖点图"].map(name => <button key={name} className={apparelTypes.has(name) ? "is-selected" : ""} onClick={() => toggleSet(setApparelTypes, name)}><span className="ecommerce-check">{apparelTypes.has(name) && <Check size={12} />}</span><span><strong>{name}</strong><small>{name === "白底精修图" ? "正面/背面产品精修" : name === "人台图" ? "使用人台展示服装" : "突出产品细节和卖点"}</small></span></button>)}</div></div>}
      {tool === "detail-page" && <div className="ecommerce-modules"><div className="ecommerce-modules__title"><strong>快捷优化项</strong><span>可多选</span></div><div className="ecommerce-modules__grid">{detailModules.map(([name, hint]) => <button key={name} className={selected.has(name) ? "is-selected" : ""} onClick={() => toggleSet(setSelected, name)}><span className="ecommerce-check">{selected.has(name) && <Check size={12} />}</span><span><strong>{name}</strong><small>{hint}</small></span></button>)}</div></div>}
      {error && <p className="ecommerce-error" role="alert">{error}</p>}
      <button className="ecommerce-generate" disabled={busy || (currentTool.media === "image" && !files.length) || (currentTool.media === "video" && !files.length && !referenceVideo)} onClick={() => void generate()}>{busy ? <><LoaderCircle className="spin" size={17} />正在生成 {progress}%</> : <><Sparkles size={17} />生成{currentTool.media === "video" ? "视频" : "图片"}</>}</button>
    </aside>
  </section>;
}

export default EcommerceWorkbench;
