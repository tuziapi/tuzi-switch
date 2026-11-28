import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/api/env", () => ({ deleteEnvVars: mocks.remove }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, warning: mocks.warning, error: mocks.error },
}));
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
const conflict = {
  varName: "ANTHROPIC_API_KEY",
  varValue: "synthetic-only-secret",
  sourceType: "system" as const,
  sourcePath: "Process Environment",
};
beforeEach(() => vi.clearAllMocks());
async function remove() {
  fireEvent.click(screen.getByText("env.actions.expand"));
  fireEvent.click(screen.getByLabelText("env.actions.selectAll"));
  fireEvent.click(screen.getByText("env.actions.deleteSelected"));
  fireEvent.click(screen.getByText("env.confirm.confirm"));
}
describe("environment deletion feedback", () => {
  it("masks credentials and does not report inherited values as deleted", async () => {
    mocks.remove.mockResolvedValue({
      backupPath: "/synthetic/backup.json",
      restartRequired: true,
      unresolvedVars: [conflict.varName],
    });
    const recheck = vi.fn();
    render(
      <EnvWarningBanner
        conflicts={[conflict]}
        onDismiss={() => {}}
        onDeleted={recheck}
      />,
    );
    await remove();
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(screen.queryByText(conflict.varValue)).not.toBeInTheDocument();
    expect(recheck).toHaveBeenCalledTimes(1);
  });
  it("rechecks after partial failures and never shows a success toast", async () => {
    mocks.remove.mockRejectedValue(new Error("synthetic deletion failure"));
    const recheck = vi.fn();
    render(
      <EnvWarningBanner
        conflicts={[conflict]}
        onDismiss={() => {}}
        onDeleted={recheck}
      />,
    );
    await remove();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
