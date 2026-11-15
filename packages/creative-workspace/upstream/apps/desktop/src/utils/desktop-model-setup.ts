import { isTauriEnvironment } from './tauri-api';

/** Initialize the standalone desktop canvas credentials when needed. */
export async function initializeDesktopModelSetup(): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { settingsManager, providerProfilesSettings } = await import('../../../../packages/drawnix/src/utils/settings-manager');
  await settingsManager.waitForInitialization();
  if (providerProfilesSettings.get().some(profile => profile.enabled && profile.apiKey.trim())) return;
  const { promptForApiKey } = await import('../../../../packages/drawnix/src/utils/gemini-api/auth');
  await promptForApiKey();
}
