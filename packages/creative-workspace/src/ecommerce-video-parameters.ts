import { getCompatibleParams } from "../upstream/packages/drawnix/src/constants/model-config";
import {
  getViduDurationOptions,
  getViduVideoContract,
  resolveViduVideoAction,
  VIDU_ACTION_LABELS,
  VIDU_MIX_MODEL,
} from "../upstream/packages/drawnix/src/constants/vidu-video-models";
import { isPublicVideoMediaUrl } from "../upstream/packages/drawnix/src/services/tuzi-video-media";

/** Reuse the canvas contract; credentials and arbitrary provider fields never enter jobs. */
export function ecommerceVideoParameters(model: string) {
  return getViduVideoContract(model)
    ? getCompatibleParams(model.toLowerCase()).filter(
        (p) => !["duration", "size", "aspect_ratio"].includes(p.id),
      )
    : [];
}

export function resolveEcommerceVideoParameters(
  model: string,
  values: Record<string, string> = {},
) {
  return Object.fromEntries(
    ecommerceVideoParameters(model).flatMap((p) => {
      const value = values[p.id] ?? p.defaultValue;
      return typeof value === "string" && value !== "" ? [[p.id, value]] : [];
    }),
  );
}

export function ecommerceViduInput(
  model: string,
  values: Record<string, string>,
  imageCount: number,
) {
  const contract = getViduVideoContract(model);
  if (!contract) return { durations: undefined, error: "" };
  try {
    const action = resolveViduVideoAction(
      model,
      values.vidu_action,
      imageCount,
    );
    const durations = getViduDurationOptions(model, action);
    const count =
      action === "textGenerate"
        ? 0
        : action === "generate"
          ? 1
          : action === "firstTailGenerate"
            ? 2
            : undefined;
    if (count !== undefined && imageCount !== count)
      return {
        durations,
        error: `${VIDU_ACTION_LABELS[action]}需要 ${count} 张图片，请调整模式或素材数量。`,
      };
    if (
      action === "referenceGenerate" &&
      (imageCount < 1 || imageCount > contract.maxImages)
    )
      return {
        durations,
        error: `参考生视频需要 1–${contract.maxImages} 张图片。`,
      };
    if (model.toLowerCase() === VIDU_MIX_MODEL) {
      const sounds = (values.vidu_sound_urls || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sounds.length > 3)
        return { durations, error: "最多添加 3 段参考音频。" };
      if (sounds.some((s) => !isPublicVideoMediaUrl(s)))
        return {
          durations,
          error: "参考音频需要可公开访问的 HTTP(S) 地址，每行一个。",
        };
    }
    return { durations, error: "" };
  } catch (cause) {
    return {
      durations: getViduDurationOptions(model),
      error: cause instanceof Error ? cause.message : "视频参数无效。",
    };
  }
}
