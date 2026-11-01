import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TuziNativeToolDialog } from "@/components/providers/TuziNativeToolDialog";
import { nativeToolsApi, type NativeTool } from "@/lib/api/nativeTools";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const snapshot = {
  revision: "synthetic-before",
  providers: {},
  current: null,
  path: "/synthetic/config",
  canRestore: false,
};
const draft = {
  appId: "grokbuild" as const,
  protocol: "chat" as const,
  key: "sk-SYNTHETIC_MODEL_KEY",
  tokenId: "9",
  userId: "7",
  generation: 3,
  model: "synthetic-model",
  name: "合成密钥",
};
function mount(tool: NativeTool = "grokbuild") {
  const onClose = vi.fn(),
    onSaved = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TuziNativeToolDialog
        draft={{ ...draft, appId: tool }}
        onClose={onClose}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { onClose, onSaved, client, ...view };
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke)
    .mockReset()
    .mockResolvedValue({
      ...snapshot,
      revision: "synthetic-after",
      canRestore: true,
    });
  vi.spyOn(nativeToolsApi, "read").mockResolvedValue(snapshot);
});
it.each(["grokbuild", "pi", "mcode"] as const)(
  "saves %s through the account gate and retains the native revision",
  async (tool) => {
    const { onSaved, client } = mount(tool);
    const add = await screen.findByRole("button", { name: "添加" });
    await waitFor(() => expect(add).toBeEnabled());
    expect(screen.getByLabelText("配置名称")).toHaveValue("兔子线路-合成密钥");
    expect(screen.queryByDisplayValue(draft.key)).toBeNull();
    if (tool === "grokbuild")
      fireEvent.change(screen.getByLabelText(/上下文长度/), {
        target: { value: "32000" },
      });
    fireEvent.click(add);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [command, args] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe("tuzi_native_tool_save");
    expect(args).toMatchObject({
      tool,
      revision: "synthetic-before",
      selection: {
        name: "兔子线路-合成密钥",
        model: draft.model,
        key: draft.key,
        protocol: "chat",
        contextWindow: tool === "grokbuild" ? 32000 : null,
      },
      source: {
        site: "https://api.tu-zi.com",
        userId: "7",
        tokenId: "9",
        generation: 3,
      },
    });
    expect(client.getQueryData(["nativeTool", tool])).toMatchObject({
      revision: "synthetic-after",
    });
  },
);
it("keeps the draft on conflict, redacts the key and retries only with a refreshed revision", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(`synthetic conflict ${draft.key}`);
  const { onSaved } = mount();
  const add = screen.getByRole("button", { name: "添加" });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.change(screen.getByLabelText("配置名称"), {
    target: { value: "修改后的名称" },
  });
  fireEvent.click(add);
  expect(await screen.findByRole("alert")).toHaveTextContent("[已脱敏]");
  expect(screen.getByRole("alert")).not.toHaveTextContent(draft.key);
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByLabelText("配置名称")).toHaveValue("修改后的名称");
  vi.mocked(nativeToolsApi.read).mockResolvedValueOnce({
    ...snapshot,
    revision: "external-revision",
  });
  fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }));
  await waitFor(() => expect(nativeToolsApi.read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
    revision: "external-revision",
    selection: { name: "修改后的名称" },
  });
});
it("blocks duplicate saves and close until the transaction returns", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { onClose, onSaved } = mount();
  const add = screen.getByRole("button", { name: "添加" });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button", { name: /窗口/ }));
  expect(invoke).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  complete(snapshot);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});
it("does not write on a failed read or invalid context length", async () => {
  vi.mocked(nativeToolsApi.read).mockRejectedValueOnce(
    new Error("synthetic unreadable"),
  );
  mount();
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "添加" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText(/上下文长度/), {
    target: { value: "0" },
  });
  expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
  expect(invoke).not.toHaveBeenCalled();
});
