import React, { useMemo } from 'react';
import { BookOpen, Heart, ListMusic, Pencil, Plus, Trash2 } from 'lucide-react';
import classNames from 'classnames';
import type { AudioPlaylist, AudioPlaylistItem } from '../../types/audio-playlist.types';
import {
  AUDIO_PLAYLIST_ALL_ID,
  AUDIO_PLAYLIST_ALL_TRACKS_ID,
  AUDIO_PLAYLIST_FAVORITES_ID,
} from '../../types/audio-playlist.types';
import {
  ContextMenu,
  useContextMenuState,
  type ContextMenuEntry,
} from './ContextMenu';
import './audio-playlist-tabs.scss';

interface AudioPlaylistTabsProps {
  className?: string;
  selectedPlaylistId: string;
  allCount: number;
  allTracksCount?: number;
  allTracksLabel?: string;
  tempTabs?: Array<{
    id: string;
    label: string;
    count: number;
    type: 'audio' | 'reading';
  }>;
  playlists: AudioPlaylist[];
  playlistItems: Record<string, AudioPlaylistItem[]>;
  onSelect: (playlistId: string) => void;
  onCreate: () => void;
  onRename?: (playlist: AudioPlaylist) => void;
  onDelete?: (playlist: AudioPlaylist) => void;
  allLabel?: string;
  createLabel?: string;
}

export const AudioPlaylistTabs: React.FC<AudioPlaylistTabsProps> = ({
  className,
  selectedPlaylistId,
  allCount,
  allTracksCount,
  allTracksLabel = '全部语音',
  tempTabs = [],
  playlists,
  playlistItems,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  allLabel = '全部音频',
  createLabel = '新建播放列表',
}) => {
  const { contextMenu, open, close } = useContextMenuState<AudioPlaylist>();

  const manageable = useMemo(
    () => typeof onRename === 'function' || typeof onDelete === 'function',
    [onDelete, onRename]
  );

  const menuItems = useMemo<ContextMenuEntry<AudioPlaylist>[]>(
    () => [
      {
        key: 'create',
        label: '新建播放列表',
        icon: <Plus size={14} />,
        onSelect: () => onCreate(),
      },
      {
        key: 'rename',
        label: '重命名',
        icon: <Pencil size={14} />,
        disabled: (playlist) => playlist.isSystem || !onRename,
        onSelect: (playlist) => onRename?.(playlist),
      },
      {
        key: 'delete',
        label: '删除播放列表',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: (playlist) => playlist.isSystem || !onDelete,
        onSelect: (playlist) => onDelete?.(playlist),
      },
    ],
    [onCreate, onDelete, onRename]
  );

  const favoritesPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === AUDIO_PLAYLIST_FAVORITES_ID) || null,
    [playlists]
  );
  const customPlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.id !== AUDIO_PLAYLIST_FAVORITES_ID),
    [playlists]
  );

  return (
    <>
      <div className={classNames('audio-playlist-tabs', className)}>
        <button
          type="button"
          className={classNames('audio-playlist-tabs__chip', {
            'audio-playlist-tabs__chip--active': selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID,
          })}
          onClick={() => onSelect(AUDIO_PLAYLIST_ALL_ID)}
          onContextMenu={
            manageable
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  open(event, {
                    id: AUDIO_PLAYLIST_ALL_ID,
                    name: allLabel,
                    createdAt: 0,
                    updatedAt: 0,
                    isSystem: true,
                  });
                }
              : undefined
          }
        >
          <ListMusic size={14} />
          <span>{allLabel}</span>
          <span className="audio-playlist-tabs__count">{allCount}</span>
        </button>

        {typeof allTracksCount === 'number' ? (
          <button
            type="button"
            className={classNames('audio-playlist-tabs__chip', {
              'audio-playlist-tabs__chip--active': selectedPlaylistId === AUDIO_PLAYLIST_ALL_TRACKS_ID,
            })}
            onClick={() => onSelect(AUDIO_PLAYLIST_ALL_TRACKS_ID)}
          >
            <BookOpen size={14} />
            <span>{allTracksLabel}</span>
            <span className="audio-playlist-tabs__count">{allTracksCount}</span>
          </button>
        ) : null}

        {favoritesPlaylist ? (
          <button
            type="button"
            className={classNames('audio-playlist-tabs__chip', {
              'audio-playlist-tabs__chip--active': selectedPlaylistId === favoritesPlaylist.id,
            })}
            onClick={() => onSelect(favoritesPlaylist.id)}
            onContextMenu={
              manageable
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    open(event, favoritesPlaylist);
                  }
                : undefined
            }
          >
            <Heart size={14} />
            <span>{favoritesPlaylist.name}</span>
            <span className="audio-playlist-tabs__count">{(playlistItems[favoritesPlaylist.id] || []).length}</span>
          </button>
        ) : null}

        {tempTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={classNames('audio-playlist-tabs__chip', {
              'audio-playlist-tabs__chip--active': selectedPlaylistId === tab.id,
            })}
            onClick={() => onSelect(tab.id)}
          >
            {tab.type === 'reading' ? <BookOpen size={14} /> : <ListMusic size={14} />}
            <span>{tab.label}</span>
            <span className="audio-playlist-tabs__count">{tab.count}</span>
          </button>
        ))}

        {customPlaylists.map((playlist) => {
          const playlistCount = (playlistItems[playlist.id] || []).length;
          const isManageable = manageable;

          return (
            <button
              key={playlist.id}
              type="button"
              className={classNames('audio-playlist-tabs__chip', {
                'audio-playlist-tabs__chip--active': selectedPlaylistId === playlist.id,
              })}
              onClick={() => onSelect(playlist.id)}
              onContextMenu={
                isManageable
                  ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    open(event, playlist);
                  }
                  : undefined
              }
            >
              <ListMusic size={14} />
              <span>{playlist.name}</span>
              <span className="audio-playlist-tabs__count">{playlistCount}</span>
            </button>
          );
        })}

        <button
          type="button"
          className="audio-playlist-tabs__create"
          onClick={onCreate}
        >
          <Plus size={14} />
          <span>{createLabel}</span>
        </button>
      </div>

      <ContextMenu state={contextMenu} items={menuItems} onClose={close} />
    </>
  );
};
