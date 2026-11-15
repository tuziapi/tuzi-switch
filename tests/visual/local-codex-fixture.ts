// Synthetic App Server host IPC. Never starts a CLI or makes network requests.
const fixture = {
  fail: false,
  probeFail: false,
  hold: false,
  calls: [] as { model: string; prompt: string }[],
  cancelled: new Set<string>(),
  content: JSON.stringify({
    content: "Codex 已整理生成计划，请确认。",
    next: [
      {
        mcp: "generate_image",
        args: { prompt: "SYNTHETIC CODEX IMAGE", count: 1 },
      },
    ],
  }),
};
(window as any).__localCodexFixture = fixture;
export async function localCodexPreviewIPC(command: string, args: any) {
  if (command === "creative_codex_probe") {
    if (fixture.probeFail) throw "codex_not_found";
    return {
      defaultModel: "synthetic-codex",
      models: [
        {
          id: "synthetic-codex",
          name: "Codex QA",
          efforts: ["low", "high"],
          defaultEffort: "high",
          supportsImages: true,
        },
        {
          id: "synthetic-codex-alt",
          name: "Codex QA 2",
          efforts: ["medium"],
          defaultEffort: "medium",
          supportsImages: false,
        },
      ],
    };
  }
  if (command === "creative_codex_cancel") {
    fixture.cancelled.add(args.requestId);
    return;
  }
  fixture.calls.push({
    model: args.request.model,
    prompt: args.request.prompt,
  });
  args.onEvent.onmessage({ type: "ready" });
  if (fixture.fail) throw "codex_connection_lost";
  args.onEvent.onmessage({
    type: "delta",
    content: "",
    reasoning: "SYNTHETIC CODEX SUMMARY：先整理提示词。",
  });
  while (fixture.hold && !fixture.cancelled.has(args.request.requestId))
    await new Promise((r) => setTimeout(r, 50));
  if (fixture.cancelled.delete(args.request.requestId)) throw "codex_cancelled";
  for (let i = 0; i < fixture.content.length; i += 24) {
    if (fixture.cancelled.delete(args.request.requestId))
      throw "codex_cancelled";
    args.onEvent.onmessage({
      type: "delta",
      content: fixture.content.slice(i, i + 24),
      reasoning: "",
    });
    await new Promise((r) => setTimeout(r, 25));
  }
  args.onEvent.onmessage({
    type: "complete",
    content: fixture.content,
    reasoning: "SYNTHETIC CODEX SUMMARY：先整理提示词。",
  });
}
