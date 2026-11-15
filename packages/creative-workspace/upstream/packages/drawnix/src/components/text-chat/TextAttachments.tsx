import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import {
  readTextAttachment,
  type TextAttachmentRef,
  type TextAttachmentRecord,
} from "../../services/text-chat/attachments";

const AttachmentCard = memo(function AttachmentCard({
  attachment,
  remove,
}: {
  attachment: TextAttachmentRef;
  remove?: (id: string) => void;
}) {
  const [record, setRecord] = useState<TextAttachmentRecord | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (attachment.kind !== "image" && !open) return;
    let active = true;
    void readTextAttachment(attachment)
      .then((r) => {
        if (active)
          setRecord(
            !open && r.thumbnailDataUrl ? { ...r, dataUrl: undefined } : r,
          );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [attachment.id, attachment.kind, open]);
  useEffect(() => {
    if (open) preview.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <div className="text-chat-attachment" data-attachment-id={attachment.id}>
        <button
          ref={trigger}
          type="button"
          className="text-chat-attachment-open"
          aria-label={`预览附件 ${attachment.name}`}
          onClick={() => setOpen(true)}
        >
          {attachment.kind === "image" ? (
            record?.thumbnailDataUrl || record?.dataUrl ? (
              <img
                src={record.thumbnailDataUrl || record.dataUrl}
                alt=""
                loading="lazy"
              />
            ) : (
              <ImageIcon />
            )
          ) : (
            <FileText />
          )}
          <span>
            <strong>{attachment.name}</strong>
            <small>
              {attachment.kind === "image"
                ? "图片"
                : attachment.pages
                  ? `PDF · ${attachment.pages} 页 · 提取文字`
                  : "文本文件"}{" "}
              · {Math.max(1, Math.round(attachment.size / 1024))} KB
            </small>
          </span>
        </button>
        {remove && (
          <button
            type="button"
            className="text-chat-attachment-remove"
            aria-label={`移除附件 ${attachment.name}`}
            onClick={() => remove(attachment.id)}
          >
            <X size={14} />
          </button>
        )}
        {(error || attachment.warning) && (
          <span className="text-chat-attachment-warning" role="status">
            {error || attachment.warning}
          </span>
        )}
      </div>
      {open &&
        createPortal(
          <div
            className="text-chat-attachment-backdrop"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) close();
            }}
            onWheel={(e) => e.stopPropagation()}
          >
            <div
              ref={preview}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={`附件预览 ${attachment.name}`}
              className="text-chat-attachment-preview"
              onKeyDownCapture={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  preview.current
                    ?.querySelector<HTMLButtonElement>("button")
                    ?.focus();
                }
              }}
            >
              <header>
                <strong>{attachment.name}</strong>
                <button type="button" aria-label="关闭附件预览" onClick={close}>
                  <X />
                </button>
              </header>
              {error ? (
                <p role="alert">{error}</p>
              ) : !record ? (
                <p>正在读取附件…</p>
              ) : attachment.kind === "image" ? (
                <img src={record.dataUrl} alt={attachment.name} />
              ) : (
                <>
                  <small>
                    发送给模型的提取文字
                    {attachment.pages
                      ? "（不包含 PDF 图片、图表及原始版式）"
                      : ""}
                  </small>
                  <pre>{record.text}</pre>
                </>
              )}
              {attachment.warning && <p>{attachment.warning}</p>}
            </div>
          </div>,
          trigger.current?.closest(".creative-root") || document.body,
        )}
    </>
  );
});
export function TextAttachments({
  attachments,
  onRemove,
}: {
  attachments?: TextAttachmentRef[];
  onRemove?: (id: string) => void;
}) {
  if (!attachments?.length) return null;
  return (
    <div className="text-chat-attachments">
      {attachments.map((a) => (
        <AttachmentCard key={a.id} attachment={a} remove={onRemove} />
      ))}
    </div>
  );
}
