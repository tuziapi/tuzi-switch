import { useState } from "react";
import { imageStageLabels, type EcommerceBatch } from "./ecommerce-jobs";

export function EcommerceBatchPanel({
  batch,
  busy,
  onResume,
  onRetry,
  onSave,
}: {
  batch: EcommerceBatch;
  busy: boolean;
  onResume: () => void;
  onRetry: (id: string) => void;
  onSave: (blob: Blob, name: string) => void;
}) {
  const [confirmId, setConfirmId] = useState("");
  const completed = batch.items.filter(
    (item) => item.status === "complete",
  ).length;
  return (
    <section className="ecommerce-batch" aria-label="逐张生成任务">
      <div className="ecommerce-batch__heading">
        <strong>
          已完成 {completed} / {batch.items.length} 张
        </strong>
        <span>{batch.modelRef.modelId}</span>
        {!busy && batch.items.some((item) => item.status === "pending") && (
          <button onClick={onResume}>继续未发送的图片</button>
        )}
      </div>
      <p>
        图片逐张保存，可切换页面。退出应用会中断当前请求；重新打开后不会自动重发。
      </p>
      <ol>
        {batch.items.map((item) => {
          const attempt = item.attempts.at(-1);
          const label =
            item.status === "complete"
              ? "已保存"
              : item.status === "pending"
                ? "未发送"
                : item.status === "running"
                  ? imageStageLabels[attempt?.stage || "preparing"]
                  : item.status === "unknown"
                    ? "结果待核对"
                    : "未完成";
          return (
            <li
              key={item.id}
              className={`ecommerce-batch__item is-${item.status}`}
            >
              <div>
                <strong>{item.label}</strong>
                <span role="status">{label}</span>
                {item.image && (
                  <button
                    onClick={() => onSave(item.image!, `${item.label}.png`)}
                  >
                    保存图片
                  </button>
                )}
                {!busy &&
                  (item.status === "failed" || item.status === "unknown") && (
                    <button
                      onClick={() =>
                        item.resultUrl || item.image
                          ? onRetry(item.id)
                          : setConfirmId(item.id)
                      }
                    >
                      {item.resultUrl || item.image ? "重试保存" : "重试这一张"}
                    </button>
                  )}
              </div>
              {item.error && <p>{item.error}</p>}
              {attempt && (
                <details>
                  <summary>
                    请求详情
                    {attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ""}
                  </summary>
                  {item.attempts.map((a) => (
                    <p key={a.requestId}>
                      本地请求编号：<code>{a.requestId}</code>
                      <br />
                      开始：{new Date(a.startedAt).toLocaleString()}
                      {a.endedAt
                        ? ` · 用时 ${Math.round((a.endedAt - a.startedAt) / 1000)} 秒`
                        : ""}
                      {a.upstreamId && (
                        <>
                          <br />
                          服务端编号：<code>{a.upstreamId}</code>
                        </>
                      )}
                      {a.taskId && (
                        <>
                          <br />
                          服务端任务：<code>{a.taskId}</code>
                        </>
                      )}
                    </p>
                  ))}
                  <p>
                    “正在发送”表示已进入网络请求；收到响应前不能确认服务端已受理。
                  </p>
                </details>
              )}
              {confirmId === item.id && (
                <div role="alert" className="ecommerce-retry-confirm">
                  将重新请求这一张，可能产生新的费用。若上次超时或中断，请先核对调用明细。
                  <button
                    onClick={() => {
                      setConfirmId("");
                      onRetry(item.id);
                    }}
                  >
                    确认重试这一张
                  </button>
                  <button onClick={() => setConfirmId("")}>取消</button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
