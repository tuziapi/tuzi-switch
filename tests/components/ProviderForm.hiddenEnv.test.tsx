import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { server } from "../msw/server";

function data(envKey?: string) {
  return {
    name: "Synthetic Codex",
    category: "third_party" as const,
    settingsConfig: {
      auth: { OPENAI_API_KEY: "SYNTHETIC_MODEL_KEY" },
      env: envKey ? { envKey } : {},
      config: `model_provider = "custom"\nmodel = "synthetic-model"\n[model_providers.custom]\nname = "custom"\nbase_url = "https://synthetic.example/v1"\nwire_api = "responses"\n${envKey ? `env_key = "${envKey}"\n` : ""}`,
    },
  };
}
const savedRoute = vi.fn();
function setup(initialData: ReturnType<typeof data>, edit = false) {
  const submit = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProviderForm
        appId="codex"
        submitLabel="保存"
        onSubmit={submit}
        onCancel={() => {}}
        {...(edit
          ? { initialData, providerId: "synthetic-existing" }
          : { creationPrefill: initialData })}
      />
    </QueryClientProvider>,
  );
  return submit;
}
beforeEach(() => {
  savedRoute.mockReset();
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
    http.post("http://tauri.local/validate_toml", () =>
      HttpResponse.json(null),
    ),
    http.post("http://tauri.local/get_providers", () =>
      HttpResponse.json({
        other: {
          id: "other",
          name: "other",
          settingsConfig: { env: { envKey: "CUSTOM_CODEX_API_KEY" } },
        },
      }),
    ),
    http.post("http://tauri.local/read_all_codex_env_keys", () =>
      HttpResponse.json({ CUSTOM_CODEX_API_KEY_1: "SYNTHETIC_OTHER_KEY" }),
    ),
    http.post("http://tauri.local/read_codex_provider_credential", () =>
      HttpResponse.json({ apiKey: "SYNTHETIC_MODEL_KEY", migratedFrom: null }),
    ),
    http.post("http://tauri.local/save_codex_route", async ({ request }) => {
      const payload = (await request.json()) as {
        configText: string;
        envKey: string;
      };
      savedRoute(payload);
      return HttpResponse.json({
        config: payload.configText,
        envKey: payload.envKey,
      });
    }),
  );
});

describe("Codex forms without environment variable inputs", () => {
  it("allocates a unique new reference and retains the selected Key", async () => {
    const submit = setup(data("CUSTOM_CODEX_API_KEY"));
    await waitFor(() =>
      expect(screen.getByLabelText("API Key")).toHaveValue(
        "SYNTHETIC_MODEL_KEY",
      ),
    );
    expect(document.querySelector("#codexEnvKey")).toBeNull();
    expect(screen.queryByText("环境变量名")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const config = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(config.env.envKey).toBe("CUSTOM_CODEX_API_KEY_2");
    expect(config.config).toContain('env_key = "CUSTOM_CODEX_API_KEY_2"');
    expect(config.auth.OPENAI_API_KEY).toBe("SYNTHETIC_MODEL_KEY");
  });
  it("keeps the original reference when editing even if it is duplicated", async () => {
    const submit = setup(data("CUSTOM_CODEX_API_KEY"), true);
    await waitFor(() =>
      expect(screen.getByLabelText("API Key")).toHaveValue(
        "SYNTHETIC_MODEL_KEY",
      ),
    );
    expect(document.querySelector("#codexEnvKey")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(savedRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        envKey: "CUSTOM_CODEX_API_KEY",
        apiKey: "SYNTHETIC_MODEL_KEY",
      }),
    );
    expect(JSON.parse(submit.mock.calls[0][0].settingsConfig).env.envKey).toBe(
      "CUSTOM_CODEX_API_KEY",
    );
    // Draft preparation no longer writes the key. The final native save must receive it.
    expect(
      JSON.parse(submit.mock.calls[0][0].settingsConfig).auth.OPENAI_API_KEY,
    ).toBe("SYNTHETIC_MODEL_KEY");
  });
  it("recovers a legacy configuration without a name using its own stored Key", async () => {
    const submit = setup(data(), true);
    await waitFor(() =>
      expect(screen.getByLabelText("API Key")).toHaveValue(
        "SYNTHETIC_MODEL_KEY",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(savedRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        envKey: "CUSTOM_CODEX_API_KEY_2",
        apiKey: "SYNTHETIC_MODEL_KEY",
      }),
    );
  });
  it("does not submit a credential-less configuration when the native save fails", async () => {
    server.use(
      http.post("http://tauri.local/save_codex_route", () =>
        HttpResponse.json(
          { error: "synthetic write failure" },
          { status: 500 },
        ),
      ),
    );
    const submit = setup(data("CUSTOM_CODEX_API_KEY"), true);
    const input = await screen.findByLabelText("API Key");
    await waitFor(() => expect(input).toHaveValue("SYNTHETIC_MODEL_KEY"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled(),
    );
    expect(submit).not.toHaveBeenCalled();
    expect(input).toHaveValue("SYNTHETIC_MODEL_KEY");
  });
});
