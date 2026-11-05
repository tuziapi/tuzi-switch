import { Channel, invoke } from "@tauri-apps/api/core";

export type CreativeChunk =
  | { type: "ready" }
  | {
      type: "start";
      status: number;
      content_type: string;
      headers?: Record<string, string>;
    }
  | { type: "data"; data: string }
  | { type: "end" };

/** Keep cancellation attached until the response body has finished streaming. */
export function nativeCreativeResponse(
  command: string,
  cancelCommand: string,
  request: Record<string, unknown> & { requestId: string },
  signal: AbortSignal | null | undefined,
  errorFor: (error: unknown) => Error,
): Promise<Response> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let finished = false;
    let started = false;
    let cancelled = false;
    let drainTimeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      if (drainTimeout !== undefined) clearTimeout(drainTimeout);
    };
    const cancelNative = () => {
      cancelled = true;
      void invoke(cancelCommand, { requestId: request.requestId }).catch(
        () => {},
      );
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      const reason = signal?.aborted
        ? new DOMException("Aborted", "AbortError")
        : errorFor(error);
      // Before headers there is no response consumer to handle a rejected stream.
      if (started) controller.error(reason);
      else controller.close();
      reject(reason);
    };
    const abort = () => {
      cancelNative();
      fail("creative_cancelled_outcome_unknown");
    };
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        finished = true;
        cleanup();
        cancelNative();
      },
    });
    const onChunk = new Channel<CreativeChunk>();
    onChunk.onmessage = (message) => {
      // An abort can reach Rust before its request is registered. Acknowledge
      // registration and resend cancellation even if the JS promise has ended.
      if (message.type === "ready") {
        if (cancelled) cancelNative();
        return;
      }
      if (finished) return;
      try {
        if (message.type === "start") {
          if (started) throw new Error("duplicate_headers");
          const response = new Response(
            [204, 205, 304].includes(message.status) ? null : stream,
            {
              status: message.status,
              headers: {
                ...message.headers,
                "content-type": message.content_type,
              },
            },
          );
          started = true;
          resolve(response);
        } else if (message.type === "data") {
          if (!started) throw new Error("missing_headers");
          controller.enqueue(
            Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0)),
          );
        } else {
          if (!started) throw new Error("missing_headers");
          finished = true;
          cleanup();
          controller.close();
        }
      } catch (error) {
        cancelNative();
        fail(error);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    void invoke(command, { request, onChunk })
      .then(() => {
        // Tauri fetches large Channel messages asynchronously. Command success
        // can arrive before those messages, so only our explicit end chunk
        // completes the response. Bound missing delivery without replaying it.
        if (!finished) {
          drainTimeout = setTimeout(() => {
            cancelNative();
            fail("creative_outcome_unknown");
          }, 30_000);
        }
      })
      .catch(fail);
  });
}

export function encodeCreativeBytes(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
