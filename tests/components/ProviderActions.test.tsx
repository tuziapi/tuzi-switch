import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderActions } from "@/components/providers/ProviderActions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

function renderActions(
  overrides: Partial<React.ComponentProps<typeof ProviderActions>> = {},
) {
  const props: React.ComponentProps<typeof ProviderActions> = {
    appId: "codex",
    isCurrent: false,
    onSwitch: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };

  render(<ProviderActions {...props} />);
  return props;
}

describe("ProviderActions", () => {
  it("禁用当前普通供应商的删除按钮并提示先启用其他供应商", () => {
    const onDelete = vi.fn();
    renderActions({ isCurrent: true, onDelete });

    const deleteButton = screen.getByTitle(
      "当前使用中的供应商不能删除，请先启用其他供应商。",
    );

    expect(deleteButton).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("允许删除非当前普通供应商", () => {
    const onDelete = vi.fn();
    renderActions({ isCurrent: false, onDelete });

    fireEvent.click(screen.getByTitle("common.delete"));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("显示清除配置按钮并触发回调", () => {
    const onClearConfig = vi.fn();
    renderActions({ onClearConfig });

    fireEvent.click(screen.getByTitle("清除配置"));

    expect(onClearConfig).toHaveBeenCalledTimes(1);
  });

  it("切换过程中显示忙碌状态并禁止重复切换", () => {
    const onSwitch = vi.fn();
    renderActions({ isSwitching: true, isSwitchDisabled: true, onSwitch });

    const switchButton = screen.getByRole("button", {
      name: "provider.enable",
    });
    expect(switchButton).toBeDisabled();
    expect(switchButton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(switchButton);
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
