import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeDesktopProviderForm } from "@/components/providers/forms/ClaudeDesktopProviderForm";
import { ClaudeModelCatalog } from "@/components/providers/forms/ClaudeModelCatalog";
import { fetchClaudeDesktopModels } from "@/lib/api/model-fetch";
import {
  sortCatalog,
  mergeCatalogRoutes,
  configuredModels,
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
function mount(meta = {}) {
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
              ANTHROPIC_MODEL: "claude-custom",
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
  it("shows ten, searches the entire catalog, expands and lists other models without mapping them", async () => {
    render(
      <ClaudeModelCatalog
        models={[...models, { id: "image-model" }]}
        defaultModel={models[13].id}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    fireEvent.click(screen.getByText("claudeDesktop.catalogExpand"));
    expect(screen.getAllByRole("radio")).toHaveLength(14);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "test-0" },
    });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "image" },
    });
    fireEvent.click(screen.getByText("claudeDesktop.catalogClaude"));
    expect(screen.getByRole("radio", { name: "image-model" })).toBeDisabled();
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
  it("requires a manual mapping when the catalog has no Claude models", async () => {
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
