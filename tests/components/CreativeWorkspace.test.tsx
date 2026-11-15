import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreativeWorkspace } from "@/features/creative/CreativeWorkspace";

vi.mock("@tuzi/creative-workspace", () => ({
  CreativeWorkspace: ({ page }: { page: string }) => <div>Editor: {page}</div>,
}));
vi.mock("@tuzi/creative-workspace/style.css", () => ({}));

describe("creative host navigation", () => {
  it("falls back from the removed workflow tab without touching other storage", async () => {
    sessionStorage.setItem("tuzi-creative-page", "workflow");
    localStorage.setItem("legacy-workflow-test", "synthetic-preserved");
    render(<CreativeWorkspace />);
    expect(await screen.findByText("Editor: projects")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "工作流" }),
    ).not.toBeInTheDocument();
    expect(sessionStorage.getItem("tuzi-creative-page")).toBe("projects");
    expect(localStorage.getItem("legacy-workflow-test")).toBe(
      "synthetic-preserved",
    );
  });
  it("switches creative pages without navigating to a tool", async () => {
    render(<CreativeWorkspace />);
    await screen.findByText("Editor: projects");
    fireEvent.click(screen.getByRole("button", { name: "自由画布" }));
    expect(await screen.findByText("Editor: canvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我的项目" }));
    expect(await screen.findByText("Editor: projects")).toBeInTheDocument();
  });
});
