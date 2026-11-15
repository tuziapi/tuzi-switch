import { createModelRef, type ModelRef } from '../../../utils/settings-manager';

export interface StoredModelSelection {
  modelId: string;
  modelRef: ModelRef | null;
}

export function readStoredModelSelection(
  key: string,
  fallbackModel: string,
  fallbackModelRef: ModelRef | null = null
): StoredModelSelection {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { modelId: fallbackModel, modelRef: fallbackModelRef };
    }

    const parsed = JSON.parse(raw) as {
      modelId?: string;
      profileId?: string | null;
    };

    if (typeof parsed.modelId === 'string' && parsed.modelId.trim()) {
      return {
        modelId: parsed.modelId.trim(),
        modelRef: createModelRef(parsed.profileId || null, parsed.modelId),
      };
    }
  } catch {
    // 兼容旧格式：直接存储 modelId 字符串
  }

  let legacyModelId: string | null = null;
  try {
    legacyModelId = localStorage.getItem(key);
  } catch {
    // localStorage 不可用时静默降级
  }

  return {
    modelId: legacyModelId || fallbackModel,
    modelRef: legacyModelId ? null : fallbackModelRef,
  };
}

export function writeStoredModelSelection(
  key: string,
  modelId: string,
  modelRef?: ModelRef | null
): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        modelId,
        profileId: modelRef?.profileId || null,
      })
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}
