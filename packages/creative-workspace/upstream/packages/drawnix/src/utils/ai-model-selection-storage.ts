import { AI_MODEL_SELECTION_CACHE_KEY } from '../constants/storage';
import type { ModelVendor } from '../constants/model-config';
import type { ModelRef } from './settings-manager';
import type { GenerationType } from './ai-input-parser';

export type PersistedGenerationType = GenerationType;

export interface PersistedModelSelection {
  modelId: string;
  profileId: string | null;
  providerIdHint: string | null;
  vendorHint: ModelVendor | null;
  updatedAt: number;
}

type PersistedModelSelectionMap = Partial<
  Record<PersistedGenerationType, PersistedModelSelection>
>;

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPersistedGenerationType(
  value: unknown
): value is PersistedGenerationType {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'text' ||
    value === 'agent'
  );
}

function isPersistedModelSelection(
  value: unknown
): value is PersistedModelSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const selection = value as Record<string, unknown>;
  return (
    typeof selection.modelId === 'string' &&
    selection.modelId.trim().length > 0 &&
    (selection.profileId === null || typeof selection.profileId === 'string') &&
    (selection.providerIdHint === null ||
      typeof selection.providerIdHint === 'string') &&
    (selection.vendorHint === null || typeof selection.vendorHint === 'string') &&
    typeof selection.updatedAt === 'number' &&
    Number.isFinite(selection.updatedAt)
  );
}

function readCache(): PersistedModelSelectionMap {
  try {
    const raw = window.localStorage.getItem(AI_MODEL_SELECTION_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const next: PersistedModelSelectionMap = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (isPersistedGenerationType(key) && isPersistedModelSelection(value)) {
        next[key] = {
          modelId: value.modelId.trim(),
          profileId: normalizeString(value.profileId),
          providerIdHint: normalizeString(value.providerIdHint),
          vendorHint: normalizeString(value.vendorHint) as ModelVendor | null,
          updatedAt: value.updatedAt,
        };
      }
    });
    return next;
  } catch {
    return {};
  }
}

function writeCache(cache: PersistedModelSelectionMap): void {
  try {
    const hasEntries = Object.values(cache).some(Boolean);
    if (!hasEntries) {
      window.localStorage.removeItem(AI_MODEL_SELECTION_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(
      AI_MODEL_SELECTION_CACHE_KEY,
      JSON.stringify(cache)
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}

export function getPersistedModelSelection(
  type: PersistedGenerationType
): PersistedModelSelection | null {
  const cache = readCache();
  if (cache[type]) {
    return cache[type] || null;
  }

  if (type === 'agent') {
    return cache.text || null;
  }

  return null;
}

export function setPersistedModelSelection(
  type: PersistedGenerationType,
  selection: {
    modelId: string;
    modelRef?: ModelRef | null;
    providerIdHint?: string | null;
    vendorHint?: ModelVendor | null;
  }
): void {
  const modelId = normalizeString(selection.modelId);
  if (!modelId) {
    clearPersistedModelSelection(type);
    return;
  }

  const cache = readCache();
  cache[type] = {
    modelId,
    profileId: normalizeString(selection.modelRef?.profileId),
    providerIdHint: normalizeString(selection.providerIdHint),
    vendorHint: normalizeString(selection.vendorHint) as ModelVendor | null,
    updatedAt: Date.now(),
  };
  writeCache(cache);
}

export function clearPersistedModelSelection(
  type: PersistedGenerationType
): void {
  const cache = readCache();
  if (!cache[type]) {
    return;
  }
  delete cache[type];
  writeCache(cache);
}
