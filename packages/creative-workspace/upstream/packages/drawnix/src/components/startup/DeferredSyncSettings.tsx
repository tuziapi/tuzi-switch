import React from 'react';
import { GitHubSyncProvider } from '../../contexts/GitHubSyncContext';
import { SyncSettings } from '../sync-settings/SyncSettings';

type SyncSettingsProps = React.ComponentProps<typeof SyncSettings>;

export function DeferredSyncSettings(props: SyncSettingsProps) {
  return (
    <GitHubSyncProvider>
      <SyncSettings {...props} />
    </GitHubSyncProvider>
  );
}

export default DeferredSyncSettings;
