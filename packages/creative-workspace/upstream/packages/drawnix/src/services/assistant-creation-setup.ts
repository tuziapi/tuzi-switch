import type { ModelType } from '../constants/model-config';
import { resolveInvocationRoute, type ModelRef } from '../utils/settings-manager';
import { resolveInvocationPlanFromRoute } from './provider-routing';
import { ASSISTANT_OPEN_SETTINGS, getAssistantAccount, isAccountReference } from './assistant-account';

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
  const route = resolveInvocationRoute(type, model);
  const plan = resolveInvocationPlanFromRoute(type, model);
  const requestedProfile = typeof model === 'object' ? model?.profileId : null;
  const accountReady = !isAccountReference(route.apiKey) ||
    getAssistantAccount()?.state.status === 'connected';
  if (route.baseUrl?.trim() && route.apiKey?.trim() && route.modelId && plan &&
      (!requestedProfile || plan.modelRef.profileId === requestedProfile) &&
      accountReady) return true;
  window.dispatchEvent(new Event(ASSISTANT_OPEN_SETTINGS));
  return false;
}
