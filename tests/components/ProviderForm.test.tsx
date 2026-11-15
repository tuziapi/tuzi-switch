import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { server } from "../msw/server";
import { tuziCreationPrefill } from "@/components/providers/TuziProviderDialog";

const renderProviderForm = (
  onSubmit: React.ComponentProps<typeof ProviderForm>["onSubmit"],
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ProviderForm
        appId="claude"
        submitLabel="保存"
        onSubmit={onSubmit}
        onCancel={() => {}}
        initialData={{
          name: "Test Provider",
          category: "third_party",
          settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: "https://api.example.com",
              ANTHROPIC_AUTH_TOKEN: "",
            },
          },
        }}
      />
    </QueryClientProvider>,
  );
};

describe("ProviderForm soft confirmation", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.post("http://tauri.local/get_settings", () =>
        HttpResponse.json({ commonConfigConfirmed: true }),
      ),
      http.post("http://tauri.local/auth_get_status", () =>
        HttpResponse.json({ authenticated: false }),
      ),
      http.post("http://tauri.local/get_common_config_snippet", () =>
        HttpResponse.json(""),
      ),
    );
  });

  it("fills and submits the selected account model Key in a new Codex form", async () => {
    const onSubmit = vi.fn();
    const readEnv = vi.fn();
    const saveRoute = vi.fn();
    server.use(
      http.post("http://tauri.local/read_codex_env_key", () => {
        readEnv();
        return HttpResponse.json(null);
      }),
      http.post("http://tauri.local/read_all_codex_env_keys", () =>
        HttpResponse.json({}),
      ),
      http.post("http://tauri.local/validate_toml", () =>
        HttpResponse.json(null),
      ),
      http.post("http://tauri.local/save_codex_route", () => {
        saveRoute();
        return HttpResponse.json({});
      }),
    );
    const creationPrefill = tuziCreationPrefill({
      appId: "codex",
      protocol: "responses",
      key: "SYNTHETIC_ACCOUNT_MODEL_KEY",
      tokenId: "17",
      userId: "20",
      generation: 1,
      model: "synthetic-model",
      name: "Synthetic account Key",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ProviderForm
          appId="codex"
          creationPrefill={creationPrefill}
          submitLabel="保存"
          onSubmit={onSubmit}
          onCancel={() => {}}
        />
      </QueryClientProvider>,
    );
    const input = await screen.findByLabelText("API Key");
    await waitFor(() =>
      expect(input).toHaveValue("SYNTHETIC_ACCOUNT_MODEL_KEY"),
    );
    expect(input).toHaveAttribute("type", "password");
    expect(readEnv).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const config = JSON.parse(onSubmit.mock.calls[0][0].settingsConfig);
    expect(config.auth.OPENAI_API_KEY).toBe("SYNTHETIC_ACCOUNT_MODEL_KEY");
    expect(config.config).toContain('model = "synthetic-model"');
    expect(config.env.envKey).toMatch(/^TUZI_SWITCH_/);
    expect(saveRoute).not.toHaveBeenCalled();
  });

  it("closes the confirmation before a successful submit closes its parent", async () => {
    let confirmationVisibleDuringSubmit = true;
    const onSubmit = vi.fn(() => {
      confirmationVisibleDuringSubmit =
        screen.queryByText("配置存在以下问题") !== null;
    });
    renderProviderForm(onSubmit);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("配置存在以下问题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "仍要保存" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(confirmationVisibleDuringSubmit).toBe(false);
    expect(screen.queryByText("配置存在以下问题")).not.toBeInTheDocument();
  });

  it("restores the confirmation when the actual save fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("save failed"));
    renderProviderForm(onSubmit);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("配置存在以下问题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "仍要保存" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("配置存在以下问题")).toBeInTheDocument();
  });
});
