import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { UniversalProviderPanel } from "@/components/universal/UniversalProviderPanel";
import { UniversalProviderFormModal } from "@/components/universal/UniversalProviderFormModal";
import { universalSyncFailedTools } from "@/components/universal/useUniversalProviderSave";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { universalProvidersApi } from "@/lib/api";
import { toast } from "sonner";
import type { UniversalProvider } from "@/types";

vi.mock("@/lib/api", () => ({
  universalProvidersApi: {
    getAll: vi.fn(),
    upsert: vi.fn(),
    sync: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/components/JsonEditor", () => ({
  default: ({ value }: { value: string }) => <pre>{value}</pre>,
}));
vi.mock("@/components/ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("@/components/providers/forms/ProviderForm", () => ({
  ProviderForm: () => null,
}));
vi.mock("@/components/common/FullScreenPanel", () => ({
  FullScreenPanel: ({ isOpen, title, children, footer, onClose }: any) =>
    isOpen ? (
      <section aria-label={title}>
        <h1>{title}</h1>
        <button aria-label="返回" onClick={onClose}>
          返回
        </button>
        {children}
        {footer}
      </section>
    ) : null,
}));

const fixture: UniversalProvider = {
  id: "synthetic-provider",
  name: "Synthetic Gateway",
  providerType: "custom_gateway",
  baseUrl: "https://gateway.example.invalid/custom",
  apiKey: "synthetic-key",
  apps: { claude: true, codex: true, gemini: true },
  models: {},
};
const settle = async () => {
  await act(async () => {});
};
async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "Synthetic Gateway" },
  });
  fireEvent.change(screen.getByLabelText("API 地址"), {
    target: { value: fixture.baseUrl },
  });
  fireEvent.change(screen.getByLabelText("API Key"), {
    target: { value: fixture.apiKey },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加并同步" }));
  await settle();
}

describe("universal provider creation and recovery", () => {
  it("exposes only known failed tools, not raw IPC or credential text", () => {
    expect(
      universalSyncFailedTools(
        "统一供应商已保存，以下工具未完成同步：claude、codex。details",
      ),
    ).toBe("Claude Code / Codex");
    expect(
      universalSyncFailedTools("parser contains synthetic-secret-key"),
    ).toBeUndefined();
    expect(
      universalSyncFailedTools("以下工具未完成同步：constructor、gemini。"),
    ).toBe("Gemini CLI");
  });
  beforeEach(() => {
    i18n.addResourceBundle("zh", "translation", zh, true, true);
    vi.mocked(universalProvidersApi.getAll).mockReset().mockResolvedValue({});
    vi.mocked(universalProvidersApi.upsert).mockReset().mockResolvedValue(true);
    vi.mocked(universalProvidersApi.sync).mockReset().mockResolvedValue(true);
  });

  it("exposes add actions in the standalone header and empty state, then saves and syncs", async () => {
    render(<UniversalProviderPanel />);
    await screen.findByText("还没有统一供应商");
    expect(
      screen.getAllByRole("button", { name: "添加统一供应商" }),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加统一供应商" })[1],
    );
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.queryByLabelText("API 地址")).not.toBeInTheDocument(),
    );
    const saved = vi.mocked(universalProvidersApi.upsert).mock.calls[0][0];
    expect(universalProvidersApi.sync).toHaveBeenCalledWith(saved.id);
    expect(universalProvidersApi.getAll).toHaveBeenCalledTimes(2);
  });

  it("keeps fields when saving fails and does not attempt sync", async () => {
    vi.mocked(universalProvidersApi.upsert).mockRejectedValueOnce(
      new Error("synthetic save failure"),
    );
    render(<UniversalProviderPanel />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加统一供应商" })[0],
    );
    await fillAndSubmit();
    expect(screen.getByLabelText("API Key")).toHaveValue(fixture.apiKey);
    expect(universalProvidersApi.sync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(zh.universalProvider.saveError, {
      position: "top-center",
    });
  });

  it("retries a saved but unsynced provider with the same ID without duplicate creation", async () => {
    vi.mocked(universalProvidersApi.sync).mockRejectedValueOnce(
      new Error("synthetic sync failure"),
    );
    render(<UniversalProviderPanel />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加统一供应商" })[0],
    );
    await fillAndSubmit();
    expect(toast.warning).toHaveBeenCalledWith(
      zh.universalProvider.savedButSyncFailed,
      { position: "top-center" },
    );
    expect(screen.getByLabelText("API 地址")).toHaveValue(fixture.baseUrl);
    fireEvent.click(screen.getByRole("button", { name: "添加并同步" }));
    await waitFor(() =>
      expect(universalProvidersApi.sync).toHaveBeenCalledTimes(2),
    );
    const calls = vi.mocked(universalProvidersApi.upsert).mock.calls;
    expect(calls[0][0].id).toBe(calls[1][0].id);
    await waitFor(() =>
      expect(screen.queryByLabelText("API 地址")).not.toBeInTheDocument(),
    );
  });

  it("blocks repeated submit and closing while the request is pending", async () => {
    let complete!: (value: boolean) => void;
    vi.mocked(universalProvidersApi.upsert).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    render(<UniversalProviderPanel />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "添加统一供应商" })[0],
    );
    await fillAndSubmit();
    const submit = screen.getByRole("button", { name: "添加并同步" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(universalProvidersApi.upsert).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(true);
    });
  });

  it("also syncs when created through the existing add-provider dialog", async () => {
    render(
      <AddProviderDialog
        open
        appId="claude"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.mouseDown(
      screen.getByRole("tab", { name: zh.provider.tabUniversal }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "添加统一供应商" }),
    );
    await fillAndSubmit();
    await waitFor(() =>
      expect(universalProvidersApi.sync).toHaveBeenCalledTimes(1),
    );
  });

  it("preserves an edited draft after save-and-sync failure", async () => {
    const save = vi.fn().mockResolvedValue(false);
    const close = vi.fn();
    render(
      <UniversalProviderFormModal
        isOpen
        onClose={close}
        onSave={save}
        onSaveAndSync={save}
        editingProvider={fixture}
      />,
    );
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Edited Gateway" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并同步" }));
    const buttons = await screen.findAllByRole("button", {
      name: "保存并同步",
    });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("名称")).toHaveValue("Edited Gateway");
    expect(save.mock.calls[0][0].id).toBe(fixture.id);
  });

  it("keeps a failed duplicate editable and retries the same copy", async () => {
    vi.mocked(universalProvidersApi.getAll).mockResolvedValue({
      [fixture.id]: fixture,
    });
    vi.mocked(universalProvidersApi.sync).mockRejectedValueOnce(
      new Error("synthetic copy sync failure"),
    );
    render(<UniversalProviderPanel />);
    fireEvent.click(await screen.findByTitle("复制"));
    await waitFor(() =>
      expect(screen.getByLabelText("名称")).toHaveValue(
        "Synthetic Gateway copy",
      ),
    );
    const copyId = vi.mocked(universalProvidersApi.upsert).mock.calls[0][0].id;
    expect(copyId).not.toBe(fixture.id);
    fireEvent.click(screen.getByRole("button", { name: "保存并同步" }));
    const buttons = await screen.findAllByRole("button", {
      name: "保存并同步",
    });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(universalProvidersApi.upsert).toHaveBeenCalledTimes(2),
    );
    expect(vi.mocked(universalProvidersApi.upsert).mock.calls[1][0].id).toBe(
      copyId,
    );
  });
});
