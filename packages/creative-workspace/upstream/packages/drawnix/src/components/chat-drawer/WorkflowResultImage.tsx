import React, { memo, useState } from "react";
import { RetryImage } from "../retry-image";

/** Resolve desktop cache addresses without submitting another generation task. */
export const WorkflowResultImage = memo(function WorkflowResultImage({
  url,
  thumbnailUrl,
  title,
  index,
  onPreview,
}: {
  url: string;
  thumbnailUrl?: string;
  title?: string;
  index: number;
  onPreview: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [useOriginal, setUseOriginal] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const source = !useOriginal && thumbnailUrl ? thumbnailUrl : url;
  const label = title || `生成结果 ${index + 1}`;

  return (
    <button
      type="button"
      className="workflow-bubble__media-item"
      aria-label={
        status === "failed"
          ? `重新加载生成结果 ${index + 1}`
          : `查看生成结果 ${index + 1}`
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (status === "failed") {
          setStatus("loading");
          setAttempt((value) => value + 1);
        } else if (status === "ready") {
          onPreview();
        }
      }}
    >
      <RetryImage
        key={`${source}-${attempt}`}
        src={source}
        alt={label}
        className="workflow-bubble__media-preview"
        preferCachedBlob
        eager
        maxRetries={1}
        loadTimeoutMs={20_000}
        showSkeleton={false}
        style={{ visibility: status === "ready" ? "visible" : "hidden" }}
        onLoadSuccess={() => setStatus("ready")}
        onLoadFailure={() => {
          // A missing thumbnail must not hide an available original result.
          if (source !== url) {
            setUseOriginal(true);
            setStatus("loading");
          } else {
            setStatus("failed");
          }
        }}
        fallback={
          <span className="workflow-bubble__media-status">
            <span>图片暂时无法显示</span>
            <span className="workflow-bubble__media-reload">重新加载图片</span>
          </span>
        }
      />
      {status === "loading" && (
        <span className="workflow-bubble__media-status" role="status">
          正在加载图片…
        </span>
      )}
    </button>
  );
});
