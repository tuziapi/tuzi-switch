import { compressImageBlob } from '@aitu/utils';
import { GEMINI_OMNI_DURATIONS, GEMINI_OMNI_MODEL_ID, GEMINI_OMNI_SIZES } from '../utils/gemini-omni-model';
import { readKeepOriginalImageEnabled } from './reference-image-settings';

/** Our gateway accepts JSON; the Mux interaction transport stays on the server. */
export async function buildGeminiOmniVideoBody(form: FormData, signal?: AbortSignal): Promise<string> {
  const prompt = String(form.get('prompt') || '').trim();
  const seconds = String(form.get('seconds') || '4');
  const size = String(form.get('size') || '1280x720');
  if (!prompt) throw new Error('请填写视频提示词');
  if (!GEMINI_OMNI_DURATIONS.includes(seconds)) throw new Error('Gemini Omni 视频时长须为 3–10 秒整数');
  if (!GEMINI_OMNI_SIZES.some(option => option.value === size))
    throw new Error('Gemini Omni 请选择 360P、720P、1080P 或 4K 的横屏/竖屏尺寸');
  const references = form.getAll('input_reference');
  if (references.length > 10) throw new Error('Gemini Omni 最多支持 10 张参考图');
  // Explicit allowlist: never forward Veo/Sora watermark or arbitrary old params.
  const body: Record<string, unknown> = { model: GEMINI_OMNI_MODEL_ID, seconds, size };
  if (!references.length) body.prompt = prompt;
  else {
    const input: Record<string, string>[] = [{ type: 'text', text: prompt }];
    // Leave room for JSON and text in the gateway's 1 MiB runtime snapshot.
    const maxBytes = Math.floor(640 * 1024 / references.length);
    for (const reference of references) {
      signal?.throwIfAborted();
      if (!(reference instanceof Blob) || !reference.type.startsWith('image/') || !reference.size)
        throw new Error('Gemini Omni 参考图无效，请重新上传图片');
      let blob: Blob = reference;
      if (blob.size > maxBytes && !readKeepOriginalImageEnabled())
        blob = await compressImageBlob(blob, maxBytes / 1024 ** 2);
      if (blob.size > maxBytes)
        throw new Error('Gemini Omni 参考图总量过大，请压缩、减少图片或关闭保留原图后重试');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      input.push({ type: 'image', mime_type: blob.type, data: btoa(binary) });
    }
    body.input = input;
  }
  signal?.throwIfAborted();
  const json = JSON.stringify(body);
  if (new TextEncoder().encode(json).length > 960 * 1024)
    throw new Error('Gemini Omni 请求过大，请缩短提示词或减少参考图');
  return json;
}
