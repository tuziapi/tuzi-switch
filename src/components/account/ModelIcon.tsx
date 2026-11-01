import { ProviderIcon } from "@/components/ProviderIcon";
import { inferIconForPreset } from "@/config/iconInference";
export function ModelIcon({ name }: { name: string }) {
  const icon = /^(gpt|o[134]|chatgpt)/i.test(name)
    ? "openai"
    : /gemini|imagen|veo/i.test(name)
      ? "google"
      : inferIconForPreset(name).icon;
  return <ProviderIcon name={name} icon={icon} size={24} />;
}
