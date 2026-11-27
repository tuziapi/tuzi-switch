/** Local editor preferences only. Never store providers, credentials or media here. */
export const ECOMMERCE_PREFERENCES_KEY = "opentu-ecommerce-preferences-v1";
export type CreationPreferences = {
  paramsByModel: Record<string, Record<string, string>>;
  modes: Record<string, "combined" | "separate">;
  counts: Record<string, number>;
  perOutput: Record<string, Record<string, number>>;
  purpose: "main" | "gallery" | "marketing";
};

export type EcommercePreferences = {
  selectedModels: { image: string; video: string };
  prompt: string;
  quickSelections: Record<string, string[]>;
  videoDuration: string;
  videoSize: string;
  videoRatio: string;
  creation?: CreationPreferences;
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
    if (object(data.creation)) {
      const c = data.creation;
      const maps = <T>(
        value: unknown,
        valid: (v: unknown) => v is T,
      ): Record<string, T> =>
        object(value)
          ? Object.fromEntries(
              Object.entries(value)
                .filter(
                  (entry): entry is [string, T] =>
                    shortText(entry[0], 200) && valid(entry[1]),
                )
                .slice(0, 100),
            )
          : {};
      const count = (v: unknown): v is number =>
        typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;
      result.creation = {
        paramsByModel: Object.fromEntries(
          Object.entries(object(c.paramsByModel) ? c.paramsByModel : {})
            .slice(0, 100)
            .map(([k, v]) => [
              k,
              maps(v, (x): x is string => shortText(x, 64)),
            ]),
        ),
        modes: maps(
          c.modes,
          (v): v is "combined" | "separate" =>
            v === "combined" || v === "separate",
        ),
        counts: maps(c.counts, count),
        perOutput: Object.fromEntries(
          Object.entries(object(c.perOutput) ? c.perOutput : {})
            .slice(0, 100)
            .map(([k, v]) => [k, maps(v, count)]),
        ),
        purpose:
          c.purpose === "main" || c.purpose === "marketing"
            ? c.purpose
            : "gallery",
      };
    }
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
    if (
      typeof data.videoRatio === "string" &&
      ["16:9", "9:16", "1:1", "3:4", "4:3", "auto"].includes(data.videoRatio)
    )
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
        creation: value.creation,
      }),
    );
  } catch {
    // Storage quota/privacy settings do not prevent this session's work.
  }
}
