import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ route: vi.fn(), plan: vi.fn(), account: vi.fn() }));
vi.mock('../utils/settings-manager', () => ({ resolveInvocationRoute: mocks.route }));
vi.mock('./provider-routing', () => ({ resolveInvocationPlanFromRoute: mocks.plan }));
vi.mock('./assistant-account', () => ({
  ASSISTANT_OPEN_SETTINGS: 'tuzi-assistant-open-creative-settings',
  getAssistantAccount: mocks.account,
  isAccountReference: (key: string) => key?.startsWith('tuzi-account:'),
}));
import { ensureAssistantCreationConfigured } from './assistant-creation-setup';
describe('desktop send configuration handoff', () => {
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('VITE_TUZI_ASSISTANT', 'true');
    mocks.route.mockReturnValue({ baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic-only', modelId: 'model' });
    mocks.plan.mockReturnValue({ modelRef: { profileId: 'provider' } });
    mocks.account.mockReturnValue({ state: { status: 'connected' } });
    open = vi.fn();
    window.addEventListener('tuzi-assistant-open-creative-settings', open);
  });
  afterEach(() => {
    window.removeEventListener('tuzi-assistant-open-creative-settings', open);
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it.each(['image', 'video', 'audio', 'text'] as const)('opens existing settings for unconfigured %s', type => {
    mocks.route.mockReturnValue({ baseUrl: 'https://synthetic.invalid', apiKey: '', modelId: 'model' });
    expect(ensureAssistantCreationConfigured(type)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('allows configured manual providers', () => {
    expect(ensureAssistantCreationConfigured('image')).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
  it('requires a usable model binding and the selected provider', () => {
    mocks.plan.mockReturnValueOnce(null);
    expect(ensureAssistantCreationConfigured('text')).toBe(false);
    expect(ensureAssistantCreationConfigured('text', { profileId: 'deleted', modelId: 'model' })).toBe(false);
  });
  it('accepts connected account references and blocks disconnected accounts', () => {
    mocks.route.mockReturnValue({ baseUrl: 'https://synthetic.invalid', apiKey: 'tuzi-account:synthetic', modelId: 'model' });
    expect(ensureAssistantCreationConfigured('image')).toBe(true);
    mocks.account.mockReturnValue({ state: { status: 'disconnected' } });
    expect(ensureAssistantCreationConfigured('image')).toBe(false);
  });
  it('local Codex bypasses only text configuration', () => {
    mocks.plan.mockReturnValue(null);
    expect(ensureAssistantCreationConfigured('text', null, true)).toBe(true);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(ensureAssistantCreationConfigured('image', null, true)).toBe(false);
  });
  it('preserves standalone upstream behavior', () => {
    vi.stubEnv('VITE_TUZI_ASSISTANT', 'false');
    expect(ensureAssistantCreationConfigured('image')).toBe(true);
    expect(mocks.route).not.toHaveBeenCalled();
  });
});
