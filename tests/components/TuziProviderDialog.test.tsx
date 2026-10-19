import { readFileSync, writeFileSync } from "node:fs";
import {
  TUZI_TOOL_TARGETS,
  type TuziProviderDraft,
} from "@/lib/tuziToolCompatibility";
import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import { TuziProviderDialog } from "@/components/providers/TuziProviderDialog";
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
  render(
    <QueryClientProvider client={client}>
      <TuziProviderDialog draft={current} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onSaved, onClose };
}
it("submits the actual account form through preview and explicit save", async () => {
  const { onSaved } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  expect(preview.mock.calls[0][0].provider.category).toBe("aggregator");
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "备份并保存" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledTimes(1);
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
    setup({ ...draft, ...target });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "common.add" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    const provider = preview.mock.calls[0][0].provider;
    expect(provider.name).toBe("兔子线路");
    expect(provider.icon).toBe("tuzi");
    expect(provider.category).toBe("aggregator");
    expect(JSON.stringify(provider)).toContain(draft.key);
    const normalized = JSON.parse(
      JSON.stringify(provider).replace(
        /TUZI_SWITCH_[A-F0-9]+_CODEX_API_KEY/g,
        "TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY",
      ),
    );
    normalized.id = `tuzi-synthetic-${appId}`;
    for (const endpoint of Object.values(
      normalized.meta?.custom_endpoints ?? {},
    ) as any[])
      endpoint.addedAt = 1;
    const path = `tests/fixtures/b11-provider-${appId}.json`;
    if (process.env.TUZI_UPDATE_SYNTHETIC_FIXTURES === "1")
      writeFileSync(path, JSON.stringify(normalized, null, 2) + "\n");
    expect(normalized).toEqual(JSON.parse(readFileSync(path, "utf8")));
    fireEvent.click(await screen.findByRole("button", { name: "返回修改" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "common.add" }),
      ).not.toBeDisabled(),
    );
    expect(save).not.toHaveBeenCalled();
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
  const { onClose } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
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
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  expect(
    await screen.findByRole("button", { name: "备份并保存" }),
  ).toBeInTheDocument();
});
it("deduplicates saves, shows failure and returns to the populated form", async () => {
  let release!: () => void;
  server.use(
    http.post("http://tauri.local/tuzi_provider_save", async () => {
      save();
      await new Promise<void>((done) => {
        release = done;
      });
      return new HttpResponse("synthetic save failure", { status: 400 });
    }),
  );
  const { onSaved, onClose } = setup();
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(draft.key),
  );
  fireEvent.click(screen.getByRole("button", { name: "common.add" }));
  const button = await screen.findByRole("button", { name: "备份并保存" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "返回修改" })).toBeDisabled();
  release();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "synthetic save failure",
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "common.add" }),
    ).not.toBeDisabled(),
  );
  expect(screen.getByLabelText("API Key")).toHaveValue(draft.key);
});
