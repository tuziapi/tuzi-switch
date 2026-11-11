import localforage from "localforage";

export const TEXT_ATTACHMENT_STORE = "text_attachments";
export const ATTACHMENT_LIMITS = {
  count: 6,
  totalBytes: 20 * 1024 ** 2,
  imageBytes: 10 * 1024 ** 2,
  pdfBytes: 10 * 1024 ** 2,
  textBytes: 2 * 1024 ** 2,
  textChars: 80000,
  pdfPages: 50,
};
export const ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown,.csv,.json,.jsonl,.yaml,.yml,.xml,.html,.css,.scss,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.h,.cpp,.hpp,.cs,.rb,.php,.sh,.sql,.toml,.ini,.log";
export interface TextAttachmentRef {
  id: string;
  name: string;
  kind: "image" | "document";
  mimeType: string;
  size: number;
  textLength?: number;
  pages?: number;
  warning?: string;
}
export interface TextAttachmentRecord {
  ref: TextAttachmentRef;
  sessionId: string;
  text?: string;
  dataUrl?: string;
  thumbnailDataUrl?: string;
}
let store: LocalForage | undefined;
function db() {
  return (store ??= localforage.createInstance({
    name: "aitu-chat",
    storeName: TEXT_ATTACHMENT_STORE,
  }));
}
export function validateAttachmentRefs(
  refs: unknown,
): asserts refs is TextAttachmentRef[] {
  if (
    !Array.isArray(refs) ||
    refs.length > ATTACHMENT_LIMITS.count ||
    refs.some(
      (a) =>
        !a ||
        typeof a.id !== "string" ||
        !a.id ||
        a.id.length > 200 ||
        typeof a.name !== "string" ||
        a.name.length > 200 ||
        !["image", "document"].includes(a.kind) ||
        typeof a.mimeType !== "string" ||
        !Number.isSafeInteger(a.size) ||
        a.size < 0 ||
        (a.warning !== undefined &&
          (typeof a.warning !== "string" || a.warning.length > 2000)) ||
        (a.pages !== undefined &&
          (!Number.isInteger(a.pages) ||
            a.pages < 1 ||
            a.pages > ATTACHMENT_LIMITS.pdfPages)) ||
        (a.textLength !== undefined &&
          (!Number.isInteger(a.textLength) ||
            a.textLength < 1 ||
            a.textLength > ATTACHMENT_LIMITS.textChars)),
    ) ||
    new Set(refs.map((a) => a.id)).size !== refs.length ||
    refs.reduce((n, a) => n + a.size, 0) > ATTACHMENT_LIMITS.totalBytes
  ) {
    throw new Error(
      "每条消息最多 6 个附件，原文件合计不超过 20 MB；附件信息需完整。",
    );
  }
}
export function validateAttachmentRecord(
  record: unknown,
): asserts record is TextAttachmentRecord {
  const r = record as TextAttachmentRecord;
  if (
    !r ||
    typeof r.sessionId !== "string" ||
    !r.sessionId ||
    r.sessionId.length > 200
  )
    throw new Error("附件数据不完整，请重新添加。");
  validateAttachmentRefs([r.ref]);
  if (r.ref.kind === "image") {
    if (
      typeof r.dataUrl !== "string" ||
      r.dataUrl.length > 3 * 1024 ** 2 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        r.dataUrl,
      )
    )
      throw new Error("图片附件格式无效，请重新添加。");
    if (
      r.thumbnailDataUrl !== undefined &&
      (typeof r.thumbnailDataUrl !== "string" ||
        r.thumbnailDataUrl.length > 100000 ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(
          r.thumbnailDataUrl,
        ))
    )
      throw new Error("图片缩略图格式无效，请重新添加。");
  } else if (
    typeof r.text !== "string" ||
    !r.text.trim() ||
    r.text.length > ATTACHMENT_LIMITS.textChars
  ) {
    throw new Error("文档附件内容无效，请重新添加。");
  }
}
export async function saveTextAttachment(record: TextAttachmentRecord) {
  validateAttachmentRecord(record);
  await db().setItem(record.ref.id, record);
}
export async function readTextAttachment(
  ref: TextAttachmentRef,
): Promise<TextAttachmentRecord> {
  const record = await db().getItem<TextAttachmentRecord>(ref.id);
  if (!record) throw new Error(`附件“${ref.name}”已丢失，请重新添加后发送。`);
  validateAttachmentRecord(record);
  if (record.ref.id !== ref.id || record.ref.kind !== ref.kind)
    throw new Error("附件引用与内容不一致，请重新添加。");
  return record;
}
export async function removeTextAttachment(id: string) {
  await db().removeItem(id);
}
export async function removeSessionAttachments(sessionId: string) {
  const ids: string[] = [];
  await db().iterate<TextAttachmentRecord, void>((r, key) => {
    if (r?.sessionId === sessionId) ids.push(key);
  });
  for (const id of ids) await db().removeItem(id);
}
export async function clearTextAttachments() {
  await db().clear();
}

export function attachmentFileKind(
  file: Pick<File, "name" | "size" | "type">,
): "image" | "pdf" | "text" {
  const ext = "." + file.name.split(".").pop()!.toLowerCase();
  const kind = [".png", ".jpg", ".jpeg", ".webp"].includes(ext)
    ? "image"
    : ext === ".pdf"
      ? "pdf"
      : ATTACHMENT_ACCEPT.split(",").includes(ext)
        ? "text"
        : null;
  if (!kind)
    throw new Error("支持 PNG/JPEG/WebP、PDF、TXT/Markdown 和常见代码文件。");
  const limit =
    kind === "image"
      ? ATTACHMENT_LIMITS.imageBytes
      : kind === "pdf"
        ? ATTACHMENT_LIMITS.pdfBytes
        : ATTACHMENT_LIMITS.textBytes;
  if (!file.size || file.size > limit)
    throw new Error(
      `“${file.name}”为空或过大：${kind === "text" ? "文本最多 2" : "图片/PDF 最多 10"} MB。`,
    );
  return kind;
}
