import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ records: new Map<string, any>() }));
vi.mock("localforage", () => ({
  default: {
    createInstance: () => ({
      setItem: async (k: string, v: unknown) => state.records.set(k, v),
      getItem: async (k: string) => state.records.get(k),
      removeItem: async (k: string) => state.records.delete(k),
      clear: async () => state.records.clear(),
      iterate: async (f: any) => {
        for (const [k, v] of state.records) f(v, k);
      },
    }),
  },
}));
import {
  attachmentFileKind,
  saveTextAttachment,
  readTextAttachment,
  removeSessionAttachments,
  clearTextAttachments,
  validateAttachmentRefs,
  validateAttachmentRecord,
} from "./attachments";
import { prepareTextAttachment } from "./attachment-prepare";
import { textBody } from "./protocol";
const ref = {
  id: "a",
  name: "notes.md",
  kind: "document" as const,
  mimeType: "text/plain",
  size: 20,
};
const image = "data:image/jpeg;base64,YWJj";
beforeEach(() => state.records.clear());
it("accepts supported extensions and rejects oversized, empty and executable binaries", () => {
  for (const name of ["notes.md", "main.ts", "main.py", "data.json"])
    expect(attachmentFileKind({ name, size: 10, type: "" })).toBe("text");
  expect(attachmentFileKind({ name: "SCAN.PDF", size: 10, type: "" })).toBe(
    "pdf",
  );
  expect(attachmentFileKind({ name: "photo.png", size: 10, type: "" })).toBe(
    "image",
  );
  for (const [name, size] of [
    ["bad.exe", 10],
    ["empty.txt", 0],
    ["huge.md", 3 * 1024 ** 2],
    ["huge.png", 11 * 1024 ** 2],
  ] as const)
    expect(() => attachmentFileKind({ name, size, type: "" })).toThrow();
});
it("validates batch limits, duplicate ids and safe local image payloads", () => {
  expect(() => validateAttachmentRefs([ref, ref])).toThrow();
  expect(() =>
    validateAttachmentRefs(
      Array.from({ length: 7 }, (_, i) => ({ ...ref, id: String(i) })),
    ),
  ).toThrow();
  expect(() =>
    validateAttachmentRefs([{ ...ref, size: 21 * 1024 ** 2 }]),
  ).toThrow();
  for (const dataUrl of [
    "https://example.invalid/a.png",
    "data:image/svg+xml;base64,YWJj",
  ])
    expect(() =>
      validateAttachmentRecord({
        ref: { ...ref, kind: "image" },
        sessionId: "s",
        dataUrl,
      }),
    ).toThrow();
});
it("stores separately, detects missing/corrupt refs, and deletes only the owner session", async () => {
  await saveTextAttachment({ ref, sessionId: "s", text: "synthetic document" });
  await saveTextAttachment({
    ref: { ...ref, id: "b" },
    sessionId: "other",
    text: "keep",
  });
  expect((await readTextAttachment(ref)).text).toBe("synthetic document");
  await expect(readTextAttachment({ ...ref, kind: "image" })).rejects.toThrow(
    "不一致",
  );
  await removeSessionAttachments("s");
  await expect(readTextAttachment(ref)).rejects.toThrow("丢失");
  expect(state.records.has("b")).toBe(true);
  state.records.set("a", { ref, sessionId: "s", text: "" });
  await expect(readTextAttachment(ref)).rejects.toThrow("无效");
  await clearTextAttachments();
  expect(state.records.size).toBe(0);
});
it("decodes UTF-8 code literally and rejects binary, invalid encoding and oversized extracted text", async () => {
  const file = (bytes: Uint8Array) =>
    ({
      name: "test.ts",
      type: "text/plain",
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    }) as File;
  const prepare = (bytes: Uint8Array) =>
    prepareTextAttachment(file(bytes), "s", new AbortController().signal);
  const result = await prepare(
    new TextEncoder().encode('const 中文 = "<script>";'),
  );
  expect(result.text).toBe('const 中文 = "<script>";');
  expect(result.ref.kind).toBe("document");
  await expect(prepare(new Uint8Array([0, 1, 2]))).rejects.toThrow("二进制");
  await expect(prepare(new Uint8Array([255, 254]))).rejects.toThrow("UTF-8");
  await expect(
    prepare(new TextEncoder().encode("a".repeat(80001))),
  ).rejects.toThrow("8 万");
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareTextAttachment(file(new Uint8Array([1])), "s", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
it("serializes all four image protocols without leaking storage references", () => {
  const turns = [
    {
      role: "user" as const,
      content: "describe",
      images: [image],
      attachments: [ref],
    },
  ];
  expect(textBody("chat", "m", turns)).toMatchObject({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "describe" },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
  });
  expect(textBody("responses", "m", turns)).toMatchObject({
    input: [
      {
        content: [
          { type: "input_text", text: "describe" },
          { type: "input_image", image_url: image, detail: "auto" },
        ],
      },
    ],
  });
  expect(textBody("anthropic", "m", turns)).toMatchObject({
    messages: [
      {
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: "YWJj" },
          },
          { type: "text", text: "describe" },
        ],
      },
    ],
  });
  expect(textBody("gemini", "m", turns)).toMatchObject({
    contents: [
      {
        parts: [
          { text: "describe" },
          { inlineData: { mimeType: "image/jpeg", data: "YWJj" } },
        ],
      },
    ],
  });
  for (const protocol of [
    "chat",
    "responses",
    "anthropic",
    "gemini",
  ] as const) {
    expect(JSON.stringify(textBody(protocol, "m", turns))).not.toContain(
      "notes.md",
    );
    expect(
      JSON.stringify(textBody(protocol, "m", [{ ...turns[0], content: "" }])),
    ).not.toContain('"text":""');
  }
});
