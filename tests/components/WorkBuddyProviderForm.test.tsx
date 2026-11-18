import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { server } from "../msw/server";

describe("WorkBuddyProviderForm", () => {
  const settingsConfig = {
    vendor: "Synthetic",
    url: "https://model.example.test/v1/chat/completions",
    apiKey: "SYNTHETIC_MODEL_KEY",
    api: "legacy-format",
    futureSetting: { keep: true },
    models: [{ id: "synthetic-model", futureFlag: true }],
  };

  it("adds an official card from the dialog footer without carrying over the custom key", async () => {
    server.use(
      http.post("http://tauri.local/workbuddy_model_owners", () =>
        HttpResponse.json([]),
      ),
      http.post("http://tauri.local/auth_get_status", () =>
        HttpResponse.json({
          accounts: [{ id: "synthetic-account", login: "Test user" }],
          default_account_id: "synthetic-account",
        }),
      ),
    );
    const save = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddProviderDialog
          open
          onOpenChange={vi.fn()}
          appId="workbuddy"
          onSubmit={save}
          creationPrefill={{ name: "Test", settingsConfig }}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "official" },
    });
    await waitFor(() => expect(screen.getByText("打开 WorkBuddy")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({
      category: "official",
      settingsConfig: {},
      meta: { authBinding: undefined },
    });
  });

  it("edits an existing provider through the footer and preserves provider extensions", async () => {
    server.use(
      http.post("http://tauri.local/workbuddy_model_owners", () =>
        HttpResponse.json([]),
      ),
    );
    let finish!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditProviderDialog
          open
          onOpenChange={close}
          appId="workbuddy"
          onSubmit={save}
          provider={{ id: "synthetic", name: "Test", settingsConfig }}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByDisplayValue("Test"), {
      target: { value: "Edited" },
    });
    const button = screen.getByRole("button", { name: "common.save" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ name: "Edited", settingsConfig }),
      }),
    );
    finish();
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });

  it("submits a selected preset as a WorkBuddy model config", async () => {
    server.use(
      http.post("http://tauri.local/auth_get_status", () =>
        HttpResponse.json({ accounts: [], default_account_id: null }),
      ),
      http.post("http://tauri.local/workbuddy_model_owners", () =>
        HttpResponse.json([]),
      ),
    );

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <ProviderForm
          appId="workbuddy"
          submitLabel="保存"
          onSubmit={onSubmit}
          onCancel={() => {}}
        />
      </QueryClientProvider>,
    );

    const nameInput = document.querySelector(
      'input[name="name"]',
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "DeepSeek WorkBuddy" } });

    const presetSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(presetSelect, { target: { value: "1" } });

    expect(
      await screen.findByDisplayValue(
        "https://api.deepseek.com/v1/chat/completions",
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("deepseek-chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const payload = onSubmit.mock.calls[0][0];
    const config = JSON.parse(payload.settingsConfig);
    expect(payload.name).toBe("DeepSeek WorkBuddy");
    expect(config.vendor).toBe("DeepSeek");
    expect(config.api).toBe("openai-completions");
    expect(config.models.map((model: { id: string }) => model.id)).toEqual([
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
  });
});
