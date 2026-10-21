// Real CodeMirror regression; synthetic input only, no native writes.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";
import { http, HttpResponse } from "msw";
import { it, expect, vi } from "vitest";
import { ProviderForm } from "@/components/providers/forms/ProviderForm";
import { tuziCreationPrefill } from "@/components/providers/TuziProviderDialog";
import { server } from "../msw/server";

it("keeps the cursor and raw draft intact without generating provider fragments", async () => {
  Range.prototype.getClientRects = () => [] as any;
  Range.prototype.getBoundingClientRect = () =>
    ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as any;
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
    http.post("http://tauri.local/read_all_codex_env_keys", () =>
      HttpResponse.json({}),
    ),
    http.post("http://tauri.local/validate_toml", () =>
      HttpResponse.json(null),
    ),
  );
  const draft = tuziCreationPrefill({
    appId: "codex",
    protocol: "responses",
    key: "SYNTHETIC_DIAGNOSTIC_KEY",
    tokenId: "17",
    userId: "20",
    generation: 1,
    model: "synthetic-model",
    name: "Synthetic diagnostic",
  });
  const submit = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ProviderForm
        appId="codex"
        creationPrefill={draft}
        submitLabel="保存"
        onSubmit={submit}
        onCancel={() => {}}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("API Key")).toHaveValue(
      "SYNTHETIC_DIAGNOSTIC_KEY",
    ),
  );
  const editor = () =>
    EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
  await waitFor(() => expect(editor()).toBeTruthy());

  for (const name of ["custo", "cust", "cus", "cu", "c", "cd"]) {
    const view = editor();
    const text = view.state.doc.toString();
    const match = /model_provider = "([^"]+)"/.exec(text)!;
    const from = match.index + 'model_provider = "'.length;
    const to = from + match[1].length;
    await act(async () =>
      view.dispatch({
        changes: { from, to, insert: name },
        selection: { anchor: from + name.length },
      }),
    );

    expect(editor().state.selection.main.head).toBe(from + name.length);
    expect(editor().state.doc.toString()).not.toContain(
      `[model_providers.${name}]`,
    );
  }
  // Finish the rename explicitly; preserve arbitrary settings in the submitted document.
  const finalDraft =
    editor()
      .state.doc.toString()
      .replace(/\[model_providers\.[^\]]+\]/, "[model_providers.cd]") +
    '\n[mcp_servers.synthetic]\ncommand = "synthetic-command"\n';
  await act(async () =>
    editor().dispatch({
      changes: { from: 0, to: editor().state.doc.length, insert: finalDraft },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig).config;
  expect(saved).toContain("[model_providers.cd]");
  expect(saved).toContain("[mcp_servers.synthetic]");
  for (const name of ["custo", "cust", "cus", "cu", "c"])
    expect(saved).not.toContain(`[model_providers.${name}]`);
});
