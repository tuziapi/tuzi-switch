import React from 'react';
import { Music4 } from 'lucide-react';
import { AudioTrackList, type AudioTrackListItem } from '../../../components/shared/AudioTrackList';
import type { AudioPlaylistItemRef } from '../../../types/audio-playlist.types';

interface MusicPlayerQueueListProps {
  showPlaybackQueue: boolean;
  queueListItems: AudioTrackListItem[];
  listItems: AudioTrackListItem[];
  emptyLabel: string;
  onPlayQueueItem: (itemId: string) => void;
  onPlayListItem: (item: AudioTrackListItem) => void;
  onContextMenu: (item: AudioPlaylistItemRef, x: number, y: number) => void;
  onToggleFavorite: (assetId: string) => void;
  onOpenKnowledgeBase: (noteId: string) => void;
}

export const MusicPlayerQueueList: React.FC<MusicPlayerQueueListProps> = ({
  showPlaybackQueue,
  queueListItems,
  listItems,
  emptyLabel,
  onPlayQueueItem,
  onPlayListItem,
  onContextMenu,
  onToggleFavorite,
  onOpenKnowledgeBase,
}) => {
  if (showPlaybackQueue) {
    return (
      <AudioTrackList
        className="audio-track-list--queue"
        items={queueListItems}
        onSelect={(item) => onPlayQueueItem(item.id)}
        onContextMenu={(item, event) => {
          if (!item.playlistItemRef) return;
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(item.playlistItemRef, event.clientX, event.clientY);
        }}
        onToggleFavorite={(item) => {
          if (item.assetId) {
            onToggleFavorite(item.assetId);
          }
        }}
        onTogglePlayback={(item) => onPlayQueueItem(item.id)}
        onOpenKnowledgeBase={onOpenKnowledgeBase}
        showFavoriteButton
        showPlaybackIndicator
      />
    );
  }

  if (listItems.length === 0) {
    return (
      <div className="music-player-tool__empty">
        <Music4 size={18} />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <AudioTrackList
      items={listItems}
      onSelect={onPlayListItem}
      onContextMenu={(item, event) => {
        if (!item.playlistItemRef) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(item.playlistItemRef, event.clientX, event.clientY);
      }}
      onToggleFavorite={(item) => {
        if (item.assetId) {
          onToggleFavorite(item.assetId);
        }
      }}
      onTogglePlayback={onPlayListItem}
      onOpenKnowledgeBase={onOpenKnowledgeBase}
      showFavoriteButton
      showPlaybackIndicator
    />
  );
};
