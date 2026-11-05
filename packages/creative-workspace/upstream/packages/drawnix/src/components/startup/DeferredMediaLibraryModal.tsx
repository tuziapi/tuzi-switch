import React from 'react';
import { GitHubSyncProvider } from '../../contexts/GitHubSyncContext';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';

type MediaLibraryModalProps = React.ComponentProps<typeof MediaLibraryModal>;

export function DeferredMediaLibraryModal(props: MediaLibraryModalProps) {
  return (
    <GitHubSyncProvider>
      <MediaLibraryModal {...props} />
    </GitHubSyncProvider>
  );
}

export default DeferredMediaLibraryModal;
