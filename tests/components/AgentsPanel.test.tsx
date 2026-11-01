import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { agentsApi, agentTemplate, type AgentSnapshot } from "@/lib/api/agents";

const snapshot = (): AgentSnapshot => ({
  revision: "synthetic-r1",
  path: "/synthetic/agents",
  canRestore: true,
  files: [
    {
      id: "review.md",
      content: agentTemplate("claude"),
      validationError: null,
    },
  ],
});
function mount(target: "claude" | "opencode" | "codex" | null = "claude") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <AgentsPanel
        origin={target ?? "pi"}
        target={target}
        onTargetChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { client, ...result };
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(agentsApi, "read").mockResolvedValue(snapshot());
});
describe("tool-native Agent files", () => {
  it("does not query an unsupported tool or silently choose Claude", () => {
    mount("codex");
    expect(agentsApi.read).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "agents.add" }),
    ).not.toBeInTheDocument();
  });
  it("keeps the original revision and raw draft after refresh and failed saves", async () => {
    const write = vi
      .spyOn(agentsApi, "write")
      .mockRejectedValue(new Error("synthetic conflict"));
    const { client } = mount();
    await screen.findByText("review.md");
    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
    const dialog = screen.getByRole("dialog");
    const content = agentTemplate("claude") + "\nSynthetic draft.\n";
    fireEvent.change(within(dialog).getByLabelText("agents.content"), {
      target: { value: content },
    });
    client.setQueryData(["agents", "claude"], {
      ...snapshot(),
      revision: "external-r2",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.save" }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("claude", {
        id: "review.md",
        content,
        revision: "synthetic-r1",
      }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "agents.failed",
    );
    expect(within(dialog).getByLabelText("agents.content")).toHaveValue(
      content,
    );
    expect(within(dialog).getByLabelText("agents.filename")).toBeDisabled();
  });
  it("requires confirmation for delete and sends null with the captured revision", async () => {
    const write = vi
      .spyOn(agentsApi, "write")
      .mockResolvedValue({ ...snapshot(), files: [] });
    mount();
    await screen.findByText("review.md");
    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "common.cancel",
      }),
    );
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "common.confirm",
      }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("claude", {
        id: "review.md",
        content: null,
        revision: "synthetic-r1",
      }),
    );
    expect(await screen.findByText("agents.empty")).toBeInTheDocument();
  });
  it("creates an OpenCode file using its own template and prevents duplicate filenames", async () => {
    const write = vi.spyOn(agentsApi, "write").mockResolvedValue(snapshot());
    mount("opencode");
    await screen.findByText("review.md");
    expect(agentsApi.read).toHaveBeenCalledWith("opencode");
    fireEvent.click(screen.getByRole("button", { name: "agents.add" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("agents.content")).toHaveValue(
      agentTemplate("opencode"),
    );
    fireEvent.change(within(dialog).getByLabelText("agents.filename"), {
      target: { value: "review.md" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.save" }),
    );
    expect(write).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "agents.filenameInvalid",
    );
    fireEvent.change(within(dialog).getByLabelText("agents.filename"), {
      target: { value: "second.md" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "common.save" }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("opencode", {
        id: "second.md",
        content: agentTemplate("opencode"),
        revision: "synthetic-r1",
      }),
    );
  });
  it("confirms recovery and uses the current tool revision", async () => {
    const restore = vi
      .spyOn(agentsApi, "restore")
      .mockResolvedValue({ ...snapshot(), canRestore: false });
    mount();
    await screen.findByText("review.md");
    fireEvent.click(screen.getByRole("button", { name: "agents.restore" }));
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "common.confirm",
      }),
    );
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith("claude", "synthetic-r1"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "agents.restore" }),
      ).toBeDisabled(),
    );
  });
  it("shows a read error and keeps mutation controls disabled", async () => {
    vi.mocked(agentsApi.read).mockRejectedValue(
      new Error("synthetic read error"),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "navigation.loadFailed",
    );
    expect(screen.queryByText("agents.empty")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "agents.add" })).toBeDisabled();
  });
});
