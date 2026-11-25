import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareEcommerceImageExport } from "../src/ecommerce-image-output";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderer(width: number, height: number) {
  const image = { width, height, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(image));
  const context = {
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
  };
  const canvas = document.createElement("canvas");
  vi.spyOn(document, "createElement").mockReturnValue(canvas);
  vi.spyOn(canvas, "getContext").mockReturnValue(context as any);
  const output = new Blob(["synthetic PNG"], { type: "image/png" });
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(output));
  return { image, canvas, context, output };
}

describe("ecommerce image delivery size", () => {
  it("exports the observed 1254px model response at requested 1024px without changing the stored source", async () => {
    const { image, canvas, context, output } = renderer(1254, 1254);
    const source = new Blob(["original"], { type: "image/png" });
    expect(await prepareEcommerceImageExport(source, "1024x1024")).toBe(output);
    expect([canvas.width, canvas.height]).toEqual([1024, 1024]);
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 1024, 1024);
    expect(source.size).toBe(8);
    expect(image.close).toHaveBeenCalledOnce();
  });
  it("contains a square in an A+ banner without cropping or stretching the product", async () => {
    const { image, context } = renderer(1254, 1254);
    await prepareEcommerceImageExport(new Blob(), "1472x608");
    expect(context.drawImage).toHaveBeenCalledWith(image, 432, 0, 608, 608);
  });
  it("returns an already correctly sized PNG unchanged", async () => {
    const { context } = renderer(1024, 1024);
    const source = new Blob(["original"], { type: "image/png" });
    expect(await prepareEcommerceImageExport(source, "1024x1024")).toBe(source);
    expect(context.drawImage).not.toHaveBeenCalled();
  });
  it("encodes other input formats as PNG to match the download extension", async () => {
    const { canvas } = renderer(1024, 1024);
    await prepareEcommerceImageExport(
      new Blob(["jpeg"], { type: "image/jpeg" }),
      "1024x1024",
    );
    expect(canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
    );
  });
  it("rejects invalid/excessive dimensions before decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    for (const size of ["auto", "0x1024", "9000x9000", "1024x-1"])
      await expect(
        prepareEcommerceImageExport(new Blob(), size),
      ).rejects.toThrow("导出尺寸无效");
    expect(decode).not.toHaveBeenCalled();
  });
  it("reports encoder failure and frees the decoded image", async () => {
    const { canvas, image } = renderer(1254, 1254);
    vi.mocked(canvas.toBlob).mockImplementation((callback) => callback(null));
    await expect(
      prepareEcommerceImageExport(new Blob(), "1024x1024"),
    ).rejects.toThrow("原图仍保存在本机");
    expect(image.close).toHaveBeenCalledOnce();
  });
});
