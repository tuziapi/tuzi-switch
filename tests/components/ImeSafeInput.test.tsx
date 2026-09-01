import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImeSafeInput } from "@/components/ui/ime-safe-input";

describe("ImeSafeInput", () => {
  it("keeps marked text local until composition ends", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ImeSafeInput value="original" onValueChange={onValueChange} />,
    );
    const input = screen.getByRole("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "中文输入" } });
    rerender(<ImeSafeInput value="original" onValueChange={onValueChange} />);

    expect(input).toHaveValue("中文输入");
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input, { target: { value: "中文输入" } });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("中文输入");
  });

  it("commits unfinished composition once on blur", () => {
    const onValueChange = vi.fn();
    render(<ImeSafeInput value="" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "失焦提交" } });
    fireEvent.blur(input);
    fireEvent.compositionEnd(input, { target: { value: "失焦提交" } });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("失焦提交");
  });

  it("normalizes only committed values", () => {
    const onValueChange = vi.fn();
    render(
      <ImeSafeInput
        value=""
        onValueChange={onValueChange}
        normalize={(value) => value.toLowerCase().replace(/\s/g, "")}
      />,
    );
    const input = screen.getByRole("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "A B" } });
    expect(input).toHaveValue("A B");

    fireEvent.compositionEnd(input, { target: { value: "A B" } });
    expect(input).toHaveValue("ab");
    expect(onValueChange).toHaveBeenCalledWith("ab");
  });
});
