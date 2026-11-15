import type { ProviderVideoBindingMetadata } from '../services/provider-routing/types';

export const GEMINI_OMNI_MODEL_ID = 'gemini-omni-1.2-flash';
export const GEMINI_OMNI_LEGACY_MODEL_ID = 'gemini-omni-1.1-flash';
export const GEMINI_OMNI_MODEL_IDS = [
  GEMINI_OMNI_LEGACY_MODEL_ID,
  GEMINI_OMNI_MODEL_ID,
] as const;
export const isGeminiOmniModel = (id?: string | null) =>
  GEMINI_OMNI_MODEL_IDS.includes(
    id?.trim().toLowerCase() as (typeof GEMINI_OMNI_MODEL_IDS)[number]
  );
export const GEMINI_OMNI_DURATIONS = Array.from({ length: 13 }, (_, i) => String(i + 3));
export const GEMINI_OMNI_LEGACY_DURATIONS = Array.from({ length: 8 }, (_, i) => String(i + 3));
export const GEMINI_OMNI_SIZES = [
  ['360P', '640x360', '360x640'],
  ['720P', '1280x720', '720x1280'],
  ['1080P', '1920x1080', '1080x1920'],
  ['4K', '3840x2160', '2160x3840'],
].flatMap(([label, landscape, portrait]) => [
  { label: `${label} · 横屏 16:9`, value: landscape, aspectRatio: '16:9' },
  { label: `${label} · 竖屏 9:16`, value: portrait, aspectRatio: '9:16' },
]);
export const GEMINI_OMNI_VIDEO_METADATA: ProviderVideoBindingMetadata = {
  allowedDurations: GEMINI_OMNI_DURATIONS,
  defaultDuration: '10',
  durationMode: 'request-param',
  durationField: 'seconds',
  strictDurationValidation: true,
  resultMode: 'download-content',
  downloadPathTemplate: '/videos/{taskId}/content',
};
export function getGeminiOmniVideoMetadata(modelId?: string | null): ProviderVideoBindingMetadata {
  return modelId?.toLowerCase() === GEMINI_OMNI_LEGACY_MODEL_ID
    ? { ...GEMINI_OMNI_VIDEO_METADATA, allowedDurations: GEMINI_OMNI_LEGACY_DURATIONS, defaultDuration: '4' }
    : GEMINI_OMNI_VIDEO_METADATA;
}
