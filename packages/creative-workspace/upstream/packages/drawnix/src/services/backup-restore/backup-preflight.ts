import type JSZip from 'jszip';
import type { BackupManifest } from './types';
import { checksumJson } from './backup-checksum';

/** Validate the whole archive before any store is cleared or changed.
 * This is not a cross-database transaction: write/quota failures remain separate.
 */
export async function validateBackupPayload(
  zip: JSZip,
  manifest: BackupManifest,
  mode: 'merge' | 'replace',
): Promise<void> {
  if (mode === 'replace' && (Number(manifest.totalParts || 1) > 1 || Number(manifest.partIndex || 1) > 1)) {
    throw new Error('分片备份不能逐片覆盖恢复，请使用合并恢复，原数据未修改');
  }
  const parsed = new Map<string, any>();
  for (const [name, entry] of Object.entries(zip.files)) {
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || name;
    if (original.startsWith('/') || original.includes('\\') || original.split('/').includes('..') || /^[A-Za-z]:/.test(original)) {
      throw new Error('备份含不安全路径，原数据未修改');
    }
    if (entry.dir || !/\.(json|drawnix)$/.test(name)) continue;
    let value: any;
    try { value = JSON.parse(await entry.async('string')); }
    catch { throw new Error(`备份文件损坏：${name}，原数据未修改`); }
    if (!value || typeof value !== 'object') throw new Error(`备份数据格式无效：${name}`);
    if (name.endsWith('.drawnix') && !Array.isArray(value.elements)) throw new Error(`画板数据格式无效：${name}`);
    if (name === 'tasks.json' && !Array.isArray(value)) throw new Error('任务数据格式无效');
    parsed.set(name, value);
  }
  const domains = {
    prompts: 'prompts.json', environment: 'environment/data.json',
    knowledgeBase: 'knowledge-base.json', tasks: 'tasks.json',
  } as const;
  for (const [domain, name] of Object.entries(domains)) {
    const stats = manifest.domainStats?.[domain];
    const value = parsed.get(name);
    const firstPart = Number(manifest.partIndex || 1) === 1;
    if (firstPart && stats && !value) throw new Error(`备份缺少数据：${name}，原数据未修改`);
    if (value && stats?.checksum) {
      let checksum: string;
      if (stats.checksum.startsWith('fnv1a-')) {
        let hash = 2166136261;
        const text = JSON.stringify(value);
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        checksum = `fnv1a-${(hash >>> 0).toString(16)}`;
      } else checksum = await checksumJson(value);
      if (checksum !== stats.checksum) throw new Error(`备份校验不匹配：${name}，原数据未修改`);
    }
  }
  if (Number(manifest.totalParts || 1) === 1 && manifest.includes.projects) {
    const count = [...parsed.keys()].filter(name => name.startsWith('projects/') && name.endsWith('.drawnix')).length;
    if (typeof manifest.stats?.boardCount === 'number' && count !== manifest.stats.boardCount) {
      throw new Error('备份画板数量不完整，原数据未修改');
    }
  }
}
