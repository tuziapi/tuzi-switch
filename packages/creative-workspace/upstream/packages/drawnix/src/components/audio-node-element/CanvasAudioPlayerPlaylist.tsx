import React, { useCallback, useMemo, useState } from 'react';
import { Dialog, Input } from 'tdesign-react';
import { Music4 } from 'lucide-react';
import { AudioTrackList } from '../shared/AudioTrackList';
import { AudioTrackContextMenu } from '../shared/AudioTrackContextMenu';
import { AudioPlaylistTabs } from '../shared/AudioPlaylistTabs';
import { useContextMenuState } from '../shared/ContextMenu';
import { useAssets } from '../../contexts/AssetContext';
import { useResolvedAudioDurations } from '../../hooks/useResolvedAudioDurations';
import { useAllTracksPlaybackSources } from '../../hooks/useAllTracksPlaybackSources';
import { AssetType } from '../../types/asset.types';
import { useAudioPlaylists } from '../../contexts/AudioPlaylistContext';
import {
  AUDIO_PLAYLIST_ALL_ID,
  AUDIO_PLAYLIST_ALL_TRACKS_ID,
  getAudioPlaylistItemRefKey,
  type AudioPlaylistItemRef,
} from '../../types/audio-playlist.types';
import {
  isReadingPlaybackSource,
  type CanvasAudioPlaybackSource,
  type CanvasAudioQueueSource,
  type PlaybackQueueItem,
} from '../../services/canvas-audio-playback-service';
import type { ReadingPlaybackSource } from '../../services/reading-playback-source';

interface CanvasAudioPlayerPlaylistProps {
  queue: PlaybackQueueItem[];
  activeQueueIndex: number;
  queueSource: CanvasAudioQueueSource;
  activePlaylistId?: string;
  playing?: boolean;
  activeReadingSourceId?: string;
  onSelect: (item: PlaybackQueueItem) => void;
  onPlayAllTracksItem?: (noteId: string) => void;
}

const ASSET_ELEMENT_ID_PREFIX = 'asset:';

function getAssetIdFromSource(item?: CanvasAudioPlaybackSource): string | null {
  if (!item?.elementId?.startsWith(ASSET_ELEMENT_ID_PREFIX)) {
    return null;
  }

  return item.elementId.slice(ASSET_ELEMENT_ID_PREFIX.length);
}

function formatDuration(duration?: number): string {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatReadingDuration(source: ReadingPlaybackSource): string {
  const totalDurationMs = source.segments[source.segments.length - 1]?.endMs || 0;
  return formatDuration(totalDurationMs / 1000);
}

export const CanvasAudioPlayerPlaylist: React.FC<CanvasAudioPlayerPlaylistProps> = ({
  queue,
  activeQueueIndex,
  queueSource,
  activePlaylistId,
  playing = false,
  activeReadingSourceId,
  onSelect,
  onPlayAllTracksItem,
}) => {
  const { assets } = useAssets();
  const {
    playlists,
    playlistItems,
    favoriteAssetIds,
    createPlaylist,
    addAssetToPlaylist,
    removeAssetFromPlaylist,
    toggleFavorite,
  } = useAudioPlaylists();
  const {
    contextMenu,
    openAt: openContextMenuAt,
    close: closeContextMenu,
  } = useContextMenuState<AudioPlaylistItemRef>();
  const [createDialogVisible, setCreateDialogVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);
  const { noteMetas, loadReadingSource, buildReadingQueue } = useAllTracksPlaybackSources();
  const [selectedTabId, setSelectedTabId] = useState<string>(
    queueSource === 'reading' ? AUDIO_PLAYLIST_ALL_TRACKS_ID : AUDIO_PLAYLIST_ALL_ID
  );
  const isAllTracksTab = selectedTabId === AUDIO_PLAYLIST_ALL_TRACKS_ID;

  const selectedPlaylistId =
    queueSource === 'playlist' && activePlaylistId ? activePlaylistId : AUDIO_PLAYLIST_ALL_ID;
  const audioQueue = queue.filter((item): item is CanvasAudioPlaybackSource => !isReadingPlaybackSource(item));
  const resolvedDurations = useResolvedAudioDurations(audioQueue);
  const resolveAssetId = (item?: CanvasAudioPlaybackSource): string | null => {
    const directAssetId = getAssetIdFromSource(item);
    if (directAssetId) {
      return directAssetId;
    }

    if (!item?.audioUrl) {
      return null;
    }

    const matchedAsset = assets.find(
      (asset) => asset.type === AssetType.AUDIO && asset.url === item.audioUrl
    );
    return matchedAsset?.id || null;
  };
  const currentPlaylistItemKeys = useMemo(
    () => new Set(
      selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID
        ? (playlistItems[selectedPlaylistId] || [])
          .map((item) => item.assetId ? getAudioPlaylistItemRefKey({ kind: 'asset', assetId: item.assetId }) : null)
          .filter((item): item is string => !!item)
        : []
    ),
    [playlistItems, selectedPlaylistId]
  );
  const handlePlayAllTracksItem = useCallback(
    async (noteId: string) => {
      if (onPlayAllTracksItem) {
        onPlayAllTracksItem(noteId);
        return;
      }
      const source = await loadReadingSource(noteId);
      if (!source) return;
      const fullQueue = await buildReadingQueue(noteId);
      // 通过 onSelect 传递给父组件处理
      onSelect(source);
    },
    [onPlayAllTracksItem, loadReadingSource, buildReadingQueue, onSelect]
  );

  const allTracksListItems = useMemo(
    () =>
      noteMetas.map((meta) => ({
        id: meta.id,
        title: meta.title || '未命名笔记',
        subtitle: new Date(meta.updatedAt).toLocaleDateString('zh-CN'),
        canFavorite: false,
        isActive: activeReadingSourceId?.includes(meta.id) === true,
        isPlaying: playing && activeReadingSourceId?.includes(meta.id) === true,
      })),
    [noteMetas, activeReadingSourceId, playing]
  );

  if (queueSource === 'reading') {
    return (
      <div className="canvas-audio-player__playlist">
        <AudioPlaylistTabs
          className="canvas-audio-player__playlist-tabs"
          selectedPlaylistId={selectedTabId}
          allCount={audioQueue.length}
          allTracksCount={noteMetas.length}
          playlists={playlists}
          playlistItems={playlistItems}
          onSelect={setSelectedTabId}
          onCreate={() => {
            setPlaylistName('');
            setCreateDialogVisible(true);
          }}
        />
        {isAllTracksTab ? (
          allTracksListItems.length === 0 ? (
            <div className="canvas-audio-player__playlist-empty">
              <Music4 size={16} />
              <span>知识库还没有笔记</span>
            </div>
          ) : (
            <AudioTrackList
              className="canvas-audio-player__playlist-list"
              items={allTracksListItems}
              onSelect={(item) => void handlePlayAllTracksItem(item.id)}
              onTogglePlayback={(item) => void handlePlayAllTracksItem(item.id)}
              showPlaybackIndicator
            />
          )
        ) : (
          <AudioTrackList
            className="canvas-audio-player__playlist-list audio-track-list--queue"
            items={queue.map((item, index) => {
              const readingItem = item as ReadingPlaybackSource;
              return {
                id: readingItem.readingSourceId,
                title: readingItem.title || '朗读轨道',
                subtitle: formatReadingDuration(readingItem),
                previewImageUrl: readingItem.previewImageUrl,
                isActive: index === activeQueueIndex,
                isPlaying: index === activeQueueIndex,
                canFavorite: false,
              };
            })}
            onSelect={(selectedItem) => {
              const nextItem = queue.find(
                (item) =>
                  isReadingPlaybackSource(item)
                  && item.readingSourceId === selectedItem.id
              );
              if (nextItem) {
                onSelect(nextItem);
              }
            }}
            onTogglePlayback={(selectedItem) => {
              const nextItem = queue.find(
                (item) =>
                  isReadingPlaybackSource(item)
                  && item.readingSourceId === selectedItem.id
              );
              if (nextItem) {
                onSelect(nextItem);
              }
            }}
            showPlaybackIndicator
          />
        )}
      </div>
    );
  }

  return (
    <div className="canvas-audio-player__playlist">
      <AudioPlaylistTabs
        className="canvas-audio-player__playlist-tabs"
        selectedPlaylistId={selectedTabId}
        allCount={audioQueue.length}
        allTracksCount={noteMetas.length}
        playlists={playlists}
        playlistItems={playlistItems}
        onSelect={setSelectedTabId}
        onCreate={() => {
          setPlaylistName('');
          setCreateDialogVisible(true);
        }}
      />
      {isAllTracksTab ? (
        allTracksListItems.length === 0 ? (
          <div className="canvas-audio-player__playlist-empty">
            <Music4 size={16} />
            <span>知识库还没有笔记</span>
          </div>
        ) : (
          <AudioTrackList
            className="canvas-audio-player__playlist-list"
            items={allTracksListItems}
            onSelect={(item) => void handlePlayAllTracksItem(item.id)}
            onTogglePlayback={(item) => void handlePlayAllTracksItem(item.id)}
            showPlaybackIndicator
          />
        )
      ) : (
        <AudioTrackList
        className="canvas-audio-player__playlist-list audio-track-list--queue"
        items={audioQueue.map((item, index) => {
          const assetId = resolveAssetId(item);

          return {
            id: `${item.audioUrl}-${index}`,
            title: item.title || '未命名音频',
            subtitle: formatDuration(resolvedDurations.get(item.audioUrl) ?? item.duration),
            previewImageUrl: item.previewImageUrl,
            isActive: index === activeQueueIndex,
            isPlaying: index === activeQueueIndex,
            isFavorite: assetId ? favoriteAssetIds.has(assetId) : false,
            canFavorite: !!assetId,
          };
        })}
        onSelect={(selectedItem) => {
          const nextItem = audioQueue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          if (nextItem) {
            onSelect(nextItem);
          }
        }}
        onContextMenu={(selectedItem, event) => {
          const nextItem = audioQueue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          const assetId = resolveAssetId(nextItem);
          if (!assetId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          openContextMenuAt(event.clientX, event.clientY, { kind: 'asset', assetId });
        }}
        onToggleFavorite={(selectedItem) => {
          const nextItem = audioQueue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          const assetId = resolveAssetId(nextItem);
          if (assetId) {
            void toggleFavorite(assetId);
          }
        }}
        onTogglePlayback={(selectedItem) => {
          const nextItem = audioQueue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          if (nextItem) {
            onSelect(nextItem);
          }
        }}
        showFavoriteButton
        showPlaybackIndicator
      />
      )}
      <AudioTrackContextMenu
        contextMenu={
          contextMenu
            ? {
                x: contextMenu.x,
                y: contextMenu.y,
                item: contextMenu.payload,
              }
            : null
        }
        playlists={playlists}
        playlistItems={playlistItems}
        favoriteAssetIds={favoriteAssetIds}
        selectedPlaylistId={selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID ? null : selectedPlaylistId}
        currentPlaylistItemKeys={currentPlaylistItemKeys}
        onClose={closeContextMenu}
        onToggleFavorite={(assetId) => void toggleFavorite(assetId)}
        onAddToPlaylist={(item, playlistId) => {
          if (item.kind === 'asset') {
            void addAssetToPlaylist(item.assetId, playlistId);
          }
        }}
        onRemoveFromPlaylist={(item, playlistId) => {
          if (item.kind === 'asset') {
            void removeAssetFromPlaylist(item.assetId, playlistId);
          }
        }}
        onCreatePlaylistAndAdd={(item) => {
          if (item.kind !== 'asset') {
            return;
          }
          setPendingAssetId(item.assetId);
          setPlaylistName('');
          setCreateDialogVisible(true);
        }}
      />
      <Dialog
        visible={createDialogVisible}
        header="新建播放列表"
        onClose={() => setCreateDialogVisible(false)}
        onConfirm={async () => {
          const playlist = await createPlaylist(playlistName);
          if (pendingAssetId) {
            await addAssetToPlaylist(pendingAssetId, playlist.id);
          }
          setCreateDialogVisible(false);
          setPlaylistName('');
          setPendingAssetId(null);
        }}
        onCancel={() => {
          setCreateDialogVisible(false);
          setPendingAssetId(null);
        }}
        confirmBtn="确定"
        cancelBtn="取消"
      >
        <Input
          value={playlistName}
          onChange={(value) => setPlaylistName(String(value))}
          placeholder="请输入播放列表名称"
        />
      </Dialog>
    </div>
  );
};
