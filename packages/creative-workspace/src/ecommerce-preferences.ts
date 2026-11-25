/** Local editor preferences only. Never store providers, credentials or media here. */
export const ECOMMERCE_PREFERENCES_KEY = "opentu-ecommerce-preferences-v1";

export type EcommercePreferences = {
  selectedModels: { image: string; video: string };
  prompt: string;
  quickSelections: Record<string, string[]>;
  videoDuration: string;
  videoSize: string;
  videoRatio: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const shortText = (value: unknown, limit = 512): value is string =>
  typeof value === "string" && value.length <= limit;

export function readEcommercePreferences(): Partial<EcommercePreferences> {
  try {
    const raw = localStorage.getItem(ECOMMERCE_PREFERENCES_KEY);
    if (!raw || raw.length > 64_000) return {};
    const data: unknown = JSON.parse(raw);
    if (!object(data) || data.version !== 1) return {};
    const result: Partial<EcommercePreferences> = {};
    if (
      object(data.selectedModels) &&
      shortText(data.selectedModels.image) &&
      shortText(data.selectedModels.video)
    ) {
      result.selectedModels = {
        image: data.selectedModels.image,
        video: data.selectedModels.video,
      };
    }
    if (shortText(data.prompt, 20_000)) result.prompt = data.prompt;
    if (shortText(data.videoDuration, 16))
      result.videoDuration = data.videoDuration;
    if (shortText(data.videoSize, 64)) result.videoSize = data.videoSize;
    if (data.videoRatio === "16:9" || data.videoRatio === "9:16")
      result.videoRatio = data.videoRatio;
    if (object(data.quickSelections)) {
      result.quickSelections = Object.fromEntries(
        Object.entries(data.quickSelections).filter(
          ([key, value]) =>
            /^[a-z-]{1,40}$/.test(key) &&
            Array.isArray(value) &&
            value.length <= 64 &&
            value.every((id) => shortText(id, 80)),
        ),
      ) as Record<string, string[]>;
    }
    return result;
  } catch {
    // A corrupt or unavailable preference store must not block creation/history.
    return {};
  }
}

export function saveEcommercePreferences(value: EcommercePreferences) {
  try {
    localStorage.setItem(
      ECOMMERCE_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        selectedModels: {
          image: value.selectedModels.image,
          video: value.selectedModels.video,
        },
        prompt: value.prompt.slice(0, 20_000),
        quickSelections: value.quickSelections,
        videoDuration: value.videoDuration,
        videoSize: value.videoSize,
        videoRatio: value.videoRatio,
      }),
    );
  } catch {
    // Storage quota/privacy settings do not prevent this session's work.
  }
}
