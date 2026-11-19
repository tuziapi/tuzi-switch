import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeDesktopProviderForm } from "@/components/providers/forms/ClaudeDesktopProviderForm";
import { ClaudeModelCatalog } from "@/components/providers/forms/ClaudeModelCatalog";
import { fetchClaudeDesktopModels } from "@/lib/api/model-fetch";
import {
  sortCatalog,
  mergeCatalogRoutes,
  configuredModels,
  modelRouteId,
  isKnownNonChatModel,
} from "@/lib/claudeDesktopModels";
vi.mock("@/lib/api/model-fetch", () => ({
  fetchClaudeDesktopModels: vi.fn(),
  showFetchModelsError: vi.fn(),
}));
vi.mock("@/lib/api/providers", () => ({
  providersApi: {
    getClaudeDesktopDefaultRoutes: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const models = Array.from({ length: 14 }, (_, i) => ({
  id: `claude-sonnet-test-${i}`,
  ownedBy: "synthetic",
  createdAt: 1000 + i,
}));
const existing = {
  "claude-custom": {
    model: "claude-custom",
    displayName: "Keep this",
    supports1m: true,
  },
};
function mount(meta = {}, defaultModel = "claude-custom") {
  const submit = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ClaudeDesktopProviderForm
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
        initialData={{
          name: "Synthetic",
          settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: "https://synthetic.example",
              ANTHROPIC_AUTH_TOKEN: "synthetic-key",
              ANTHROPIC_MODEL: defaultModel,
            },
          },
          meta,
        }}
      />
    </QueryClientProvider>,
  );
  return submit;
}
function save() {
  fireEvent.submit(document.getElementById("provider-form")!);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
    ...models,
    { id: "image-model", ownedBy: null },
  ]);
});
describe("Claude model catalog", () => {
  it("automatically fetches every model on save, maps Claude models and retains an explicit default", async () => {
    const submit = mount({ claudeDesktopModelRoutes: existing });
    expect(fetchClaudeDesktopModels).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(fetchClaudeDesktopModels).toHaveBeenCalledWith(
      "https://synthetic.example",
      "synthetic-key",
    );
    const value = submit.mock.calls[0][0];
    expect(value.meta.claudeDesktopModelCatalog).toHaveLength(15);
    expect(Object.keys(value.meta.claudeDesktopModelRoutes)).toHaveLength(15);
    expect(value.meta.claudeDesktopModelRoutes["claude-custom"]).toEqual(
      existing["claude-custom"],
    );
    expect(value.meta.claudeDesktopModelRoutes["image-model"]).toBeUndefined();
    expect(JSON.parse(value.settingsConfig).env.ANTHROPIC_MODEL).toBe(
      "claude-custom",
    );
  });
  it("shows all fetched models immediately and searches them without changing mapping eligibility", async () => {
    render(
      <ClaudeModelCatalog
        models={[...models, { id: "image-model" }]}
        defaultModel={models[13].id}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(15);
    expect(
      screen.queryByText("claudeDesktop.catalogExpand"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("claudeDesktop.catalogAll"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "test-0" },
    });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "image" },
    });
    expect(screen.getByRole("radio", { name: "image-model" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(screen.getAllByRole("radio")).toHaveLength(15);
  });
  it("does not save on a fetch error; explicit manual save preserves mappings", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockRejectedValue(
      new Error("HTTP 401"),
    );
    const submit = mount({ claudeDesktopModelRoutes: existing });
    save();
    expect(
      await screen.findByText("claudeDesktop.catalogFailed"),
    ).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "claudeDesktop.catalogManualSave" }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(fetchClaudeDesktopModels).toHaveBeenCalledTimes(1);
  });
  it("refetches after changing the Key and removes previous automatic model entries", async () => {
    const submit = mount({
      claudeDesktopModelCatalog: [{ id: "claude-old" }],
      claudeDesktopModelRoutes: { "claude-old": { model: "claude-old" } },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "new-synthetic-key" },
    });
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(fetchClaudeDesktopModels).toHaveBeenCalledWith(
      "https://synthetic.example",
      "new-synthetic-key",
    );
    expect(
      submit.mock.calls[0][0].meta.claudeDesktopModelRoutes["claude-old"],
    ).toBeUndefined();
  });
  it("blocks automatic saving when the catalog only contains dedicated non-chat models", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
      { id: "image-model", ownedBy: null },
    ]);
    const submit = mount();
    save();
    expect(
      await screen.findByText("claudeDesktop.catalogNoClaude"),
    ).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });
  it("keeps a chosen model when saving the fetched catalog without another request", async () => {
    const submit = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "claudeDesktop.catalogRefresh" }),
    );
    await screen.findByRole("radio", { name: models[13].id });
    fireEvent.click(screen.getByRole("radio", { name: models[12].id }));
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(fetchClaudeDesktopModels).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(submit.mock.calls[0][0].settingsConfig).env.ANTHROPIC_MODEL,
    ).toBe(models[12].id);
  });
  it("preserves manual aliases, deduplicates IDs, and uses known timestamps without inferring dates", () => {
    expect(
      sortCatalog([
        { id: "claude-b" },
        { id: "claude-a", createdAt: 100 },
        { id: "claude-a", createdAt: 100 },
      ]).map((m) => m.id),
    ).toEqual(["claude-a", "claude-b"]);
    expect(
      mergeCatalogRoutes(
        { "claude-alias": { model: "claude-a", supports1m: true } },
        [{ id: "claude-a" }],
      ),
    ).toEqual({ "claude-alias": { model: "claude-a", supports1m: true } });
    expect(
      configuredModels({
        meta: { claudeDesktopModelRoutes: { bad: { model: "claude-a" } } },
        settingsConfig: { env: { ANTHROPIC_MODEL: "fallback" } },
      }),
    ).toEqual([]);
  });
});

describe("vendor-neutral model configuration", () => {
  it.each(["anthropic", "openai_chat", "openai_responses", "gemini_native"])(
    "saves non-Claude models with aliases and the configured %s protocol",
    async (apiFormat) => {
      vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
        { id: "deepseek-chat", ownedBy: null },
        { id: "vendor/gpt-conversation", ownedBy: null },
      ]);
      const submit = mount({ apiFormat });
      fireEvent.click(
        screen.getByRole("button", { name: "claudeDesktop.catalogRefresh" }),
      );
      const radio = await screen.findByRole("radio", {
        name: "vendor/gpt-conversation",
      });
      expect(radio).toBeEnabled();
      fireEvent.click(radio);
      save();
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      const value = submit.mock.calls[0][0];
      expect(value.meta.claudeDesktopMode).toBe("proxy");
      expect(value.meta.apiFormat).toBe(apiFormat);
      expect(
        value.meta.claudeDesktopModelRoutes["claude-vendor-gpt-conversation"],
      ).toEqual({
        model: "vendor/gpt-conversation",
        displayName: "vendor/gpt-conversation",
        supports1m: undefined,
      });
      expect(JSON.parse(value.settingsConfig).env.ANTHROPIC_MODEL).toBe(
        "vendor/gpt-conversation",
      );
      expect(configuredModels(value)).toContain("vendor/gpt-conversation");
      expect(fetchClaudeDesktopModels).toHaveBeenCalledTimes(1);
    },
  );

  it("automatically maps a non-Claude-only directory during save without an intermediate render", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
      { id: "deepseek-chat", ownedBy: null },
    ]);
    const submit = mount();
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const value = submit.mock.calls[0][0];
    expect(value.meta.claudeDesktopMode).toBe("proxy");
    expect(value.meta.apiFormat).toBe("anthropic");
    expect(JSON.parse(value.settingsConfig).env.ANTHROPIC_MODEL).toBe(
      "deepseek-chat",
    );
  });

  it("retains manually named mappings and removes generated aliases when credentials change", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
      { id: "vendor/new-chat", ownedBy: null },
    ]);
    const submit = mount({
      claudeDesktopMode: "proxy",
      apiFormat: "openai_chat",
      claudeDesktopModelCatalog: [{ id: "vendor/old-chat" }],
      claudeDesktopModelRoutes: {
        "claude-vendor-old-chat": {
          model: "vendor/old-chat",
          displayName: "vendor/old-chat",
        },
        "claude-my-custom-alias": {
          model: "special-chat",
          displayName: "My model",
          supports1m: true,
        },
      },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "changed-synthetic-key" },
    });
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const routes = submit.mock.calls[0][0].meta.claudeDesktopModelRoutes;
    expect(routes["claude-vendor-old-chat"]).toBeUndefined();
    expect(routes["claude-vendor-new-chat"].model).toBe("vendor/new-chat");
    expect(routes["claude-my-custom-alias"]).toEqual({
      model: "special-chat",
      displayName: "My model",
      supports1m: true,
    });
  });

  it("keeps new manual model rows when fetching succeeds during save", async () => {
    const submit = mount();
    fireEvent.click(screen.getByText("claudeDesktop.catalogAdvanced"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "claudeDesktop.directModelListTitle",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "claudeDesktop.addModel" }),
    );
    fireEvent.change(
      screen.getByLabelText("claudeDesktop.upstreamModelLabel 1"),
      { target: { value: "vendor/manual-chat" } },
    );
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(
      submit.mock.calls[0][0].meta.claudeDesktopModelRoutes[
        "claude-vendor-manual-chat"
      ].model,
    ).toBe("vendor/manual-chat");
    expect(submit.mock.calls[0][0].meta.claudeDesktopMode).toBe("proxy");
  });

  it("preserves the legacy direct route identity even if its unused upstream field differs", async () => {
    const submit = mount({
      claudeDesktopModelRoutes: {
        "claude-legacy": { model: "legacy-unused-field" },
      },
    });
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(
      submit.mock.calls[0][0].meta.claudeDesktopModelRoutes["claude-legacy"]
        .model,
    ).toBe("claude-legacy");
    expect(submit.mock.calls[0][0].meta.claudeDesktopMode).toBe("direct");
  });

  it("refreshes away removed automatic entries while retaining manually named routes", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
      { id: "new-chat", ownedBy: null },
    ]);
    const submit = mount({
      claudeDesktopMode: "proxy",
      claudeDesktopModelCatalog: [{ id: "old-chat" }],
      claudeDesktopModelRoutes: {
        "claude-old-chat": { model: "old-chat", displayName: "old-chat" },
        "claude-handmade": {
          model: "manual-chat",
          displayName: "Personal name",
        },
      },
    });
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(
      submit.mock.calls[0][0].meta.claudeDesktopModelRoutes["claude-old-chat"],
    ).toBeUndefined();
    expect(
      submit.mock.calls[0][0].meta.claudeDesktopModelRoutes["claude-handmade"]
        .model,
    ).toBe("manual-chat");
  });

  it("generates collision-free aliases without replacing manual routes or rewriting upstream names", () => {
    const routes = mergeCatalogRoutes(
      { "claude-vendor-chat": { model: "custom-model", displayName: "Keep" } },
      [
        { id: "vendor/chat" },
        { id: "vendor-chat" },
        { id: "claude-vendor-chat" },
      ],
    );
    expect(Object.keys(routes)).toHaveLength(4);
    expect(new Set(Object.values(routes).map((r) => r.model))).toEqual(
      new Set([
        "custom-model",
        "vendor/chat",
        "vendor-chat",
        "claude-vendor-chat",
      ]),
    );
    expect(routes["claude-vendor-chat"].model).toBe("custom-model");
    expect(modelRouteId("vendor/chat", ["claude-vendor-chat"])).toBe(
      "claude-vendor-chat-2",
    );
  });

  it("sorts vendors equally and only blocks recognizable dedicated non-chat families", () => {
    expect(
      sortCatalog([
        { id: "claude-old", createdAt: 10 },
        { id: "vendor-new", createdAt: 20 },
      ]).map((m) => m.id),
    ).toEqual(["vendor-new", "claude-old"]);
    for (const id of [
      "gpt-image-2",
      "text-embedding-3-small",
      "whisper-1",
      "tts-1",
      "vendor/rerank-v2",
    ])
      expect(isKnownNonChatModel(id)).toBe(true);
    for (const id of [
      "gpt-conversation",
      "deepseek-chat",
      "gemini-flash",
      "vendor/unknown-v1",
      "gpt-audio",
    ])
      expect(isKnownNonChatModel(id)).toBe(false);
  });
});

describe("unified model persistence and fallback", () => {
  it("restores the real model, protocol and selected default when reopening a saved provider", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockResolvedValue([
      { id: "vendor/chat", ownedBy: null },
    ]);
    const submit = mount({ apiFormat: "openai_responses" });
    save();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const saved = submit.mock.calls[0][0];
    cleanup();
    const updated = mount(
      saved.meta,
      JSON.parse(saved.settingsConfig).env.ANTHROPIC_MODEL,
    );
    expect(screen.getByRole("radio", { name: "vendor/chat" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "providerForm.apiFormat" }),
    ).toHaveTextContent("OpenAI Responses");
    save();
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(updated.mock.calls[0][0].meta.claudeDesktopModelRoutes).toEqual(
      saved.meta.claudeDesktopModelRoutes,
    );
  });

  it("supports manual non-Claude models when the provider has no model directory", async () => {
    vi.mocked(fetchClaudeDesktopModels).mockRejectedValue(
      new Error("HTTP 404"),
    );
    const submit = mount({ apiFormat: "openai_chat" });
    fireEvent.click(screen.getByText("claudeDesktop.catalogAdvanced"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "claudeDesktop.directModelListTitle",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "claudeDesktop.addModel" }),
    );
    fireEvent.change(
      screen.getByLabelText("claudeDesktop.upstreamModelLabel 1"),
      { target: { value: "deepseek-chat" } },
    );
    save();
    await screen.findByText("claudeDesktop.catalogFailed");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "claudeDesktop.catalogManualSave" }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(
      submit.mock.calls[0][0].meta.claudeDesktopModelRoutes[
        "claude-deepseek-chat"
      ].model,
    ).toBe("deepseek-chat");
    expect(submit.mock.calls[0][0].meta.apiFormat).toBe("openai_chat");
    expect(submit.mock.calls[0][0].meta.claudeDesktopMode).toBe("proxy");
  });
});
