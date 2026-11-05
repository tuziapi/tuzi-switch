import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/** Bind a query to the submitted credential without persisting the credential. */
export function imageRecoveryCredentialIdentity(requestId: string, baseUrl: string, apiKey: string): string {
  return bytesToHex(hmac(sha256, apiKey.trim(), JSON.stringify(['image-recovery-v1', requestId, baseUrl.trim()])));
}
