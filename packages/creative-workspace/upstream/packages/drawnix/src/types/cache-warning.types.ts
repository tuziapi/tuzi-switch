/**
 * Cache warning metadata for media that could not be persisted locally.
 */
export type CacheWarningReasonCode =
  | 'cors_opaque'
  | 'network_error'
  | 'http_error'
  | 'response_unreadable'
  | 'storage_error'
  | 'cache_missing'
  | 'unknown';

export interface CacheWarning {
  status: 'failed' | 'unavailable';
  reasonCode: CacheWarningReasonCode;
  message: string;
  detectedAt: number;
  expiresHint?: string;
}
