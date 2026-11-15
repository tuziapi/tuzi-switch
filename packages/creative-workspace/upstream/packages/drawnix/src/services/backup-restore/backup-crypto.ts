import { decrypt, encrypt } from '@aitu/utils';

export interface BackupEncryptedJson {
  version: 1;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  createdAt: number;
  payload: string;
}

export async function encryptBackupJson(
  value: unknown,
  password: string
): Promise<BackupEncryptedJson> {
  const normalizedPassword = normalizeBackupPassword(password);
  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    createdAt: Date.now(),
    payload: await encrypt(JSON.stringify(value), normalizedPassword),
  };
}

export async function decryptBackupJson<T = unknown>(
  encrypted: BackupEncryptedJson,
  password: string
): Promise<T> {
  const normalizedPassword = normalizeBackupPassword(password);
  if (
    !encrypted ||
    encrypted.version !== 1 ||
    encrypted.algorithm !== 'AES-GCM' ||
    typeof encrypted.payload !== 'string'
  ) {
    throw new Error('敏感配置文件格式无效');
  }
  const plaintext = await decrypt(encrypted.payload, normalizedPassword);
  return JSON.parse(plaintext) as T;
}

function normalizeBackupPassword(password: string): string {
  const normalized = password?.trim();
  if (!normalized) {
    throw new Error('需要输入备份密码');
  }
  return normalized;
}
