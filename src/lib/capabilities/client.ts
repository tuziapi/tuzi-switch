import { invoke } from "@tauri-apps/api/core";

export type CapabilityErrorCode =
  | "unsupported_capability"
  | "invalid_payload"
  | "permission_denied"
  | "execution_failed"
  | "internal_error";

export interface CapabilityDescriptor {
  id: string;
  version: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  flags?: string[];
}

export interface CapabilityManifest {
  abiVersion: "1";
  nativeVersion: string;
  platform: "macos" | "windows" | "linux" | "unknown";
  capabilities: CapabilityDescriptor[];
}

export interface CapabilityRequest<TPayload = unknown> {
  id: string;
  version?: string;
  payload?: TPayload;
}

export interface CapabilityError {
  code: CapabilityErrorCode;
  message: string;
  retryable: boolean;
}

export interface CapabilityResponse<TData = unknown> {
  ok: boolean;
  data?: TData;
  error?: CapabilityError;
}

let manifestCache: CapabilityManifest | null = null;

export async function getCapabilityManifest(
  force = false,
): Promise<CapabilityManifest> {
  if (!force && manifestCache) return manifestCache;
  manifestCache = await invoke<CapabilityManifest>("get_capability_manifest");
  return manifestCache;
}

export async function invokeCapability<TData = unknown, TPayload = unknown>(
  request: CapabilityRequest<TPayload>,
): Promise<TData> {
  const response = await invoke<CapabilityResponse<TData>>(
    "invoke_capability",
    {
      request,
    },
  );
  if (!response.ok) {
    throw new Error(response.error?.message || "Capability invocation failed");
  }
  return response.data as TData;
}

export async function supportsCapability(
  id: string,
  range = ">=1.0.0",
): Promise<boolean> {
  const manifest = await getCapabilityManifest();
  const capability = manifest.capabilities.find((item) => item.id === id);
  return capability ? isVersionCompatible(capability.version, range) : false;
}

export function isVersionCompatible(version: string, range: string): boolean {
  return range
    .split(/\s+/)
    .filter(Boolean)
    .every((rule) => {
      if (rule.startsWith(">=")) {
        return compareVersions(version, rule.slice(2)) >= 0;
      }
      if (rule.startsWith(">")) {
        return compareVersions(version, rule.slice(1)) > 0;
      }
      if (rule.startsWith("<=")) {
        return compareVersions(version, rule.slice(2)) <= 0;
      }
      if (rule.startsWith("<")) {
        return compareVersions(version, rule.slice(1)) < 0;
      }
      if (rule.startsWith("=")) {
        return compareVersions(version, rule.slice(1)) === 0;
      }
      return compareVersions(version, rule) === 0;
    });
}

function compareVersions(a: string, b: string): number {
  const pa = parseSemverCore(a);
  const pb = parseSemverCore(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseSemverCore(version: string): [number, number, number] {
  const parts = version.replace(/^v/, "").split("-")[0].split(".");
  return [Number(parts[0] || 0), Number(parts[1] || 0), Number(parts[2] || 0)];
}
