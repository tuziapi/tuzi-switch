import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  ImageIcon,
  Loader2,
  CircleAlert,
} from "lucide-react";
import { imageStageLabels, type EcommerceBatch } from "./ecommerce-jobs";

export function EcommerceBatchPanel({
  batch,
  busy,
  onResume,
  onRetry,
  onSave,
  history,
  previewUrls = {},
  selectedItemId,
  onPreview,
}: {
  batch: EcommerceBatch;
  busy: boolean;
  onResume: () => void;
  onRetry: (id: string) => void;
  onSave: (blob: Blob, name: string) => void;
  history?: ReactNode;
  previewUrls?: Record<string, string>;
  selectedItemId?: string;
  onPreview?: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const completed = batch.items.filter(
    (item) => item.status === "complete",
  ).length;
  const allComplete = completed === batch.items.length;
  return (
    <section className="ecommerce-batch" aria-label="逐张生成任务">
      <header className="ecommerce-batch__header">
        <div className="ecommerce-batch__heading">
          <strong>
            {allComplete ? (
              <CheckCircle2 size={16} aria-hidden="true" />
            ) : (
              <ImageIcon size={16} aria-hidden="true" />
            )}
            已完成 {completed} / {batch.items.length} 张
          </strong>
          <span
            className="ecommerce-batch__model"
            title={batch.modelRef.modelId || undefined}
          >
            {batch.modelRef.modelId}
          </span>
        </div>
        {history}
        {!busy && batch.items.some((item) => item.status === "pending") && (
          <button onClick={onResume}>继续未发送的图片</button>
        )}
        <p className="ecommerce-batch__hint">
          {allComplete
            ? `原图已保存到本机；保存图片按 ${batch.size} 导出，比例不同时等比留边。`
            : "完成一张即保存一张，可切换页面继续等待。"}
        </p>
      </header>
      <ol>
        {batch.items.map((item) => {
          const attempt = item.attempts.at(-1);
          const isExpanded = expanded.has(item.id);
          const StatusIcon =
            item.status === "complete"
              ? CheckCircle2
              : item.status === "running"
                ? Loader2
                : item.status === "pending"
                  ? Clock3
                  : CircleAlert;
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
              className={`ecommerce-batch__item is-${item.status}${selectedItemId === item.id ? " is-selected" : ""}`}
            >
              <div className="ecommerce-batch__row">
                {previewUrls[item.id] && onPreview ? (
                  <button
                    className="ecommerce-batch__thumbnail"
                    onClick={() => onPreview(item.id)}
                    aria-label={`查看${item.label}`}
                    aria-pressed={selectedItemId === item.id}
                  >
                    <img src={previewUrls[item.id]} alt="" loading="lazy" />
                  </button>
                ) : (
                  <div
                    className="ecommerce-batch__placeholder"
                    aria-hidden="true"
                  >
                    <StatusIcon
                      size={19}
                      className={item.status === "running" ? "spin" : ""}
                    />
                  </div>
                )}
                <div className="ecommerce-batch__info">
                  <strong>{item.label}</strong>
                  <span role="status">
                    <StatusIcon
                      size={12}
                      className={item.status === "running" ? "spin" : ""}
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                </div>
                <div className="ecommerce-batch__actions">
                  {item.image && (
                    <button
                      className="ecommerce-batch__save"
                      onClick={() => onSave(item.image!, `${item.label}.png`)}
                    >
                      <Download size={14} aria-hidden="true" />
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
                        {item.resultUrl || item.image
                          ? "重试保存"
                          : "重试这一张"}
                      </button>
                    )}
                  {attempt && (
                    <button
                      className="ecommerce-batch__details-toggle"
                      aria-label={`${item.label}请求详情`}
                      aria-expanded={isExpanded}
                      aria-controls={`ecommerce-details-${item.id}`}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    >
                      详情
                      <ChevronDown size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              {item.error && (
                <p className="ecommerce-batch__error">{item.error}</p>
              )}
              {attempt && isExpanded && (
                <div
                  className="ecommerce-batch__details"
                  id={`ecommerce-details-${item.id}`}
                >
                  <strong>
                    请求详情
                    {attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ""}
                  </strong>
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
                </div>
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
      {!allComplete && (
        <p className="ecommerce-batch__notice">
          退出应用会中断当前请求；重新打开后不会自动重发。
        </p>
      )}
    </section>
  );
}
