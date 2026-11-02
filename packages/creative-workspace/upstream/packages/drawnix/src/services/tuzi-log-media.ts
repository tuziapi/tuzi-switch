const MAX_GENERATED_IMAGE_URLS = 12;
const MAX_GENERATED_IMAGE_URL_LENGTH = 8_192;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function normalizeGeneratedImageUrl(
  value: unknown,
  apiBaseUrl: string
): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_GENERATED_IMAGE_URL_LENGTH) {
    return null;
  }

  try {
    const isRelativePath =
      candidate.startsWith('/') && !candidate.startsWith('//');
    const parsed = isRelativePath
      ? new URL(candidate, `${apiBaseUrl.replace(/\/+$/, '')}/`)
      : new URL(candidate);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function appendUniqueUrl(
  urls: string[],
  seen: Set<string>,
  value: unknown,
  apiBaseUrl: string
): void {
  if (urls.length >= MAX_GENERATED_IMAGE_URLS) return;
  const url = normalizeGeneratedImageUrl(value, apiBaseUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  urls.push(url);
}

export function extractTuziGeneratedImageUrls(
  other: unknown,
  apiBaseUrl: string
): string[] {
  const metadata = asRecord(other);
  if (!metadata) return [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const delivery = asRecord(metadata.generated_image_delivery);
  const deliveryStatus = delivery?.status;
  const hasCanonicalDelivery =
    (deliveryStatus === 'completed' || deliveryStatus === 'interrupted') &&
    Array.isArray(delivery?.entries);

  if (hasCanonicalDelivery) {
    for (const value of delivery.entries as unknown[]) {
      const entry = asRecord(value);
      if (entry?.shown_to_user !== true) continue;
      appendUniqueUrl(urls, seen, entry.url, apiBaseUrl);
    }
    return urls;
  }

  const appendLegacyValue = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendUniqueUrl(urls, seen, item, apiBaseUrl);
      }
      return;
    }
    appendUniqueUrl(urls, seen, value, apiBaseUrl);
  };

  appendLegacyValue(metadata.generated_image_urls);
  appendLegacyValue(metadata.generated_image_url);
  return urls;
}
