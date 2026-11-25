import {
  getStaticModelConfig,
  getStaticModelsByType,
  type ModelType,
} from "../upstream/packages/drawnix/src/constants/model-config";

export function ecommerceModelSelectionKey(model: {
  id: string;
  sourceProfileId?: string | null;
}) {
  return JSON.stringify([model.sourceProfileId || null, model.id]);
}

export function ecommerceVideoFollowsFirstFrame(
  modelId: string,
  imageCount: number,
  hasReferenceVideo: boolean,
) {
  return (
    modelId.toLowerCase() === "minimax-h3" &&
    imageCount > 0 &&
    !hasReferenceVideo
  );
}

/** Remote endpoint lists can incorrectly mark image models as video models. */
export function matchesEcommerceModelType(
  id: string | null | undefined,
  type: ModelType,
) {
  if (!id) return false;
  if (id.toLowerCase() === "gpt-image-2.6") return type === "image";
  const known =
    getStaticModelConfig(id) ||
    getStaticModelsByType("image").find((model) => model.shortLabel === id);
  // Preserve custom model IDs; their configured invocation remains authoritative.
  return !known || known.type === type;
}
