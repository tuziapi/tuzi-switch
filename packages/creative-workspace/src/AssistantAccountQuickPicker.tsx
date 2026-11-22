import { useEffect, useMemo, useState } from "react";
import type { ModelConfig } from "../upstream/packages/drawnix/src/constants/model-config";
import {
  completeAssistantQuickSetup,
  type AssistantCreationSetupRequest,
} from "../upstream/packages/drawnix/src/services/assistant-creation-setup";
import {
  ACCOUNT_REFERENCE_PREFIX,
  getAssistantAccount,
} from "../upstream/packages/drawnix/src/services/assistant-account";
import {
  providerProfilesSettings,
  settingsManager,
  type ModelRef,
  type ProviderProfile,
} from "../upstream/packages/drawnix/src/utils/settings-manager";
import { runtimeModelDiscovery } from "../upstream/packages/drawnix/src/utils/runtime-model-discovery";

function isUsableKey(key: {
  status: number;
  is_expired?: boolean;
  expired_time: number;
}) {
  return (
    key.status === 1 &&
    !key.is_expired &&
    (key.expired_time === -1 || key.expired_time * 1000 > Date.now())
  );
}

function createAccountProfile(
  profileId: string,
  name: string,
  baseUrl: string,
  reference: string,
): ProviderProfile {
  return {
    id: profileId,
    name: `兔子账户 · ${name || "API Key"}`,
    iconUrl: "",
    homepageUrl: "https://api.tu-zi.com",
    providerType: "openai-compatible",
    baseUrl: `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "")}/v1`,
    apiKey: reference,
    authType: "bearer",
    imageApiCompatibility: "auto",
    enabled: true,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsAudio: true,
      supportsTools: true,
    },
  };
}

export function AssistantAccountQuickPicker({
  request,
  onFallback,
  onComplete,
}: {
  request: AssistantCreationSetupRequest;
  onFallback: () => void;
  onComplete: () => void;
}) {
  const bridge = getAssistantAccount();
  const [keys, setKeys] = useState<
    Awaited<ReturnType<NonNullable<typeof bridge>["listKeys"]>>["items"]
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const usableKeys = useMemo(() => keys.filter(isUsableKey), [keys]);
  const selectedKey = usableKeys.find((key) => key.id === selectedKeyId);
  const requestedModelId =
    typeof request.model === "string"
      ? request.model
      : request.model?.modelId || "";

  useEffect(() => {
    let alive = true;
    if (!bridge || bridge.state.status !== "connected") {
      completeAssistantQuickSetup({ configured: false });
      onFallback();
      return;
    }
    setLoading(true);
    void bridge
      .listKeys(1, "")
      .then((result) => {
        if (!alive) return;
        const next = result.items.filter(isUsableKey);
        setKeys(result.items);
        if (next.length === 0) {
          completeAssistantQuickSetup({ configured: false });
          onFallback();
        } else setSelectedKeyId(next[0].id);
      })
      .catch(() => {
        if (alive) setError("无法读取账户令牌，请打开完整配置重试。");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bridge, onFallback]);

  useEffect(() => {
    if (!bridge || !selectedKey || busy) return;
    let alive = true;
    setBusy(true);
    setError("");
    void (async () => {
      const binding = await bridge.bindKey(selectedKey.id);
      const profileId = `assistant-account-${binding.tokenId}`;
      const profile = createAccountProfile(
        profileId,
        binding.name,
        binding.accountOrigin,
        `${ACCOUNT_REFERENCE_PREFIX}${binding.id}`,
      );
      const discovered = await runtimeModelDiscovery.discover(
        profileId,
        profile.baseUrl,
        profile.apiKey,
        [],
        { selectAll: true },
      );
      if (!alive) return;
      const eligible = discovered.filter((item) => item.type === request.type);
      if (!eligible.length) throw new Error("此账户令牌没有可用的图片模型。");
      const current = providerProfilesSettings.get();
      await providerProfilesSettings.update([
        ...current.filter((item) => item.id !== profileId),
        profile,
      ]);
      setModels(eligible);
      setSelectedModelId(
        eligible.some((item) => item.id === requestedModelId)
          ? requestedModelId
          : eligible[0].id,
      );
    })()
      .catch((reason: unknown) => {
        if (alive)
          setError(
            reason instanceof Error
              ? reason.message
              : "账户令牌校验失败，请打开完整配置重试。",
          );
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [bridge, selectedKey, request.type, requestedModelId]);

  const confirm = async () => {
    if (!selectedKey || !selectedModelId || busy) return;
    setBusy(true);
    try {
      const binding = await bridge!.bindKey(selectedKey.id);
      const profileId = `assistant-account-${binding.tokenId}`;
      const model: ModelRef = { profileId, modelId: selectedModelId };
      await settingsManager.updateActiveInvocationRouteModel(
        request.type,
        model,
      );
      completeAssistantQuickSetup({ configured: true, model });
      onComplete();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "保存账户配置失败，请打开完整配置重试。",
      );
      setBusy(false);
    }
  };

  const cancel = () => {
    completeAssistantQuickSetup({ configured: false });
    onFallback();
  };

  return (
    <div className="creative-account-quick-backdrop">
      <section
        className="creative-account-quick-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="creative-account-quick-title"
      >
        <h2 id="creative-account-quick-title">选择兔子账户令牌</h2>
        <p>选择账户令牌并获取可用模型，完成后会继续本次生图。</p>
        {loading ? (
          <p role="status">正在读取账户令牌…</p>
        ) : (
          <>
            <div className="creative-account-quick-list" aria-label="账户令牌">
              {usableKeys.map((key) => (
                <button
                  type="button"
                  key={key.id}
                  aria-pressed={selectedKeyId === key.id}
                  disabled={busy}
                  onClick={() => setSelectedKeyId(key.id)}
                >
                  <strong>{key.name || "未命名令牌"}</strong>
                  <small>
                    {key.masked_key} · {key.group || "未指定分组"}
                  </small>
                </button>
              ))}
            </div>
            {models.length > 0 && (
              <label className="creative-account-quick-model">
                <span>模型</span>
                <select
                  value={selectedModelId}
                  disabled={busy}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label || model.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {busy && !loading && <p role="status">正在校验令牌并获取模型…</p>}
        {error && <p role="alert">{error}</p>}
        <div className="creative-account-quick-actions">
          <button type="button" disabled={busy} onClick={cancel}>
            取消
          </button>
          <button
            type="button"
            disabled={busy || !selectedModelId}
            onClick={() => void confirm()}
          >
            继续生图
          </button>
        </div>
        {error && (
          <button
            type="button"
            className="creative-account-quick-fallback"
            disabled={busy}
            onClick={cancel}
          >
            打开完整配置
          </button>
        )}
      </section>
    </div>
  );
}
