import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ModelDiscoveryDialog } from "../model-discovery-dialog";
import { ModelVendor, type ModelConfig } from "../../../constants/model-config";
vi.mock("../../dialog/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? children : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("../../shared", () => ({ HoverTip: ({ children }: any) => children }));
afterEach(cleanup);
it("keeps user selection across catalogue array refreshes and resets on reopening", () => {
  const model = {
    id: "MiniMax-H3",
    label: "MiniMax-H3",
    shortLabel: "H3",
    shortCode: "h3",
    type: "video",
    vendor: ModelVendor.MINIMAX,
  } as ModelConfig;
  const confirm = vi.fn();
  const props = {
    open: true,
    container: null,
    models: [model],
    selectedModelIds: [],
    onClose: vi.fn(),
    onConfirm: confirm,
  };
  const view = render(<ModelDiscoveryDialog {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "全选" }));
  view.rerender(
    <ModelDiscoveryDialog
      {...props}
      models={[{ ...model }]}
      selectedModelIds={[]}
    />,
  );
  expect(screen.getAllByText("已选 1").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
  expect(confirm).toHaveBeenLastCalledWith(["MiniMax-H3"]);
  view.rerender(<ModelDiscoveryDialog {...props} open={false} />);
  view.rerender(<ModelDiscoveryDialog {...props} />);
  expect(screen.getByText("已选 0")).toBeTruthy();
});
