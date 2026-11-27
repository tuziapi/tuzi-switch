import { getCompatibleParams } from "../upstream/packages/drawnix/src/constants/model-config";

export type ImagePurpose = "gallery" | "main" | "marketing";
export const IMAGE_PURPOSES = [
  { id: "gallery", label: "商品展示 / 详情" },
  { id: "main", label: "上架主图" },
  { id: "marketing", label: "营销 / 场景图" },
] as const;

// Use the canvas catalogue; expose only parameters consumed by this executor.
const imageParameterIds = new Set([
  "size",
  "resolution",
  "quality",
  "gpt_quality",
  "seedream_quality",
  "background",
  "output_format",
  "thinking",
]);
export function ecommerceImageParameters(model: string, protocol?: string) {
  const asyncRoute =
    protocol === "openai.async.media" || protocol === "openai.async.image.form";
  return getCompatibleParams(model)
    .filter(
      (p) =>
        p.modelType === "image" &&
        imageParameterIds.has(p.id) &&
        p.valueType === "enum" &&
        (!asyncRoute || p.id === "size") &&
        (protocol !== "google.generateContent" ||
          ["size", "quality", "thinking"].includes(p.id)),
    )
    .sort(
      (a, b) =>
        [
          "size",
          "resolution",
          "seedream_quality",
          "quality",
          "background",
          "output_format",
          "thinking",
        ].indexOf(a.id) -
        [
          "size",
          "resolution",
          "seedream_quality",
          "quality",
          "background",
          "output_format",
          "thinking",
        ].indexOf(b.id),
    );
}
export function resolveEcommerceImageParameters(
  model: string,
  values: Record<string, string>,
  protocol?: string,
) {
  return Object.fromEntries(
    ecommerceImageParameters(model, protocol).flatMap((param) => {
      const value = param.options?.some((o) => o.value === values[param.id])
        ? values[param.id]
        : param.defaultValue || param.options?.[0]?.value;
      return value ? [[param.id, value]] : [];
    }),
  );
}
export function ecommercePlatformGuidance(
  platform: string,
  purpose: ImagePurpose,
  video = false,
) {
  const social = ["TikTok Shop", "抖音电商"].includes(platform);
  const fashion = ["SHEIN"].includes(platform);
  const wholesale = ["1688", "阿里国际站"].includes(platform);
  const amazonMain = platform === "亚马逊" && purpose === "main" && !video;
  const ratio =
    video || (social && purpose === "marketing")
      ? "9:16"
      : fashion && purpose !== "main"
        ? "3:4"
        : "1:1";
  const guidance = amazonMain
    ? "主图使用纯白背景，完整展示实际出售商品；不添加营销文字、边框、水印或额外道具。品类例外以卖家后台为准。"
    : purpose === "main"
      ? "采用干净背景与完整商品构图，避免裁切主体；减少文字，不添加虚构认证或平台徽章。"
      : social
        ? "以移动端观看为目标，主体居中，关键信息避开上下边缘；使用具体场景和清晰的商品特写。"
        : wholesale
          ? "突出商品结构、细节和已提供的规格；不虚构起订量、交期、价格或认证。"
          : fashion
            ? "突出服装轮廓、搭配和面料细节；保持参考款式、花纹及人物身份一致。"
            : platform === "独立站"
              ? "同组保持一致比例、背景与品牌色，适配商品列表和详情展示，减少装饰性文字。"
              : "以清晰商品、场景和真实卖点组织画面；详情图保持信息层次，避免拥挤的文案。";
  return {
    ratio,
    guidance,
    label: "创作建议 · 非平台审核结论",
    prompt: `目标平台：${platform}；用途：${IMAGE_PURPOSES.find((p) => p.id === purpose)?.label}。${guidance}`,
    opaque: amazonMain,
  };
}

export function referenceRolePrompt(
  productCount: number,
  referenceCount: number,
  apparel = false,
) {
  if (!referenceCount) return "上传图片均为商品原图，以其可见外观为准。";
  return `输入图片按顺序：第1至${productCount}张为商品原图，只从这里确定商品的形状、颜色、标识和材质；第${productCount + 1}至${productCount + referenceCount}张为${apparel ? "人物 / 姿势 / 风格参考" : "风格参考图"}。参考图仅用于${apparel ? "人物身份、姿势和穿搭场景" : "构图、光影和背景风格"}，不得将参考图中的商品、品牌、文字或水印带入结果。`;
}
