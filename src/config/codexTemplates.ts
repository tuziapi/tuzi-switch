/**
 * Codex 配置模板
 * 用于新建自定义供应商时的默认配置
 */

export interface CodexTemplate {
  auth: Record<string, any>;
  config: string;
}

export function getCodexCustomTemplate(): CodexTemplate {
  const config = `model_provider = "tuziswitch"
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.tuziswitch]
name = "tuziswitch"
base_url = "https://your-api-endpoint.com/v1"
env_key = "CUSTOM_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false
http_headers = { "x-openai-actor-authorization" = "http://coding.tu-zi.com" }`;

  return {
    auth: {},
    config,
  };
}
