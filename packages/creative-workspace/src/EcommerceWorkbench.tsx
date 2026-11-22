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
import { useSelectableModels } from "../upstream/packages/drawnix/src/hooks/use-runtime-models";
import { getFallbackDefaultModelId } from "../upstream/packages/drawnix/src/utils/runtime-model-discovery";
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

const categories: Array<{
  id: Category;
  label: string;
  icon: typeof ImagePlus;
}> = [
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

const toolMeta: Record<
  ToolId,
  { title: string; description: string; media: "image" | "video" }
> = {
  "product-set": {
    title: "AI 商品套图",
    description:
      "上传商品图，AI 即刻生成符合多电商平台规范的高转化率商品套图。",
    media: "image",
  },
  "detail-page": {
    title: "A+ 详情页",
    description: "上传商品图，生成适配电商平台规范的高转化率详情页素材。",
    media: "image",
  },
  "viral-replicate": {
    title: "AI 爆款复刻",
    description: "上传参考图和商品图，复刻爆款构图、风格与营销表达。",
    media: "image",
  },
  "product-retouch": {
    title: "AI 产品精修",
    description: "自动修复光影、瑕疵和材质表现，得到可直接使用的产品图。",
    media: "image",
  },
  "product-color": {
    title: "AI 产品换色",
    description: "保持产品结构和材质，生成指定颜色的商品视觉。",
    media: "image",
  },
  "white-retouch": {
    title: "AI 白底精修",
    description: "生成符合平台规范的白底商品精修图。",
    media: "image",
  },
  "video-replicate": {
    title: "AI 视频复刻",
    description: "上传参考视频和商品图，复刻原片结构、转场与风格。",
    media: "video",
  },
  "video-commerce": {
    title: "AI 带货视频",
    description: "将商品图转化为适合投放和带货的短视频内容。",
    media: "video",
  },
  "video-remove-background": {
    title: "视频背景移除",
    description: "移除视频背景并保留主体边缘与运动细节。",
    media: "video",
  },
  "video-4k": {
    title: "视频 4K 超分",
    description: "提升视频清晰度和细节，输出更高分辨率素材。",
    media: "video",
  },
  "video-enhance": {
    title: "视频变清晰",
    description: "增强视频清晰度、光照和细节表现。",
    media: "video",
  },
  "video-remove-watermark": {
    title: "视频去水印",
    description: "移除画面中的水印并尽量修复背景。",
    media: "video",
  },
  "video-compress": {
    title: "视频压缩",
    description: "在保持观感的前提下压缩视频体积。",
    media: "video",
  },
  "apparel-set": {
    title: "AI 服装组图",
    description: "分析款式和面料，生成模特穿戴、白底精修、3D 展示等图组。",
    media: "image",
  },
  "model-wear": {
    title: "AI 模特穿戴",
    description: "将服装自然穿戴到指定模特形象上，保持款式和材质准确。",
    media: "image",
  },
  "underwear-change": {
    title: "AI 内衣更换",
    description: "替换模特服装并保留姿态、光线和身体结构。",
    media: "image",
  },
  "shoe-tryon": {
    title: "AI 试鞋",
    description: "将鞋款自然呈现在脚部或模特穿搭场景中。",
    media: "image",
  },
  "ai-wear": {
    title: "AI 万戴",
    description: "将商品应用到不同人物和场景，生成可投放的穿戴素材。",
    media: "image",
  },
  "pose-change": {
    title: "模特换姿",
    description: "保持服装和人物特征，生成新的模特姿势和构图。",
    media: "image",
  },
};

type QuickOption = {
  id: string;
  label: string;
  hint: string;
  defaultSelected?: boolean;
};

export const ECOMMERCE_PLATFORMS = [
  "亚马逊",
  "淘宝天猫",
  "1688",
  "Temu",
  "TikTok Shop",
  "拼多多",
  "抖音电商",
  "OZON",
  "独立站",
  "Shopee",
  "阿里国际站",
  "速卖通",
  "SHEIN",
  "京东",
  "美客多",
  "Coupang",
  "Wayfair",
  "Lazada",
  "eBay",
] as const;

export const ECOMMERCE_LANGUAGES = [
  "英文",
  "中文",
  "日文",
  "韩文",
  "西班牙文",
  "俄语",
  "泰语",
  "马来语",
] as const;

export const ECOMMERCE_RATIOS = [
  { id: "a-plus-web", label: "高级A+（Web端）", size: "1472x608" },
  { id: "a-plus-mobile", label: "高级A+（移动端）", size: "1024x768" },
  { id: "a-plus", label: "普通A+", size: "1040x640" },
  { id: "1:1", label: "1:1", size: "1024x1024" },
  { id: "4:3", label: "4:3", size: "1152x864" },
  { id: "16:9", label: "16:9", size: "1536x864" },
  { id: "9:16", label: "9:16", size: "864x1536" },
] as const;

export const DETAIL_PAGE_MODULES = [
  { id: "hero", label: "首屏主视觉", hint: "传递核心价值", required: true },
  { id: "selling-point", label: "核心卖点图", hint: "突出差异化优势" },
  { id: "scene", label: "使用场景图", hint: "呈现真实使用场景" },
  { id: "angle", label: "多角度图", hint: "多角度呈现外观" },
  { id: "brand", label: "品牌故事图", hint: "传递品牌价值" },
  { id: "comparison", label: "效果对比图", hint: "展示使用前后差异" },
  { id: "craft", label: "工艺制作图", hint: "展示工艺制作过程" },
  { id: "size", label: "尺寸尺码图", hint: "展示规格信息" },
  { id: "spec", label: "规格/参数表", hint: "展示详细商品数据" },
  { id: "accessories", label: "配件/赠品图", hint: "明确收货所有物品" },
  { id: "series", label: "系列展示图", hint: "多色或多 SKU 展示" },
  { id: "ingredient", label: "商品成分图", hint: "清晰呈现成分与材质" },
  { id: "after-sale", label: "售后保障图", hint: "说明质保退换政策" },
  { id: "usage", label: "使用建议图", hint: "提供正确使用建议" },
] as const;

const previewTemplates: Record<"product-set" | "detail-page", Array<{ id: string; label: string; caption: string }>> = {
  "product-set": [
    { id: "original", label: "商品原图", caption: "上传素材" },
    { id: "hero", label: "主图", caption: "首图主视觉" },
    { id: "selling-point", label: "卖点解析", caption: "信息表达" },
    { id: "detail", label: "细节特写", caption: "材质做工" },
    { id: "spec", label: "商品规格", caption: "规格信息" },
  ],
  "detail-page": [
    { id: "product", label: "产品图", caption: "主体展示" },
    { id: "long-image", label: "电商长图", caption: "详情页结构" },
    { id: "platform", label: "平台规范图", caption: "尺寸适配" },
    { id: "template", label: "示例模板", caption: "模块组合" },
  ],
};

export type EcommerceModuleCounts = {
  whiteBackground: number;
  scene: number;
  sellingPoint: number;
  other: number;
};

export function normalizeEcommerceModuleCounts(
  counts: EcommerceModuleCounts,
): EcommerceModuleCounts {
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [
      key,
      Math.max(0, Math.min(12, Number.isFinite(value) ? value : 0)),
    ]),
  ) as EcommerceModuleCounts;
}

const quickOptions: Record<ToolId, QuickOption[]> = {
  "product-set": [
    {
      id: "hero",
      label: "首图主视觉",
      hint: "突出核心卖点",
      defaultSelected: true,
    },
    {
      id: "selling-point",
      label: "核心卖点图",
      hint: "强化差异化优势",
      defaultSelected: true,
    },
    {
      id: "scene",
      label: "使用场景图",
      hint: "展示真实使用场景",
      defaultSelected: true,
    },
    {
      id: "angle",
      label: "多角度图",
      hint: "完整呈现产品外观",
      defaultSelected: true,
    },
    { id: "detail", label: "细节特写图", hint: "展示材质和做工" },
    { id: "size", label: "尺寸规格图", hint: "清晰说明规格信息" },
  ],
  "detail-page": [
    {
      id: "hero",
      label: "首屏主视觉",
      hint: "传递核心价值",
      defaultSelected: true,
    },
    {
      id: "selling-point",
      label: "核心卖点图",
      hint: "突出差异化优势",
      defaultSelected: true,
    },
    {
      id: "scene",
      label: "使用场景图",
      hint: "呈现真实使用场景",
      defaultSelected: true,
    },
    {
      id: "angle",
      label: "多角度图",
      hint: "多角度呈现外观",
      defaultSelected: true,
    },
    { id: "brand", label: "品牌故事图", hint: "传递品牌价值" },
    {
      id: "comparison",
      label: "效果对比图",
      hint: "展示使用前后差异",
      defaultSelected: true,
    },
    { id: "craft", label: "工艺制作图", hint: "展示工艺制作过程" },
    { id: "size", label: "尺寸尺码图", hint: "展示规格信息" },
    { id: "spec", label: "规格/参数表", hint: "展示详细商品数据" },
    { id: "accessories", label: "配件/赠品图", hint: "明确收货所有物品" },
    { id: "series", label: "系列展示图", hint: "多色或多 SKU 展示" },
    { id: "ingredient", label: "商品成分图", hint: "清晰呈现成分与材质" },
    { id: "after-sale", label: "售后保障图", hint: "说明质保退换政策" },
    { id: "usage", label: "使用建议图", hint: "提供正确使用建议" },
  ],
  "viral-replicate": [
    {
      id: "composition",
      label: "复刻爆款构图",
      hint: "保持参考图布局",
      defaultSelected: true,
    },
    {
      id: "lighting",
      label: "复刻光影风格",
      hint: "匹配氛围和质感",
      defaultSelected: true,
    },
    {
      id: "selling-point",
      label: "强化商品卖点",
      hint: "突出购买理由",
      defaultSelected: true,
    },
    { id: "background", label: "替换场景背景", hint: "适配你的商品定位" },
    { id: "platform", label: "平台规范适配", hint: "自动调整画面比例" },
    { id: "variation", label: "生成多种变体", hint: "一次获取多套方案" },
  ],
  "product-retouch": [
    {
      id: "blemish",
      label: "去除瑕疵",
      hint: "清理灰尘和小缺陷",
      defaultSelected: true,
    },
    {
      id: "material",
      label: "增强材质",
      hint: "突出真实触感",
      defaultSelected: true,
    },
    {
      id: "lighting",
      label: "修复光影",
      hint: "平衡曝光和阴影",
      defaultSelected: true,
    },
    { id: "texture", label: "保留纹理", hint: "避免过度磨皮" },
    { id: "edge", label: "边缘清晰", hint: "强化轮廓和细节" },
    { id: "color", label: "统一色彩", hint: "还原自然商品色" },
  ],
  "product-color": [
    {
      id: "precise-color",
      label: "精准换色",
      hint: "保持颜色自然准确",
      defaultSelected: true,
    },
    {
      id: "material",
      label: "保留材质",
      hint: "纹理和质感不丢失",
      defaultSelected: true,
    },
    {
      id: "lighting",
      label: "保留光影",
      hint: "维持原始立体感",
      defaultSelected: true,
    },
    { id: "multi-color", label: "生成多种颜色", hint: "适合多 SKU 展示" },
    { id: "background", label: "背景保持不变", hint: "只调整商品颜色" },
    { id: "color-match", label: "匹配指定色值", hint: "适合品牌标准色" },
  ],
  "white-retouch": [
    {
      id: "white-background",
      label: "纯白背景",
      hint: "符合主流平台规范",
      defaultSelected: true,
    },
    {
      id: "natural-shadow",
      label: "自然投影",
      hint: "保留商品立体感",
      defaultSelected: true,
    },
    {
      id: "center",
      label: "商品居中",
      hint: "优化主体留白",
      defaultSelected: true,
    },
    { id: "clean-edge", label: "边缘干净", hint: "去除杂边和背景色" },
    { id: "platform", label: "平台合规", hint: "自动检查画面规范" },
    { id: "high-definition", label: "高清输出", hint: "保留商品细节" },
  ],
  "video-replicate": [
    {
      id: "camera",
      label: "复刻镜头",
      hint: "保持原片镜头语言",
      defaultSelected: true,
    },
    {
      id: "rhythm",
      label: "同步节奏",
      hint: "匹配剪辑节拍",
      defaultSelected: true,
    },
    {
      id: "transition",
      label: "复刻转场",
      hint: "保持画面衔接方式",
      defaultSelected: true,
    },
    { id: "replace-product", label: "替换商品", hint: "只替换画面主体" },
    { id: "caption", label: "保留文案", hint: "延续原片信息结构" },
    { id: "short-video", label: "短视频适配", hint: "适合投放和带货" },
  ],
  "video-commerce": [
    {
      id: "hook",
      label: "3 秒吸引",
      hint: "开头快速抓住注意力",
      defaultSelected: true,
    },
    {
      id: "caption",
      label: "卖点字幕",
      hint: "突出核心购买理由",
      defaultSelected: true,
    },
    {
      id: "close-up",
      label: "产品特写",
      hint: "强化商品细节",
      defaultSelected: true,
    },
    { id: "scene", label: "场景演示", hint: "展示真实使用方式" },
    { id: "cta", label: "行动号召", hint: "引导点击和下单" },
    { id: "music", label: "匹配配乐节奏", hint: "提升观看完成度" },
  ],
  "video-remove-background": [
    {
      id: "subject",
      label: "主体精准",
      hint: "准确分离前景主体",
      defaultSelected: true,
    },
    {
      id: "edge",
      label: "边缘柔和",
      hint: "处理发丝和细小边缘",
      defaultSelected: true,
    },
    {
      id: "shadow",
      label: "保留自然阴影",
      hint: "维持空间关系",
      defaultSelected: true,
    },
    { id: "transparent", label: "透明背景", hint: "方便后续合成" },
    { id: "tracking", label: "稳定跟踪", hint: "适应主体移动" },
    { id: "high-definition", label: "高清输出", hint: "减少抠像损失" },
  ],
  "video-4k": [
    {
      id: "4k",
      label: "4K 输出",
      hint: "提升到更高分辨率",
      defaultSelected: true,
    },
    {
      id: "detail",
      label: "保留细节",
      hint: "增强纹理和轮廓",
      defaultSelected: true,
    },
    {
      id: "denoise",
      label: "智能降噪",
      hint: "减少压缩和拍摄噪点",
      defaultSelected: true,
    },
    { id: "sharpen", label: "自然锐化", hint: "提升清晰度不过度" },
    { id: "repair", label: "修复压缩", hint: "改善低码率画面" },
    { id: "keep-frame", label: "保持原帧率", hint: "避免运动节奏变化" },
  ],
  "video-enhance": [
    {
      id: "clarity",
      label: "提升清晰度",
      hint: "增强画面细节",
      defaultSelected: true,
    },
    {
      id: "denoise",
      label: "修复噪点",
      hint: "清理暗部杂点",
      defaultSelected: true,
    },
    {
      id: "lighting",
      label: "增强光影",
      hint: "改善曝光和层次",
      defaultSelected: true,
    },
    { id: "skin-tone", label: "保留肤色", hint: "避免人物偏色" },
    { id: "stabilize", label: "稳定画面", hint: "减少轻微抖动" },
    { id: "sharpen", label: "自然锐化", hint: "提升观感不失真" },
  ],
  "video-remove-watermark": [
    {
      id: "inpaint",
      label: "智能填充",
      hint: "自动补全遮挡区域",
      defaultSelected: true,
    },
    {
      id: "background",
      label: "保留背景",
      hint: "尽量还原原始画面",
      defaultSelected: true,
    },
    {
      id: "tracking",
      label: "跟随移动",
      hint: "处理动态水印",
      defaultSelected: true,
    },
    { id: "edge", label: "边缘平滑", hint: "减少修复痕迹" },
    { id: "keep-subject", label: "不改变主体", hint: "保护商品和人物" },
    { id: "high-definition", label: "高清输出", hint: "保持画面细节" },
  ],
  "video-compress": [
    {
      id: "small-size",
      label: "小体积",
      hint: "更快上传和分享",
      defaultSelected: true,
    },
    {
      id: "keep-clarity",
      label: "保持清晰",
      hint: "控制画质损失",
      defaultSelected: true,
    },
    {
      id: "platform",
      label: "平台适配",
      hint: "匹配常见上传限制",
      defaultSelected: true,
    },
    { id: "fast", label: "快速导出", hint: "减少处理等待" },
    { id: "keep-audio", label: "保持音频", hint: "保留原始声音" },
    { id: "keep-frame", label: "保持帧率", hint: "避免播放卡顿" },
  ],
  "apparel-set": [
    {
      id: "white-background",
      label: "白底精修图",
      hint: "适合商品详情页",
      defaultSelected: true,
    },
    {
      id: "3d",
      label: "3D 立体效果图",
      hint: "突出服装轮廓",
      defaultSelected: true,
    },
    {
      id: "mannequin",
      label: "人台展示图",
      hint: "清晰展示版型",
      defaultSelected: true,
    },
    { id: "detail", label: "细节特写图", hint: "展示面料和工艺" },
    { id: "selling-point", label: "卖点展示图", hint: "突出设计亮点" },
    { id: "front-back", label: "正反面对照", hint: "完整展示款式" },
  ],
  "model-wear": [
    {
      id: "fit",
      label: "保持版型",
      hint: "服装结构不变",
      defaultSelected: true,
    },
    {
      id: "material",
      label: "真实面料",
      hint: "还原纹理和垂感",
      defaultSelected: true,
    },
    {
      id: "natural",
      label: "自然合体",
      hint: "贴合人物身体结构",
      defaultSelected: true,
    },
    { id: "same-model", label: "模特统一", hint: "保持人物特征" },
    { id: "scene", label: "场景搭配", hint: "生成适配使用场景" },
    { id: "angle", label: "多角度展示", hint: "适合服装组图" },
  ],
  "underwear-change": [
    {
      id: "garment",
      label: "服装准确",
      hint: "保持款式和结构",
      defaultSelected: true,
    },
    {
      id: "pose",
      label: "姿态不变",
      hint: "保留人物动作",
      defaultSelected: true,
    },
    {
      id: "body",
      label: "身体结构自然",
      hint: "避免形体变形",
      defaultSelected: true,
    },
    { id: "lighting", label: "匹配光影", hint: "保持画面真实感" },
    { id: "skin-tone", label: "保留肤色", hint: "避免肤色异常" },
    { id: "safe", label: "安全合规", hint: "适合正常商业展示" },
  ],
  "shoe-tryon": [
    {
      id: "shape",
      label: "鞋型准确",
      hint: "保持鞋款结构",
      defaultSelected: true,
    },
    {
      id: "foot",
      label: "脚部自然",
      hint: "贴合脚型和姿态",
      defaultSelected: true,
    },
    {
      id: "perspective",
      label: "透视匹配",
      hint: "适应拍摄角度",
      defaultSelected: true,
    },
    { id: "outfit", label: "穿搭场景", hint: "搭配完整造型" },
    { id: "angle", label: "多角度展示", hint: "呈现鞋款细节" },
    { id: "detail", label: "细节清晰", hint: "突出材质和做工" },
  ],
  "ai-wear": [
    {
      id: "multi-model",
      label: "多模特展示",
      hint: "覆盖不同人群",
      defaultSelected: true,
    },
    {
      id: "multi-scene",
      label: "多场景生成",
      hint: "适配不同使用场景",
      defaultSelected: true,
    },
    {
      id: "fit",
      label: "保持版型",
      hint: "服装结构不变",
      defaultSelected: true,
    },
    { id: "style", label: "风格统一", hint: "方便批量发布" },
    { id: "ecommerce", label: "电商主图", hint: "突出商品主体" },
    { id: "social", label: "社媒比例", hint: "适配短视频平台" },
  ],
  "pose-change": [
    {
      id: "garment",
      label: "保持服装",
      hint: "款式和材质不变",
      defaultSelected: true,
    },
    {
      id: "person",
      label: "保持人物",
      hint: "保留人物特征",
      defaultSelected: true,
    },
    {
      id: "poses",
      label: "多种姿势",
      hint: "一次生成多套动作",
      defaultSelected: true,
    },
    { id: "full-body", label: "全身构图", hint: "完整展示穿搭" },
    { id: "natural", label: "自然动作", hint: "避免僵硬和变形" },
    { id: "angle", label: "多角度展示", hint: "丰富商品素材" },
  ],
};

type Props = {
  accountBridge?: CreativeAccountBridge;
  onOpenCanvas?: () => void;
};
type ResultPayload = { urls: string[]; taskId?: string; status?: string };
export const PENDING_CANVAS_IMAGE_KEY = "opentu-pending-canvas-image";
export const PENDING_CANVAS_IMAGE_EVENT = "opentu:canvas-image-pending";

function responseItems(payload: unknown): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") {
      items.push({ value });
      return;
    }
    const record = value as Record<string, unknown>;
    items.push(record);
    [
      record.data,
      record.images,
      record.outputs,
      record.results,
      record.output,
    ].forEach((candidate) => {
      if (candidate !== undefined && candidate !== value)
        visit(candidate, depth + 1);
    });
  };
  visit(payload, 0);
  return items;
}

function parseResult(payload: unknown): ResultPayload {
  const value = (
    payload && typeof payload === "object" ? payload : {}
  ) as Record<string, unknown>;
  const urls = Array.from(
    new Set(
      responseItems(payload).flatMap((item) => {
        const candidate =
          item.url ??
          item.output_url ??
          item.image_url ??
          item.video_url ??
          item.value;
        if (typeof candidate === "string" && candidate) return [candidate];
        const b64 = item.b64_json ?? item.base64;
        return typeof b64 === "string" && b64
          ? [`data:image/png;base64,${b64}`]
          : [];
      }),
    ),
  );
  const taskId = responseItems(payload)
    .flatMap((item) => [item.task_id, item.request_id, item.id])
    .find((v) => typeof v === "string") as string | undefined;
  const status = responseItems(payload)
    .map((item) => item.status)
    .find((v) => typeof v === "string") as string | undefined;
  return { urls, taskId, status };
}

const wait = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export function EcommerceWorkbench({ accountBridge, onOpenCanvas }: Props) {
  const [category, setCategory] = useState<Category>("product");
  const [tool, setTool] = useState<ToolId>("product-set");
  const [files, setFiles] = useState<File[]>([]);
  const [referenceVideo, setReferenceVideo] = useState<File | null>(null);
  const [platform, setPlatform] = useState("亚马逊");
  const [market, setMarket] = useState("美国");
  const [language, setLanguage] = useState("英文");
  const [ratio, setRatio] = useState("1:1");
  const [prompt, setPrompt] = useState("");
  const [structure, setStructure] = useState<"smart" | "custom">("smart");
  const [customCounts, setCustomCounts] = useState({
    whiteBackground: 1,
    scene: 3,
    sellingPoint: 3,
    other: 1,
  });
  const [activeTemplate, setActiveTemplate] = useState("original");
  const [assistBusy, setAssistBusy] = useState(false);
  const [apparelTypes, setApparelTypes] = useState(
    () => new Set(["白底精修图", "3D 立体效果图", "人台图"]),
  );
  const [videoMode, setVideoMode] = useState("完全复刻");
  const imageModels = useSelectableModels("image");
  const videoModels = useSelectableModels("video");
  const [selectedModels, setSelectedModels] = useState(() => ({
    image: getFallbackDefaultModelId("image"),
    video: getFallbackDefaultModelId("video"),
  }));
  const [quickSelections, setQuickSelections] = useState<
    Record<ToolId, Set<string>>
  >(
    () =>
      Object.fromEntries(
        Object.entries(quickOptions).map(([id, options]) => [
          id,
          new Set(
            options
              .filter((option) => option.defaultSelected)
              .map((option) => option.id),
          ),
        ]),
      ) as Record<ToolId, Set<string>>,
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [resultKind, setResultKind] = useState<"image" | "video">("image");
  const [activeResult, setActiveResult] = useState(0);
  const previews = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files],
  );
  const currentTool = toolMeta[tool];
  const activeModelType = currentTool.media;
  const activeModels = activeModelType === "image" ? imageModels : videoModels;
  const modelOptions = activeModels.length
    ? activeModels
    : [
        {
          id: getFallbackDefaultModelId(activeModelType),
          label: getFallbackDefaultModelId(activeModelType),
          description: "当前默认模型",
        },
      ];
  const selectedModel = modelOptions.some(
    (model) => model.id === selectedModels[activeModelType],
  )
    ? selectedModels[activeModelType]
    : modelOptions[0].id;
  const selectedModelConfig = modelOptions.find(
    (model) => model.id === selectedModel,
  );
  const templates =
    tool === "product-set" || tool === "detail-page"
      ? previewTemplates[tool]
      : [];
  const selectedRatio = ECOMMERCE_RATIOS.find((item) => item.id === ratio) ?? ECOMMERCE_RATIOS[3];
  const selectedQuickLabels = quickOptions[tool]
    .filter((option) => quickSelections[tool].has(option.id))
    .map((option) => option.label);
  const customTotal = Object.values(customCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  useEffect(
    () => () => previews.forEach((url) => URL.revokeObjectURL(url)),
    [previews],
  );
  useEffect(() => {
    setTool(tools[category][0].id);
  }, [category]);
  useEffect(() => {
    setSelectedModels((current) => {
      const image = imageModels.some((model) => model.id === current.image)
        ? current.image
        : imageModels[0]?.id || current.image;
      const video = videoModels.some((model) => model.id === current.video)
        ? current.video
        : videoModels[0]?.id || current.video;
      if (image === current.image && video === current.video) return current;
      return { image, video };
    });
  }, [imageModels, videoModels]);

  const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) =>
    setFiles(Array.from(event.target.files ?? []).slice(0, 3));
  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    name: string,
  ) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleQuickOption = (id: string) =>
    setQuickSelections((current) => {
      const nextForTool = new Set(current[tool]);
      if (nextForTool.has(id)) nextForTool.delete(id);
      else nextForTool.add(id);
      return { ...current, [tool]: nextForTool };
    });
  const restoreQuickDefaults = () =>
    setQuickSelections((current) => ({
      ...current,
      [tool]: new Set(
        quickOptions[tool]
          .filter((option) => option.defaultSelected)
          .map((option) => option.id),
      ),
    }));

  const writeSellingPoint = async () => {
    if (assistBusy) return;
    setAssistBusy(true);
    await wait(240);
    const platformHint = `${platform}${market ? `（${market}市场）` : ""}`;
    const generated =
      prompt.trim() ||
      `请围绕商品的核心功能、材质质感、使用场景和购买理由，生成适合${platformHint}的简洁卖点文案。每条不超过20字，避免夸大承诺，突出真实可验证的优势。`;
    setPrompt(generated);
    setAssistBusy(false);
  };

  const updateCustomCount = (key: keyof typeof customCounts, value: number) =>
    setCustomCounts((current) =>
      normalizeEcommerceModuleCounts({ ...current, [key]: value || 0 }),
    );

  const buildRequest = () => {
    const body = new FormData();
    const isVideo = currentTool.media === "video";
    body.append("model", selectedModel);
    body.append("platform", platform);
    body.append("market", market);
    body.append("language", language);
    body.append("aspect_ratio", ratio);
    body.append("image_size", selectedRatio.size);
    body.append("quick_options", JSON.stringify(selectedQuickLabels));
    body.append("module_types", JSON.stringify(selectedQuickLabels));
    body.append("structure", tool === "product-set" ? structure : "");
    if (tool === "product-set")
      body.append("module_counts", JSON.stringify(customCounts));
    if (tool === "detail-page")
      body.append(
        "detail_modules",
        JSON.stringify(
          selectedQuickLabels.length ? selectedQuickLabels : ["首屏主视觉"],
        ),
      );
    body.append(
      "prompt",
      [
        currentTool.title,
        `平台：${platform}`,
        `市场：${market}`,
        `语言：${language}`,
        `比例：${selectedRatio.label}（${selectedRatio.size}）`,
        prompt.trim() || "保持商品外观、材质和结构准确，画面自然且适合商业投放",
        `快捷优化：${selectedQuickLabels.length ? selectedQuickLabels.join("、") : "按默认商业规范处理"}`,
        `模型：${selectedModel}`,
        `工具参数：${tool === "product-set" ? `${structure}，白底图${customCounts.whiteBackground}张、场景图${customCounts.scene}张、卖点图${customCounts.sellingPoint}张、其他${customCounts.other}张` : tool === "detail-page" ? `详情模块：${selectedQuickLabels.join("、") || "首屏主视觉"}` : tool === "apparel-set" ? Array.from(apparelTypes).join("、") : tool === "video-replicate" ? videoMode : "按工具默认参数处理"}`,
      ].join("。"),
    );
    body.append("size", selectedRatio.size);
    body.append("tool", tool);
    // Tuzi's OpenAI-compatible image edit endpoint accepts repeated `image`
    // parts. Keep the field aligned with the live API contract so the
    // workbench request is usable outside the mock transport as well.
    files.forEach((file) => body.append("image", file, file.name));
    if (referenceVideo)
      body.append("reference_video", referenceVideo, referenceVideo.name);
    return body;
  };

  const poll = async (
    reference: string,
    taskId: string,
    kind: "image" | "video",
  ) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await wait(1500);
      setProgress(Math.min(95, 35 + attempt * 3));
      const url =
        kind === "image"
          ? `https://api.tu-zi.com/v1/images/generations/result?request_id=${encodeURIComponent(taskId)}`
          : `https://api.tu-zi.com/v1/videos/${encodeURIComponent(taskId)}`;
      const response = await accountBridge!.request(reference, url, {
        method: "GET",
      });
      if (!response.ok)
        throw new Error(`查询生成任务失败（HTTP ${response.status}）。`);
      const parsed = parseResult(await response.json());
      if (parsed.urls.length) return parsed.urls;
      if (["failed", "error", "cancelled"].includes(parsed.status ?? ""))
        throw new Error("生成任务失败，请检查模型权限或稍后重试。");
    }
    throw new Error("生成任务超时，请稍后在任务记录中查询结果。");
  };

  const generate = async () => {
    if ((!files.length && currentTool.media === "image") || busy) return;
    setBusy(true);
    setProgress(8);
    setError("");
    setResultUrls([]);
    setResultKind(currentTool.media);
    setActiveResult(0);
    try {
      if (!accountBridge?.request || !accountBridge.selectedKeyId)
        throw new Error("请先在创作配置中选择账户 API Key。");
      const reference = `tuzi-account:${accountBridge.selectedKeyId}`;
      const endpoint =
        currentTool.media === "video"
          ? "https://api.tu-zi.com/v1/videos"
          : "https://api.tu-zi.com/v1/images/edits";
      const response = await accountBridge.request(reference, endpoint, {
        method: "POST",
        body: buildRequest(),
      });
      if (!response.ok) {
        let detail = "";
        try {
          const body = (await response.clone().json()) as Record<
            string,
            unknown
          >;
          detail =
            typeof body.error === "string"
              ? body.error
              : typeof body.message === "string"
                ? body.message
                : "";
        } catch {
          /* keep generic HTTP error */
        }
        throw new Error(
          detail || `提交生成任务失败（HTTP ${response.status}）。`,
        );
      }
      const parsed = parseResult(await response.json());
      const urls = parsed.urls.length
        ? parsed.urls
        : parsed.taskId
          ? await poll(reference, parsed.taskId, currentTool.media)
          : [];
      if (!urls.length)
        throw new Error("模型未返回图片或视频结果，请检查模型响应格式。");
      setProgress(100);
      setResultUrls(urls);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "生成失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  const queueCanvasInsert = () => {
    if (resultKind !== "image") return;
    const url = resultUrls[activeResult];
    if (!url) return;
    sessionStorage.setItem(PENDING_CANVAS_IMAGE_KEY, url);
    window.dispatchEvent(new CustomEvent(PENDING_CANVAS_IMAGE_EVENT));
    onOpenCanvas?.();
  };

  const changeCategory = (next: Category) => {
    setCategory(next);
    setFiles([]);
    setReferenceVideo(null);
    setResultUrls([]);
    setResultKind("image");
    setActiveTemplate("original");
    setError("");
  };
  const changeTool = (next: ToolId) => {
    setTool(next);
    setFiles([]);
    setReferenceVideo(null);
    setResultUrls([]);
    setResultKind(toolMeta[next].media);
    setActiveTemplate(next === "detail-page" ? "product" : "original");
    setError("");
  };

  return (
    <section className="ecommerce-workbench" aria-label="电商生图工作台">
      <nav className="ecommerce-category-tabs" aria-label="工具分类">
        {categories.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={category === id ? "is-active" : ""}
            onClick={() => changeCategory(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>
      <nav className="ecommerce-tool-tabs" aria-label="工具类型">
        {tools[category].map(({ id, label }) => (
          <button
            key={id}
            className={tool === id ? "is-active" : ""}
            onClick={() => changeTool(id)}
          >
            <LayoutTemplate size={14} />
            {label}
          </button>
        ))}
      </nav>
      <main className="ecommerce-workbench__main">
        <div className="ecommerce-workbench__heading">
          <h1>{currentTool.title}</h1>
          <p>{currentTool.description}</p>
        </div>
        {templates.length > 0 && (
          <div className="ecommerce-template-row" aria-label="结果模板预览">
            {templates.map((template) => (
              <button
                key={template.id}
                className={activeTemplate === template.id ? "is-active" : ""}
                onClick={() => setActiveTemplate(template.id)}
                type="button"
              >
                {template.label}
                <span>{template.caption}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ecommerce-preview">
          <div className="ecommerce-preview__strip">
            {previews.length ? (
              previews.map((src, index) => (
                <div className="ecommerce-preview__source" key={src}>
                  <img src={src} alt={`上传素材 ${index + 1}`} />
                  <button
                    aria-label="移除素材"
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))
            ) : (
              <div className="ecommerce-preview__empty">
                <ImagePlus size={24} />
                <span>
                  {currentTool.media === "video"
                    ? "上传商品图或视频素材"
                    : "上传 1–3 张商品原图"}
                </span>
              </div>
            )}
          </div>
          <div className="ecommerce-preview__canvas">
            {resultUrls.length ? (
              <>
                {resultKind === "video" ? (
                  <video
                    src={resultUrls[activeResult]}
                    controls
                    playsInline
                    aria-label="生成视频"
                  />
                ) : (
                  <img src={resultUrls[activeResult]} alt="生成结果" />
                )}
                <div className="ecommerce-result-nav">
                  <button
                    disabled={activeResult === 0}
                    onClick={() => setActiveResult((index) => index - 1)}
                  >
                    上一张
                  </button>
                  <span>
                    {activeResult + 1} / {resultUrls.length}
                  </span>
                  <button
                    disabled={activeResult === resultUrls.length - 1}
                    onClick={() => setActiveResult((index) => index + 1)}
                  >
                    下一张
                  </button>
                  {resultKind === "image" && (
                    <button onClick={queueCanvasInsert}>插入画布</button>
                  )}
                </div>
              </>
            ) : (
              templates.length > 0 ? (
                <div className={`ecommerce-template-mock ecommerce-template-mock--${activeTemplate}`}>
                  <div className="ecommerce-template-mock__topline" />
                  <div className="ecommerce-template-mock__image" />
                  <div className="ecommerce-template-mock__copy">
                    <i />
                    <i />
                    <i />
                  </div>
                  <strong>{templates.find((item) => item.id === activeTemplate)?.label}</strong>
                  <span>{busy ? `生成中 ${progress}%` : "先预览结构，再上传素材生成"}</span>
                </div>
              ) : (
                <div>
                  <Sparkles size={34} />
                  <strong>
                    {busy ? `生成中 ${progress}%` : "生成结果将在这里展示"}
                  </strong>
                  <span>
                    {busy
                      ? "正在提交并查询模型任务"
                      : "先上传素材，再完善右侧生成参数"}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      </main>
      <aside className="ecommerce-workbench__panel">
        <label className="ecommerce-upload">
          <input type="file" accept="image/*" multiple onChange={selectFiles} />
          <Upload size={18} />
          <span>
            {files.length ? `已选择 ${files.length} 张图片` : "上传商品原图"}
          </span>
          <small>支持 JPG、PNG，最多 3 张</small>
        </label>
        {currentTool.media === "video" && (
          <label className="ecommerce-upload ecommerce-upload--video">
            <input
              type="file"
              accept="video/*"
              onChange={(event) =>
                setReferenceVideo(event.target.files?.[0] ?? null)
              }
            />
            <Video size={18} />
            <span>
              {referenceVideo
                ? `已选择 ${referenceVideo.name}`
                : "上传参考视频"}
            </span>
            <small>支持 MP4、MOV，视频复刻时使用</small>
          </label>
        )}
        <label className="ecommerce-model-field">
          生成模型
          <select
            aria-label="生成模型"
            value={selectedModel}
            onChange={(event) =>
              setSelectedModels((current) => ({
                ...current,
                [activeModelType]: event.target.value,
              }))
            }
          >
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.shortLabel || model.label || model.id}
              </option>
            ))}
          </select>
          <small>
            {selectedModelConfig?.description ||
              `${activeModels.length} 个已配置${currentTool.media === "image" ? "图片" : "视频"}模型`}
          </small>
        </label>
        <div className="ecommerce-fields">
          <label>
            上架平台
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              {ECOMMERCE_PLATFORMS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            市场地区
            <select
              value={market}
              onChange={(event) => setMarket(event.target.value)}
            >
              <option>美国</option>
              <option>中国</option>
              <option>日本</option>
            </select>
          </label>
          <label>
            语言
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {ECOMMERCE_LANGUAGES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            图片/视频比例
            <select
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
            >
              {ECOMMERCE_RATIOS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="ecommerce-prompt">
          <span className="ecommerce-prompt__label">
            {currentTool.media === "video"
              ? "商品卖点（可选）"
              : category === "apparel"
                ? "补充要求"
                : "商品卖点与要求"}
            {currentTool.media === "image" && (
              <button
                type="button"
                className="ecommerce-assist"
                onClick={() => void writeSellingPoint()}
                disabled={assistBusy}
              >
                <Sparkles size={12} />
                {assistBusy ? "生成中…" : "AI 帮写"}
              </button>
            )}
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：突出材质、核心卖点、使用场景和画面风格"
          />
        </label>
        <div className="ecommerce-modules ecommerce-quick-options">
          <div className="ecommerce-modules__title">
            <span>
              <strong>快捷优化项</strong>
              <em>选择常用优化方向，可多选</em>
            </span>
            <button type="button" onClick={restoreQuickDefaults}>
              恢复推荐
            </button>
          </div>
          <div className="ecommerce-modules__grid">
            {quickOptions[tool].map((option) => {
              const checked = quickSelections[tool].has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={checked ? "is-selected" : ""}
                  aria-pressed={checked}
                  onClick={() => toggleQuickOption(option.id)}
                >
                  <span className="ecommerce-check">
                    {checked && <Check size={12} />}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {(tool === "product-set" ||
          tool === "video-replicate" ||
          category === "apparel" ||
          tool === "detail-page") && (
          <details className="ecommerce-advanced">
            <summary>
              更多设置 <span>按需调整</span>
            </summary>
            {tool === "product-set" && (
              <div className="ecommerce-choice">
                <strong>套图结构配置</strong>
                <label>
                  <input
                    type="radio"
                    checked={structure === "smart"}
                    onChange={() => setStructure("smart")}
                  />
                  智能匹配<span>AI 分析商品图并匹配 Listing 套图</span>
                </label>
                <label>
                  <input
                    type="radio"
                    checked={structure === "custom"}
                    onChange={() => setStructure("custom")}
                  />
                  自定义配置<span>自由调整各类型图片数量</span>
                </label>
                {structure === "custom" && (
                  <div className="ecommerce-counts" aria-label="商品套图数量">
                    {(
                      [
                        ["whiteBackground", "白底图"],
                        ["scene", "场景图"],
                        ["sellingPoint", "卖点图"],
                        ["other", "其他图片"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={12}
                          value={customCounts[key]}
                          onChange={(event) =>
                            updateCustomCount(key, Number(event.target.value))
                          }
                        />
                      </label>
                    ))}
                    <small>
                      共 {Object.values(customCounts).reduce((sum, count) => sum + count, 0)} 张，至少保留 1 张
                    </small>
                  </div>
                )}
              </div>
            )}
            {tool === "detail-page" && (
              <div className="ecommerce-modules ecommerce-detail-modules">
                <div className="ecommerce-modules__title">
                  <span>
                    <strong>详情页模块</strong>
                    <em>首屏主视觉为必选</em>
                  </span>
                  <button type="button" onClick={restoreQuickDefaults}>
                    恢复推荐
                  </button>
                </div>
                <div className="ecommerce-modules__grid">
                  {DETAIL_PAGE_MODULES.map((module) => {
                    const checked = quickSelections[tool].has(module.id);
                    return (
                      <button
                        key={module.id}
                        type="button"
                        className={checked ? "is-selected" : ""}
                        aria-pressed={checked}
                        disabled={module.required}
                        onClick={() => toggleQuickOption(module.id)}
                      >
                        <span className="ecommerce-check">
                          {checked && <Check size={12} />}
                        </span>
                        <span>
                          <strong>{module.label}</strong>
                          <small>{module.hint}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {tool === "video-replicate" && (
              <div className="ecommerce-choice">
                <strong>视频复刻模式</strong>
                <label>
                  <input
                    type="radio"
                    checked={videoMode === "完全复刻"}
                    onChange={() => setVideoMode("完全复刻")}
                  />
                  完全复刻<span>仅替换视频中的商品</span>
                </label>
                <label>
                  <input
                    type="radio"
                    checked={videoMode === "相似复刻"}
                    onChange={() => setVideoMode("相似复刻")}
                  />
                  相似复刻<span>复刻镜头和转场但保持差异</span>
                </label>
              </div>
            )}
            {category === "apparel" && (
              <div className="ecommerce-modules">
                <div className="ecommerce-modules__title">
                  <strong>生成类型</strong>
                  <span>可多选</span>
                </div>
                <div className="ecommerce-modules__grid">
                  {[
                    "白底精修图",
                    "3D 立体效果图",
                    "人台图",
                    "细节特写图",
                    "卖点图",
                  ].map((name) => (
                    <button
                      key={name}
                      className={apparelTypes.has(name) ? "is-selected" : ""}
                      onClick={() => toggleSet(setApparelTypes, name)}
                    >
                      <span className="ecommerce-check">
                        {apparelTypes.has(name) && <Check size={12} />}
                      </span>
                      <span>
                        <strong>{name}</strong>
                        <small>
                          {name === "白底精修图"
                            ? "正面/背面产品精修"
                            : name === "人台图"
                              ? "使用人台展示服装"
                              : "突出产品细节和卖点"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </details>
        )}
        {error && (
          <p className="ecommerce-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="ecommerce-generate"
          disabled={
            busy ||
            (currentTool.media === "image" && !files.length) ||
            (currentTool.media === "video" && !files.length && !referenceVideo) ||
            (tool === "product-set" && structure === "custom" && customTotal < 1)
          }
          onClick={() => void generate()}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              正在生成 {progress}%
            </>
          ) : (
            <>
              <Sparkles size={17} />
              生成{currentTool.media === "video" ? "视频" : "图片"}
            </>
          )}
        </button>
      </aside>
    </section>
  );
}

export default EcommerceWorkbench;
