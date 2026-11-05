export async function checksumJson(value: unknown): Promise<string> {
  return checksumString(JSON.stringify(value));
}

export async function checksumString(value: string): Promise<string> {
  if (
    typeof crypto !== 'undefined' &&
    crypto.subtle &&
    typeof TextEncoder !== 'undefined'
  ) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
