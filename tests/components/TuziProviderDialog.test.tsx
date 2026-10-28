import { readFileSync, writeFileSync } from "node:fs";
import {
  TUZI_TOOL_TARGETS,
  type TuziProviderDraft,
} from "@/lib/tuziToolCompatibility";
import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import {
  TuziProviderDialog,
  tuziCreationPrefill,
} from "@/components/providers/TuziProviderDialog";
import { server } from "../msw/server";

const draft = {
  appId: "codex" as const,
  protocol: "responses" as const,
  key: "sk-SYNTHETIC_ACCOUNT_MODEL_KEY",
  tokenId: "17",
  userId: "20",
  generation: 1,
  model: "synthetic-model",
  name: "Synthetic key",
};
const preview = vi.fn();
const save = vi.fn();
beforeEach(() => {
  preview.mockReset();
  save.mockReset();
  vi.spyOn(toast, "error");
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  server.use(
    http.post("http://tauri.local/get_claude_desktop_default_routes", () =>
      HttpResponse.json([]),
    ),
    http.post("http://tauri.local/get_hermes_live_provider_ids", () =>
      HttpResponse.json([]),
    ),
    http.post("http://tauri.local/auth_get_status", () =>
      HttpResponse.json({ authenticated: false }),
    ),
    http.post("http://tauri.local/get_settings", () =>
      HttpResponse.json({ commonConfigConfirmed: true }),
    ),
    http.post("http://tauri.local/get_common_config_snippet", () =>
      HttpResponse.json(""),
    ),
    http.post("http://tauri.local/read_all_codex_env_keys", () =>
      HttpResponse.json({}),
    ),
    http.post("http://tauri.local/validate_toml", () =>
      HttpResponse.json(null),
    ),
    http.post(
      "http://tauri.local/tuzi_provider_preview",
      async ({ request }) => {
        const args = await request.json();
        preview(args);
        return HttpResponse.json({
          id: "synthetic-preview",
          changes: ["Synthetic masked change"],
        });
      },
    ),
    http.post("http://tauri.local/tuzi_provider_save", async ({ request }) => {
      save(await request.json());
      return HttpResponse.json({
        backupId: "synthetic-backup",
        enabled: false,
        tested: false,
      });
    }),
  );
});
function setup(current: TuziProviderDraft = draft) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TuziProviderDialog draft={current} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onSaved, onClose, unmount: view.unmount };
}
it("adds directly from the actual account form while preserving the native transaction", async () => {
  const { onSaved } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "common.add" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  expect(preview.mock.calls[0][0].provider.category).toBe("aggregator");
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("确认配置变更")).not.toBeInTheDocument();
  expect(save.mock.calls[0][0]).toMatchObject({
    previewId: "synthetic-preview",
    source: {
      site: "https://api.tu-zi.com",
      userId: draft.userId,
      tokenId: draft.tokenId,
      generation: draft.generation,
    },
  });
  expect(
    save.mock.calls[0][0].provider.settingsConfig.auth.OPENAI_API_KEY,
  ).toBe(draft.key);
});

it.each([
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
] as const)(
  "preserves %s account fields through the real form and native contract fixture",
  async (appId) => {
    const target = TUZI_TOOL_TARGETS.find((item) => item.appId === appId)!;
    setup({ ...draft, ...target, appId });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "common.add" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    const provider = preview.mock.calls[0][0].provider;
    expect(provider.name).toBe("兔子线路-Synthetic key");
    expect(provider.icon).toBe("tuzi");
    expect(provider.category).toBe("aggregator");
    expect(JSON.stringify(provider)).toContain(draft.key);
    const normalized = JSON.parse(
      JSON.stringify(provider).replace(
        /TUZI_SWITCH_[A-F0-9]+_CODEX_API_KEY/g,
        "TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY",
      ),
    );
    if (appId === "codex") {
      const suffix = /^TUZI_SWITCH_([A-F0-9]{12})_CODEX_API_KEY$/.exec(
        provider.settingsConfig.env.envKey,
      )?.[1];
      expect(suffix).toBeDefined();
      normalized.settingsConfig.config =
        normalized.settingsConfig.config.replaceAll(
          `tuzi-${suffix!.toLowerCase()}`,
          "tuzi-synthetic",
        );
    }
    normalized.id = `tuzi-synthetic-${appId}`;
    for (const endpoint of Object.values(
      normalized.meta?.custom_endpoints ?? {},
    ) as any[])
      endpoint.addedAt = 1;
    const path = `tests/fixtures/b11-provider-${appId}.json`;
    if (process.env.TUZI_UPDATE_SYNTHETIC_FIXTURES === "1")
      writeFileSync(path, JSON.stringify(normalized, null, 2) + "\n");
    expect(normalized).toEqual(JSON.parse(readFileSync(path, "utf8")));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].provider).toEqual(provider);
    expect(screen.queryByText("确认配置变更")).not.toBeInTheDocument();
  },
);

it("shows preview failures and allows retry without closing the form", async () => {
  server.use(
    http.post(
      "http://tauri.local/tuzi_provider_preview",
      () => new HttpResponse("synthetic preview failure", { status: 400 }),
      { once: true },
    ),
  );
  const { onClose, onSaved } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "common.add" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "无法添加供应商",
      expect.objectContaining({
        description: expect.stringContaining("synthetic preview failure"),
      }),
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByLabelText("API Key")).toHaveValue(draft.key);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "common.add" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});
it("deduplicates saves, preserves input on failure and prepares a fresh plan on retry", async () => {
  let release!: () => void;
  server.use(
    http.post(
      "http://tauri.local/tuzi_provider_save",
      async () => {
        save();
        await new Promise<void>((done) => {
          release = done;
        });
        return new HttpResponse("synthetic save failure", { status: 400 });
      },
      { once: true },
    ),
  );
  const { onSaved, onClose } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  const button = screen.getByRole("button", { name: "common.add" });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled();
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(preview).toHaveBeenCalledTimes(1);
  release();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "无法添加供应商",
      expect.objectContaining({
        description: expect.stringContaining("synthetic save failure"),
      }),
    ),
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(button).not.toBeDisabled());
  expect(screen.getByLabelText("API Key")).toHaveValue(draft.key);
  fireEvent.click(button);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(preview).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(2);
});

it("blocks duplicate submission and closing while preparing the transaction", async () => {
  let release!: () => void;
  server.use(
    http.post("http://tauri.local/tuzi_provider_preview", async () => {
      preview();
      await new Promise<void>((done) => {
        release = done;
      });
      return HttpResponse.json({
        id: "synthetic-delayed-preview",
        changes: [],
      });
    }),
  );
  const { onClose, onSaved } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  const button = screen.getByRole("button", { name: "common.add" });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled();
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(preview).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);
});

it("does not start a write if the account form unmounts during preparation", async () => {
  let release!: () => void;
  server.use(
    http.post("http://tauri.local/tuzi_provider_preview", async () => {
      preview();
      await new Promise<void>((done) => {
        release = done;
      });
      return HttpResponse.json({
        id: "synthetic-delayed-preview",
        changes: [],
      });
    }),
  );
  const { unmount, onSaved } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "common.add" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  unmount();
  release();
  // Drain the deferred IPC response rather than relying on an arbitrary timeout.
  await new Promise<void>((done) => {
    const listener = ({ request }: { request: Request }) => {
      if (request.url.endsWith("/tuzi_provider_preview")) {
        server.events.removeListener("request:end", listener);
        done();
      }
    };
    server.events.on("request:end", listener);
  });
  expect(save).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});

it.each([
  ["  我的密钥  ", "兔子线路-我的密钥"],
  ["", "兔子线路"],
  ["   ", "兔子线路"],
  ['测试"密钥\\A', '兔子线路-测试"密钥\\A'],
])("names a new provider from key %j", (keyName, expected) => {
  expect(tuziCreationPrefill({ ...draft, name: keyName })?.name).toBe(expected);
});

it("waits for Codex common config before allowing button or direct form submission", async () => {
  let release!: () => void;
  server.use(
    http.post("http://tauri.local/get_common_config_snippet", async ({ request }) => {
      const args = await request.json() as { appType: string };
      if (args.appType === "codex") {
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return HttpResponse.json("");
    }),
  );
  setup();
  await waitFor(() => expect(release).toBeDefined());
  const button = screen.getByRole("button", { name: "common.add" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  await act(async () => {
    fireEvent.submit(document.getElementById("provider-form")!);
  });
  await waitFor(() => expect(button).toBeDisabled());
  expect(preview).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(preview.mock.calls[0][0].provider.meta.commonConfigEnabled).toBe(true);
});
