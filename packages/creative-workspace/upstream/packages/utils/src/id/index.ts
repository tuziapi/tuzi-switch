/**
 * ID Generation Utilities
 *
 * Functions for generating unique identifiers.
 */

/**
 * Generate a UUID v4 using the browser's native crypto API
 *
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 *
 * @example
 * generateUUID() // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateUUID(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const timestamp = Date.now().toString(16).padStart(12, '0');
  const random = Math.random().toString(16).slice(2).padEnd(20, '0');
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-4${random.slice(0, 3)}-8${random.slice(3, 6)}-${random.slice(6, 18)}`;
}

/**
 * Generate a unique ID with optional prefix
 *
 * Format: `${prefix}_${timestamp}_${random}` or `${timestamp}_${random}`
 *
 * @param prefix - Optional prefix (e.g., 'task', 'prompt', 'scene')
 * @returns A unique identifier string
 *
 * @example
 * generateId() // "1704067200000_abc123"
 * generateId('task') // "task_1704067200000_abc123"
 * generateId('prompt') // "prompt_1704067200000_xyz789"
 */
export function generateId(prefix?: string): string {
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  return prefix ? `${prefix}_${id}` : id;
}
