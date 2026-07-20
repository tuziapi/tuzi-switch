/**
 * Codex 配置模板
 * 用于新建自定义供应商时的默认配置
 */
import {
  TUZI_CODEX_MODEL,
  TUZI_IMAGE_GENERATION_HEADER,
} from "./tuziProviderPresets";

export interface CodexTemplate {
  auth: Record<string, any>;
  config: string;
}

/**
 * 获取 Codex 自定义模板
 * @returns Codex 模板配置
 */
export function getCodexCustomTemplate(): CodexTemplate {
  const config = `model_provider = "tuziswitch"
model = "${TUZI_CODEX_MODEL}"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.tuziswitch]
name = "tuziswitch"
base_url = "https://your-api-endpoint.com/v1"
env_key = "CUSTOM_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false
http_headers = { "x-openai-actor-authorization" = "${TUZI_IMAGE_GENERATION_HEADER}" }`;

  return {
    auth: {},
    config,
  };
}
