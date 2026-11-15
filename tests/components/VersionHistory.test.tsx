import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VersionHistory } from "@/components/version-history/VersionHistory";
import { HISTORY_CACHE_KEY } from "@/lib/releaseHistory";
import i18n from "@/i18n";
import zh from "@/i18n/locales/zh.json";

vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => ({ hasUpdate: false, updateInfo: null }),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.4.2" }));
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  await i18n.changeLanguage("zh");
  localStorage.removeItem(HISTORY_CACHE_KEY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it("shows future published versions, searches notes, and treats remote markup as text", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          tag_name: "v9.0.0",
          name: "Synthetic release",
          draft: false,
          prerelease: false,
          published_at: "2026-10-29T00:00:00Z",
          body: "Unique synthetic notes <script>danger()</script>",
        },
      ]),
    ),
  );
  render(<VersionHistory />);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看版本历程" }));
  await screen.findByText("共收录 41 个正式版本");
  expect(screen.getByText("发布记录已同步")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("搜索版本号、功能或问题"), {
    target: { value: "Unique synthetic" },
  });
  const release = screen.getByRole("button", { name: /v9.0.0/ });
  fireEvent.click(release);
  expect(
    screen.getByText("Unique synthetic notes <script>danger()</script>"),
  ).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "按变更类型筛选" }), {
    target: { value: "fix" },
  });
  expect(screen.getByText("未找到符合条件的版本记录")).toBeVisible();
});
it("keeps current history and search usable if syncing fails", async () => {
  fetchMock.mockRejectedValue(new TypeError("Offline"));
  render(<VersionHistory />);
  fireEvent.click(screen.getByRole("button", { name: "查看版本历程" }));
  await waitFor(() =>
    expect(
      screen.getByText("暂时无法同步，继续显示已有版本档案"),
    ).toBeVisible(),
  );
  expect(screen.getByText("共收录 40 个正式版本")).toBeVisible();
  fireEvent.change(screen.getByPlaceholderText("搜索版本号、功能或问题"), {
    target: { value: "v1.4.2" },
  });
  expect(
    screen.getByRole("button", { name: /v1.4.2 2026-10-22/ }),
  ).toBeVisible();
});
