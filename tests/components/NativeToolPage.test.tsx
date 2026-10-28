import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeToolPage } from "@/components/providers/NativeToolPage";
import { nativeToolsApi, type NativeToolSnapshot } from "@/lib/api/nativeTools";

function snapshot(): NativeToolSnapshot {
  return {
    revision: "synthetic-rev-1",
    providers: {
      demo: {
        api: "openai-completions",
        baseUrl: "https://example.invalid/v1",
        apiKey: "SYNTHETIC",
        models: [{ id: "synthetic" }],
      },
    },
    current: null,
    path: "/synthetic/.pi/agent/models.json",
    canRestore: true,
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NativeToolPage tool="pi" />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(nativeToolsApi, "read").mockResolvedValue(snapshot());
});
describe("native tool editor", () => {
  it("retains an open draft and its revision when the native file refreshes", async () => {
    const write = vi
      .spyOn(nativeToolsApi, "write")
      .mockResolvedValue({ ...snapshot(), revision: "synthetic-rev-3" });
    const client = mount();
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "nativeTools.config" }),
      {
        target: {
          value: JSON.stringify({
            ...(snapshot().providers.demo as object),
            apiKey: "SYNTHETIC_DRAFT",
          }),
        },
      },
    );
    client.setQueryData(["nativeTool", "pi"], {
      ...snapshot(),
      revision: "external-rev-2",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.save" }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "pi",
        expect.objectContaining({
          revision: "synthetic-rev-1",
          id: "demo",
          config: expect.objectContaining({ apiKey: "SYNTHETIC_DRAFT" }),
        }),
      ),
    );
  });
  it("rejects invalid JSON locally and retains the draft on a native conflict", async () => {
    const write = vi
      .spyOn(nativeToolsApi, "write")
      .mockRejectedValue(new Error("synthetic conflict"));
    mount();
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("textbox", {
      name: "nativeTools.config",
    });
    fireEvent.change(input, { target: { value: "{invalid" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.save" }),
    );
    expect(write).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "nativeTools.invalidJson",
    );
    fireEvent.change(input, {
      target: { value: JSON.stringify(snapshot().providers.demo) },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.save" }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "nativeTools.failed",
      ),
    );
    expect(input).toHaveValue(JSON.stringify(snapshot().providers.demo));
  });
  it("does not delete a provider until the user confirms", async () => {
    const write = vi
      .spyOn(nativeToolsApi, "write")
      .mockResolvedValue({ ...snapshot(), providers: {} });
    mount();
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "common.confirm",
      }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("pi", {
        revision: "synthetic-rev-1",
        id: "demo",
        config: null,
      }),
    );
  });
  it("restores via the explicit native restore command", async () => {
    const restore = vi
      .spyOn(nativeToolsApi, "restore")
      .mockResolvedValue({ ...snapshot(), canRestore: false });
    mount();
    await screen.findByText("demo");
    fireEvent.click(
      screen.getByRole("button", { name: "nativeTools.restore" }),
    );
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "common.confirm",
      }),
    );
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith("pi", "synthetic-rev-1"),
    );
  });
});
