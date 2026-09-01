import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { server } from "../msw/server";

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

  it("closes the confirmation before a successful submit closes its parent", async () => {
    let confirmationVisibleDuringSubmit = true;
    const onSubmit = vi.fn(() => {
      confirmationVisibleDuringSubmit =
        screen.queryByText("配置存在以下问题") !== null;
    });
    renderProviderForm(onSubmit);

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

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("配置存在以下问题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "仍要保存" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("配置存在以下问题")).toBeInTheDocument();
  });
});
