import type { ImageGenerationRequest } from './types';

export const SEEDREAM55_MODEL_ID = 'doubao-seedream-5-5-261028';
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (message: string): never => {
  throw new Error(`Seedream 5.5: ${message}`);
};
const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/** Native contract mirrored by the paired API's shared seedream55_native fixtures. */
export function validateSeedream55(body: Record<string, unknown>): number {
  const strings = [
    'model',
    'prompt',
    'size',
    'response_format',
    'output_format',
    'background',
    'safety_identifier',
  ];
  const booleans = ['stream', 'watermark', 'layer_decomposition'];
  for (const [key, value] of Object.entries(body)) {
    if (value === null) fail(`${key} must not be null`);
    if (strings.includes(key)) {
      if (typeof value !== 'string' || (key !== 'prompt' && !value.trim()))
        fail(`${key} must be a string`);
    } else if (booleans.includes(key)) {
      if (typeof value !== 'boolean') fail(`${key} must be boolean`);
    } else if (
      ![
        'image',
        'optimize_prompt_options',
        'layer_decomposition_options',
      ].includes(key)
    )
      fail(`unsupported field ${key}`);
  }
  if (!body.model) fail('model is required');
  if (body.stream === true) fail('stream=true is unsupported');
  const layers = body.layer_decomposition === true;
  if (!layers && (typeof body.prompt !== 'string' || !body.prompt.trim()))
    fail('prompt is required');
  let count = 0;
  if (has(body, 'image')) {
    const images = Array.isArray(body.image) ? body.image : [body.image];
    if (images.length < 1 || images.length > 10)
      fail('image requires 1–10 references');
    for (const image of images) {
      if (typeof image !== 'string') fail('image must be a URL or data URL');
      let valid = /^data:image\/[^;]+;base64,.+/.test(image as string);
      try {
        const u = new URL(image as string);
        valid ||=
          ['http:', 'https:'].includes(u.protocol) &&
          !!u.hostname &&
          !u.username &&
          !u.password;
      } catch {
        /* validate below */
      }
      if (!valid) fail('image must be an HTTP(S) URL or image data URL');
    }
    count = images.length;
  }
  if (layers && count !== 1) fail('layers require exactly one reference image');
  let maximum = 30;
  if (has(body, 'layer_decomposition_options')) {
    if (!record(body.layer_decomposition_options))
      fail('layer_decomposition_options must be an object');
    for (const [key, value] of Object.entries(
      body.layer_decomposition_options as Record<string, unknown>
    )) {
      if (key === 'max_images') {
        if (
          !Number.isInteger(value) ||
          (value as number) < 2 ||
          (value as number) > 100
        )
          fail('max_images must be an integer from 2 to 100');
        maximum = value as number;
      } else if (key !== 'text_recognition' || typeof value !== 'boolean')
        fail('invalid layer_decomposition_options');
    }
  }
  if (has(body, 'optimize_prompt_options')) {
    if (
      !record(body.optimize_prompt_options) ||
      Object.entries(body.optimize_prompt_options).some(
        ([k, v]) => k !== 'mode' || v !== 'standard'
      )
    )
      fail('only standard prompt optimization is supported');
  }
  if (
    has(body, 'response_format') &&
    !['url', 'b64_json'].includes(body.response_format as string)
  )
    fail('invalid response_format');
  if (
    has(body, 'output_format') &&
    !['png', 'jpeg'].includes(body.output_format as string)
  )
    fail('output_format must be png or jpeg');
  if (has(body, 'background')) {
    if (
      layers ||
      !['auto', 'opaque', 'transparent'].includes(body.background as string)
    )
      fail('background must be omitted for layers');
    if (body.background === 'transparent' && body.output_format === 'jpeg')
      fail('transparent background requires PNG');
  }
  if (
    has(body, 'safety_identifier') &&
    !/^[\x20-\x7e]{1,64}$/.test(body.safety_identifier as string)
  )
    fail('safety_identifier requires 1–64 printable ASCII characters');
  const size = body.size;
  if (
    size !== undefined &&
    !['1K', '1.5K', '2K', ...(layers ? ['auto'] : [])].includes(size as string)
  ) {
    const match = /^(\d+)x(\d+)$/.exec(String(size));
    const w = Number(match?.[1]),
      h = Number(match?.[2]);
    if (
      layers ||
      !match ||
      w * h < 921600 ||
      w * h > 4624220 ||
      w / h < 1 / 16 ||
      w / h > 16
    )
      fail(
        'invalid size; use 1K/1.5K/2K, generation pixels or auto for layers'
      );
  }
  return layers ? maximum : 1;
}

export function seedream55GenerationBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  const params = request.params ?? {};
  for (const key of [
    'stream',
    'layer_decomposition',
    'sequential_image_generation',
    'sequential_image_generation_options',
    'tools',
  ]) {
    if (params[key] !== undefined && params[key] !== false)
      fail(
        `${key} is unsupported in ordinary generation; use the layer dialog for decomposition`
      );
  }
  if (params.n !== undefined && params.n !== 1)
    fail('ordinary generation supports n=1');
  const quality = String(params.seedream_quality ?? '2k').toUpperCase();
  if (!['1K', '1.5K', '2K'].includes(quality))
    fail('resolution must be 1K, 1.5K or 2K');
  let size = request.size;
  const ratio = /^(\d+)[x:](\d+)$/.exec(size ?? '');
  if (ratio && Number(ratio[1]) <= 32 && Number(ratio[2]) <= 32) {
    const r = Number(ratio[1]) / Number(ratio[2]);
    const side = quality === '1K' ? 1024 : quality === '1.5K' ? 1536 : 2048;
    size = `${Math.round(Math.sqrt(side * side * r) / 8) * 8}x${Math.round(Math.sqrt((side * side) / r) / 8) * 8}`;
  } else if (!size || size === 'auto') size = quality;
  const body: Record<string, unknown> = {
    model: request.model || SEEDREAM55_MODEL_ID,
    prompt: request.prompt,
    size,
    response_format: 'b64_json',
    background: request.background ?? params.background ?? 'auto',
    output_format: request.outputFormat ?? params.output_format ?? 'png',
  };
  if (request.referenceImages?.length)
    body.image =
      request.referenceImages.length === 1
        ? request.referenceImages[0]
        : request.referenceImages;
  for (const key of [
    'watermark',
    'safety_identifier',
    'optimize_prompt_options',
  ])
    if (params[key] !== undefined) body[key] = params[key];
  validateSeedream55(body);
  return body;
}
