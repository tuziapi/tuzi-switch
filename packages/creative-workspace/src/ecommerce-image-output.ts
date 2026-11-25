/** Export at the task's requested size while retaining the model original. */
export async function prepareEcommerceImageExport(
  source: Blob,
  size: string,
): Promise<Blob> {
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(size);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!width || !height || width > 4096 || height > 4096)
    throw new Error("图片导出尺寸无效，请核对原任务尺寸。");
  const image = await createImageBitmap(source);
  try {
    if (!image.width || !image.height)
      throw new Error("无法读取生成图片的尺寸。");
    if (
      image.width === width &&
      image.height === height &&
      source.type === "image/png"
    )
      return source;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法处理图片尺寸。");
    // Contain the entire product. Never stretch or crop labels/product edges.
    // Transparent margins also retain alpha from background-removal results.
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob?.size
            ? resolve(blob)
            : reject(new Error("图片尺寸转换失败，原图仍保存在本机。")),
        "image/png",
      );
    });
  } finally {
    image.close();
  }
}
