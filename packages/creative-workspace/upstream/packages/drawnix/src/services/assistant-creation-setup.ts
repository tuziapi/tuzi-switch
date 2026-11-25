import type { ModelType } from '../constants/model-config';
import { resolveInvocationRoute, type ModelRef } from '../utils/settings-manager';
import { resolveInvocationPlanFromRoute } from './provider-routing';
import { ASSISTANT_OPEN_SETTINGS, getAssistantAccount, isAccountReference } from './assistant-account';

export const ASSISTANT_QUICK_SETUP = 'tuzi-assistant-quick-setup';

export interface AssistantCreationSetupRequest {
  type: ModelType;
  model?: string | ModelRef | null;
}

export interface AssistantCreationSetupResult {
  configured: boolean;
  model?: ModelRef;
}

let pendingQuickSetup: ((result: AssistantCreationSetupResult) => void) | null = null;

export function completeAssistantQuickSetup(result: AssistantCreationSetupResult): void {
  const resolve = pendingQuickSetup;
  pendingQuickSetup = null;
  resolve?.(result);
}

function openFullSettings(): AssistantCreationSetupResult {
  window.dispatchEvent(new Event(ASSISTANT_OPEN_SETTINGS));
  return { configured: false };
}

function hasConfiguredRoute(
  type: ModelType,
  model?: string | ModelRef | null,
): boolean {
  const route = resolveInvocationRoute(type, model);
  const plan = resolveInvocationPlanFromRoute(type, model);
  const requestedProfile = typeof model === 'object' ? model?.profileId : null;
  const accountReady = !isAccountReference(route.apiKey) ||
    getAssistantAccount()?.state.status === 'connected';
  return Boolean(
    route.baseUrl?.trim() && route.apiKey?.trim() && route.modelId && plan &&
      (!requestedProfile || plan.modelRef.profileId === requestedProfile) &&
      accountReady,
  );
}

/** Call after settings initialization, before consuming a draft or submitting a task.
 * Only checks local configuration; never probes a provider or replays a request.
 * Account references remain opaque and are validated by the existing host transport.
 */
export function ensureAssistantCreationConfigured(
  type: ModelType,
  model?: string | ModelRef | null,
  localTextConnected = false,
): boolean {
  if (import.meta.env.VITE_TUZI_ASSISTANT !== 'true') return true;
  if (type === 'text' && localTextConnected) return true;
  if (hasConfiguredRoute(type, model)) return true;
  openFullSettings();
  return false;
}

/** Async image-send gate used by the host so a successful quick setup can resume the original send. */
export async function ensureAssistantCreationConfiguredAsync(
  type: ModelType,
  model?: string | ModelRef | null,
  localTextConnected = false,
): Promise<AssistantCreationSetupResult> {
  if (import.meta.env.VITE_TUZI_ASSISTANT !== 'true') return { configured: true };
  if (type === 'text' && localTextConnected) return { configured: true };
  if (hasConfiguredRoute(type, model)) return { configured: true };

  const account = getAssistantAccount();
  if (type !== 'image' || !account || account.state.status !== 'connected') {
    return openFullSettings();
  }

  if (pendingQuickSetup) return { configured: false };
  return new Promise<AssistantCreationSetupResult>((resolve) => {
    pendingQuickSetup = resolve;
    window.dispatchEvent(
      new CustomEvent(ASSISTANT_QUICK_SETUP, {
        detail: { type, model } satisfies AssistantCreationSetupRequest,
      }),
    );
  });
}
