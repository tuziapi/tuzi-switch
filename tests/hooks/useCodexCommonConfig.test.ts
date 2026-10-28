import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import { useCodexCommonConfig } from "@/components/providers/forms/hooks/useCodexCommonConfig";
import { server } from "../msw/server";

beforeEach(() => {
  server.use(http.post("http://tauri.local/get_common_config_snippet", () => HttpResponse.json("")));
});

it("finishes initialization when a draft has no settings yet", async () => {
  const { result } = renderHook(() => useCodexCommonConfig({
    codexConfig: "", onConfigChange: vi.fn(), initialData: {}, initialEnabled: false,
  }));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
});

it("finishes initialization after changing only the preset identifier", async () => {
  const onConfigChange = vi.fn();
  const { result, rerender } = renderHook(({ selectedPresetId }) => useCodexCommonConfig({
    codexConfig: "", onConfigChange, selectedPresetId,
  }), { initialProps: { selectedPresetId: "first" } });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  rerender({ selectedPresetId: "second" });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
});
