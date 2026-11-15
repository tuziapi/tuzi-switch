import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from 'tdesign-react';
import { useProviderProfiles } from '../../hooks/use-provider-profiles';
import { providerProfilesSettings } from '../../utils/settings-manager';
import { CryptoUtils } from '../../utils/crypto-utils';
import { isTuziRequestRecoveryBaseUrl } from '../../services/provider-routing/tuzi-api-endpoints';
import './manual-image-recovery.scss';

export function ManualImageRecovery({ onInsert, onClose }: { onInsert: (url: string) => Promise<void | { remoteOnly?: boolean }>; onClose: () => void }) {
  const profiles = useProviderProfiles().filter(profile =>
    profile.enabled && isTuziRequestRecoveryBaseUrl(profile.baseUrl) &&
    Boolean(profile.apiKey?.trim()) && !CryptoUtils.isEncrypted(profile.apiKey.trim())
  );
  const [profileId, setProfileId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [inserted, setInserted] = useState<string[]>([]);
  const sequence = useRef(0);
  const queriedProfile = useRef<{ id: string; baseUrl: string; apiKey: string } | null>(null);

  useEffect(() => () => { sequence.current++; }, []);

  const clearResult = () => { sequence.current++; queriedProfile.current = null; setUrls([]); setInserted([]); setMessage(''); setBusy(false); };
  const close = () => { clearResult(); onClose(); };
  const query = async () => {
    const profile = profiles.find(item => item.id === profileId);
    const id = requestId.trim();
    if (!profile || !/^[\x21-\x7e]{1,191}$/.test(id)) {
      setMessage('请选择原请求使用的渠道并填写有效的请求 ID');
      return;
    }
    const originalBaseUrl = profile.baseUrl;
    const originalApiKey = profile.apiKey;
    const run = ++sequence.current;
    queriedProfile.current = null;
    setBusy(true); setUrls([]); setInserted([]); setMessage('');
    try {
      const { queryImageResult } = await import('../../services/query-image-result');
      const result = await queryImageResult(originalBaseUrl, originalApiKey, id);
      const current = providerProfilesSettings.get().find(item => item.id === profile.id);
      if (run !== sequence.current) return;
      if (!current || current.baseUrl !== originalBaseUrl || current.apiKey !== originalApiKey) {
        setMessage('渠道配置已改变，请确认原渠道后重新查询');
        return;
      }
      if (result?.status === 'failed') { setMessage('渠道确认该请求失败'); return; }
      if (result?.status !== 'succeeded') { setMessage('结果尚未找到，稍后可以再次查询'); return; }
      const found = Array.isArray(result.data) ? result.data.flatMap((item: { url?: unknown }) => {
        try {
          const url = new URL(typeof item?.url === 'string' ? item.url : '');
          return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? [url.toString()] : [];
        } catch { return []; }
      }) : [];
      const unique = [...new Set<string>(found)].slice(0, 10);
      queriedProfile.current = { id: profile.id, baseUrl: originalBaseUrl, apiKey: originalApiKey };
      setUrls(unique);
      if (!unique.length) setMessage('结果中没有可展示的图片');
    } catch {
      if (run === sequence.current) setMessage('查询失败，请检查原渠道、Key 和网络后重试');
    } finally {
      if (run === sequence.current) setBusy(false);
    }
  };
  const insert = async (url: string) => {
    const original = queriedProfile.current;
    const current = original && providerProfilesSettings.get().find(item => item.id === original.id);
    if (!original || !current || current.baseUrl !== original.baseUrl || current.apiKey !== original.apiKey || !current.enabled) {
      setMessage('渠道配置已改变，请确认原渠道后重新查询');
      return;
    }
    const run = sequence.current;
    setBusy(true); setMessage('');
    try {
      const result = await onInsert(url);
      if (run === sequence.current) { setInserted(previous => [...previous, url]); setMessage(result?.remoteOnly ? '图片已插入，但未能缓存到本地；远程链接可能过期，请及时下载备份。' : '图片已插入当前画布'); }
    } catch (error) {
      if (run === sequence.current) {
        setMessage('插入失败，请确认当前画布已打开；图片仍可在此预览');
      }
    } finally {
      if (run === sequence.current) setBusy(false);
    }
  };

  return <Dialog className="manual-image-recovery-dialog" header="找回图片" visible onClose={close} footer={false} width="min(620px, calc(100vw - 32px))" zIndex={11020}>
    <div className="manual-image-recovery">
      <label>原请求渠道<select value={profileId} disabled={busy} onChange={event => { clearResult(); setProfileId(event.target.value); }}>
        <option value="">选择渠道</option>
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
      <label>请求 ID<input value={requestId} disabled={busy} maxLength={191} onChange={event => { clearResult(); setRequestId(event.target.value); }} /></label>
      <Button theme="primary" loading={busy} disabled={busy} onClick={() => void query()}>查询图片</Button>
      {message && <p role="status">{message}</p>}
      <div className="manual-image-recovery__results">{urls.map(url => <div key={url} className="manual-image-recovery__result">
        <img src={url} alt="找回的图片" />
        <Button disabled={busy || inserted.includes(url)} onClick={() => void insert(url)}>{inserted.includes(url) ? '已插入' : '插入画布'}</Button>
      </div>)}</div>
    </div>
  </Dialog>;
}
