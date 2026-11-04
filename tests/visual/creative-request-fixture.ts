import mediaActions from "../../src/features/creative/mediaActions.json";
// Preview-only transport. No network, credentials or production endpoint is used.
interface SyntheticRequestState {
  hold: boolean;
  holdPoll: boolean;
  fail: boolean;
  requests: Array<{ id: string; method: string; path: string }>;
  responses: Record<
    string,
    { body: unknown; status?: number; contentType?: string }
  >;
  release: () => void;
}
const pending = new Set<() => void>();
const cancelled = new Set<string>();
export const creativeRequestFixture: SyntheticRequestState = {
  hold: false,
  holdPoll: false,
  fail: false,
  requests: [],
  responses: {},
  release() {
    this.hold = false;
    this.holdPoll = false;
    for (const finish of pending) finish();
    pending.clear();
  },
};
(
  window as unknown as { __creativeRequestFixture: SyntheticRequestState }
).__creativeRequestFixture = creativeRequestFixture;
// Opaque 64px red/cyan checkerboard: screenshot assertions must detect painted
// pixels, not just successful decoding of an effectively invisible 1px image.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3QMQ0AMAwDwbAogdIqyOIokcIIhgzeTvrdOtffJ9q6L1oBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIwB6YH0QQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4xqp5OFaPsrjbQAAAABJRU5ErkJggg==";
export async function creativeManualPreviewIPC(command: string, args: unknown) {
  const payload = args as {
    requestId?: string;
    request: { requestId: string; url: string; method: string };
    onChunk: { onmessage: (value: unknown) => void };
  };
  if (command === "creative_manual_cancel") {
    cancelled.add(payload.requestId!);
    creativeRequestFixture.release();
    return;
  }
  const { request, onChunk } = payload;
  const url = new URL(request.url);
  if (url.origin !== "https://creative.synthetic.invalid")
    throw new Error("Synthetic transport rejects non-fixture endpoints");
  creativeRequestFixture.requests.push({
    id: request.requestId,
    method: request.method,
    path: url.pathname,
  });
  onChunk.onmessage({ type: "ready" });
  if (
    creativeRequestFixture.hold ||
    (creativeRequestFixture.holdPoll &&
      request.method === "GET" &&
      url.pathname !== "/v1/models")
  )
    await new Promise<void>((resolve) => pending.add(resolve));
  if (cancelled.delete(request.requestId))
    throw new Error("creative_cancelled_outcome_unknown");
  if (creativeRequestFixture.fail) throw new Error("creative_outcome_unknown");
  let body: unknown;
  const override =
    creativeRequestFixture.responses[request.method + " " + url.pathname];
  if (override) {
    body = override.body;
  } else if (url.pathname === "/v1/models") {
    body = {
      data: [
        {
          id: "gpt-image-2",
          supported_endpoint_types: ["image-generation"],
          endpoints: {
            "image-generation": {
              path: "/v1/images/generations",
              method: "POST",
            },
          },
        },
      ],
    };
  } else if (
    url.pathname === "/v1/images/generations" &&
    request.method === "POST"
  ) {
    body = { created: 1, data: [{ b64_json: png }] };
  } else throw new Error("Synthetic endpoint unsupported: " + url.pathname);
  onChunk.onmessage({
    type: "start",
    status: override?.status || 200,
    content_type: override?.contentType || "application/json",
  });
  const text =
    override?.contentType === "text/event-stream"
      ? String(body)
      : JSON.stringify(body);
  onChunk.onmessage({
    type: "data",
    data: btoa(
      Array.from(new TextEncoder().encode(text), (b) =>
        String.fromCharCode(b),
      ).join(""),
    ),
  });
  onChunk.onmessage({ type: "end" });
}

// Account-mode fixture still uses the real renderer URL-to-action selection.
// Native permission and HTTP behavior are covered separately by Rust loopback tests.
export async function creativeAccountMediaPreviewIPC(
  command: string,
  args: any,
) {
  if (command === "account_cancel_request")
    return creativeManualPreviewIPC("creative_manual_cancel", args);
  const r = args.request;
  if (r.generation !== 1 || !String(r.bindingId).startsWith("tuzi-account-"))
    throw "creative_binding_not_found";
  const classics: Record<string, { method: string; path: string }> = {
    models: { method: "GET", path: "/v1/models" },
    "image.generate": { method: "POST", path: "/v1/images/generations" },
    chat: { method: "POST", path: "/v1/chat/completions" },
    responses: { method: "POST", path: "/v1/responses" },
    "video.create": { method: "POST", path: "/v1/videos" },
    "video.poll": { method: "GET", path: "/v1/videos/{taskId}" },
  };
  const route =
    mediaActions.find((a) => a.action === r.action) || classics[r.action];
  if (!route) throw "creative_action_unsupported";
  return creativeManualPreviewIPC("creative_manual_request", {
    ...args,
    request: {
      ...r,
      method: route.method,
      url:
        "https://creative.synthetic.invalid" +
        route.path.replace("{taskId}", r.taskId || ""),
    },
  });
}
