import React, { useSyncExternalStore } from "react";
import { Plug, Unplug, Loader2 } from "lucide-react";
import { localCodex } from "../../services/text-chat/local-codex";

export function DiscussionBackend({
  children,
  busy,
}: {
  children: React.ReactNode;
  busy: boolean;
}) {
  const state = useSyncExternalStore(
    localCodex.subscribe,
    localCodex.getSnapshot,
  );
  const model = state.models.find((m) => m.id === state.model);
  const working = busy || state.running > 0;
  return (
    <div className="discussion-backend" data-testid="discussion-backend">
      <div className="discussion-backend__row">
        <span>{state.enabled ? "Codex 模型" : "讨论模型"}</span>
        {state.enabled ? (
          <>
            <select
              aria-label="Codex 文本模型"
              value={state.model}
              disabled={working || state.connecting}
              onChange={(e) => localCodex.select(e.target.value)}
            >
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {!!model?.efforts.length && (
              <select
                aria-label="Codex 思考强度"
                value={state.effort || ""}
                disabled={working || state.connecting}
                onChange={(e) => localCodex.setEffort(e.target.value)}
              >
                {model.efforts.map((e) => (
                  <option key={e} value={e}>
                    {(
                      {
                        none: "无",
                        minimal: "最少",
                        low: "低",
                        medium: "中",
                        high: "高",
                        xhigh: "更高",
                        max: "最高",
                        ultra: "极高",
                      } as Record<string, string>
                    )[e] || e}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              title="断开后使用原来选择的文本模型"
              disabled={working}
              onClick={() => localCodex.disconnect()}
            >
              <Unplug size={13} />
              断开
            </button>
          </>
        ) : (
          <>
            {children}
            <button
              type="button"
              disabled={working || state.connecting}
              onClick={() => void localCodex.connect()}
            >
              {state.connecting ? (
                <Loader2 className="text-chat-spin" size={13} />
              ) : (
                <Plug size={13} />
              )}
              {state.connecting ? "连接中…" : "连接本地 Codex"}
            </button>
          </>
        )}
      </div>
      {state.enabled && !state.error && (
        <small>本地 Codex 已启用 · 生成仍使用已选媒体模型</small>
      )}
      {state.error && (
        <div className="discussion-backend__error" role="alert">
          {state.error}
          {state.enabled && (
            <button
              type="button"
              disabled={working || state.connecting}
              onClick={() => void localCodex.connect()}
            >
              重新连接
            </button>
          )}
        </div>
      )}
    </div>
  );
}
