import { useEffect, useRef, useState } from "react";
import { KeyRound, UserRound, ChevronDown } from "lucide-react";
import type { ProviderProfile } from "../../utils/settings-types";
import type {
  CreativeAccountBinding,
  CreativeAccountKey,
} from "../../../../../../src/bridge-types";
import {
  ACCOUNT_REFERENCE_PREFIX,
  ASSISTANT_ACCOUNT_CHANGED,
  getAssistantAccount,
  isAccountReference,
} from "../../services/assistant-account";
import "./assistant-account-binding.scss";

export function AssistantAccountBinding({
  profile,
  onChange,
}: {
  profile: ProviderProfile;
  onChange: (patch: Partial<ProviderProfile>) => void;
}) {
  const [bridge, setBridge] = useState(getAssistantAccount);
  const [mode, setMode] = useState<"account" | "manual">(() =>
    !profile.apiKey ||
    isAccountReference(profile.apiKey) ||
    getAssistantAccount()?.selectedKeyId
      ? "account"
      : "manual",
  );
  const [keys, setKeys] = useState<CreativeAccountKey[]>([]);
  const [bindings, setBindings] = useState<CreativeAccountBinding[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [more, setMore] = useState(false);
  const [picker, setPicker] = useState(Boolean(bridge?.selectedKeyId));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const linked = isAccountReference(profile.apiKey);
  const binding = bindings.find(
    (item) => ACCOUNT_REFERENCE_PREFIX + item.id === profile.apiKey,
  );
  useEffect(() => {
    const update = () => setBridge(getAssistantAccount());
    window.addEventListener(ASSISTANT_ACCOUNT_CHANGED, update);
    return () => window.removeEventListener(ASSISTANT_ACCOUNT_CHANGED, update);
  }, []);
  useEffect(() => {
    const generation = ++revision.current;
    setKeys([]);
    setBindings([]);
    setError("");
    if (!bridge || bridge.state.status !== "connected" || mode !== "account") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      Promise.all([bridge.listKeys(page, search), bridge.listBindings()])
        .then(([data, saved]) => {
          if (generation !== revision.current) return;
          setKeys(data.items);
          setMore(data.has_more);
          setBindings(saved);
        })
        .catch(() => {
          if (generation === revision.current)
            setError("无法读取账户密钥，请稍后重试。");
        })
        .finally(() => {
          if (generation === revision.current) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      revision.current++;
    };
  }, [bridge, mode, page, search]);
  const choose = async (key: CreativeAccountKey) => {
    if (!bridge || busy) return;
    const generation = revision.current;
    setBusy(true);
    setError("");
    try {
      const saved = await bridge.bindKey(key.id);
      if (generation !== revision.current) return;
      setBindings((previous) => [
        ...previous.filter((item) => item.id !== saved.id),
        saved,
      ]);
      onChange({
        apiKey: ACCOUNT_REFERENCE_PREFIX + saved.id,
        baseUrl: saved.accountOrigin + "/v1",
        authType: "bearer",
        providerType: "openai-compatible",
        pricingGroup: saved.group,
        name: saved.name || profile.name,
        extraHeaders: undefined,
      });
      setPicker(false);
    } catch (e) {
      if (generation === revision.current)
        setError(e instanceof Error ? e.message : "关联失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="assistant-account-binding" aria-label="配置来源">
      <div className="assistant-account-binding__modes">
        <button
          type="button"
          aria-pressed={mode === "account"}
          disabled={busy}
          onClick={() => {
            setMode("account");
            setPicker(true);
          }}
        >
          <UserRound size={16} />
          兔子账户
        </button>
        <button
          type="button"
          aria-pressed={mode === "manual"}
          disabled={busy}
          onClick={() => {
            setMode("manual");
            setError("");
            if (linked) onChange({ apiKey: "" });
          }}
        >
          <KeyRound size={16} />
          手动配置
        </button>
      </div>
      {mode === "manual" ? (
        <p>使用下方的 API 地址和密钥，原有配置可以继续使用。</p>
      ) : bridge?.state.status !== "connected" ? (
        <div className="assistant-account-binding__status">
          <span>连接兔子助手账户后，可直接选择已有 Key。</span>
          <button type="button" onClick={() => bridge?.manageAccount()}>
            连接兔子账户
          </button>
        </div>
      ) : (
        <>
          <div className="assistant-account-binding__status">
            <span>
              {bridge.state.identity?.displayName ||
                bridge.state.identity?.username}{" "}
              · 已连接
            </span>
            <button type="button" onClick={bridge.manageAccount}>
              管理账户
            </button>
          </div>
          <button
            type="button"
            className="assistant-account-binding__selected"
            onClick={() => setPicker(!picker)}
            disabled={busy}
          >
            <span>
              <strong>
                {binding?.name ||
                  (linked ? "已关联的账户 Key" : "选择用于创作的 API Key")}
              </strong>
              <small>
                {binding
                  ? binding.keyMask + " · " + (binding.group || "未指定分组")
                  : linked
                    ? "重新校验后使用；切换账户不会复用此密钥"
                    : "无需复制或再次粘贴密钥"}
              </small>
            </span>
            <ChevronDown size={16} />
          </button>
          {picker && (
            <div className="assistant-account-binding__picker">
              <input
                aria-label="搜索账户 Key"
                placeholder="搜索密钥名称"
                value={search}
                disabled={busy}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              {loading ? (
                <p role="status">正在读取密钥…</p>
              ) : keys.length === 0 ? (
                <p>没有匹配的 Key，可前往账户创建。</p>
              ) : (
                keys.map((key) => {
                  const unavailable =
                    key.status !== 1 ||
                    key.is_expired ||
                    (key.expired_time !== -1 &&
                      key.expired_time * 1000 <= Date.now());
                  return (
                    <button
                      type="button"
                      key={key.id}
                      className="assistant-account-binding__key"
                      disabled={busy || unavailable}
                      onClick={() => void choose(key)}
                    >
                      <span>
                        <strong>
                          {key.name || "未命名 Key"}
                          {bridge.selectedKeyId === key.id ? " · 当前选择" : ""}
                        </strong>
                        <small>
                          {key.masked_key} · {key.group || "未指定分组"}
                        </small>
                      </span>
                      <span>
                        {unavailable ? "不可用" : busy ? "关联中…" : "选择"}
                      </span>
                    </button>
                  );
                })
              )}
              <div className="assistant-account-binding__pages">
                <button
                  type="button"
                  disabled={page === 1 || busy || loading}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>{page}</span>
                <button
                  type="button"
                  disabled={!more || busy || loading}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          )}
          <p>选择后沿用下方模型配置。点击“保存”后应用到创作。</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
