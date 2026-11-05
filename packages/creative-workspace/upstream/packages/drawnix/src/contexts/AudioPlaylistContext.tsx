import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MessagePlugin } from '../utils/message-plugin';
import { audioPlaylistService } from '../services/audio-playlist-service';
import type {
  AudioPlaylist,
  AudioPlaylistContextValue,
  AudioPlaylistItem,
  AudioPlaylistItemRef,
} from '../types/audio-playlist.types';
import {
  AUDIO_PLAYLIST_FAVORITES_ID,
  getAudioPlaylistItemRef,
  isAudioPlaylistAssetItemRef,
} from '../types/audio-playlist.types';

const AudioPlaylistContext = createContext<AudioPlaylistContextValue | null>(null);

export const AudioPlaylistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(false);
  const [playlists, setPlaylists] = useState<AudioPlaylist[]>([]);
  const [playlistItems, setPlaylistItems] = useState<Record<string, AudioPlaylistItem[]>>({});

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      await audioPlaylistService.initialize();
      const [nextPlaylists, nextItems] = await Promise.all([
        audioPlaylistService.listPlaylists(),
        audioPlaylistService.listPlaylistItems(),
      ]);
      setPlaylists(nextPlaylists);
      setPlaylistItems(nextItems);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  const runAndReload = useCallback(
    async (fn: () => Promise<void>, successMessage?: string) => {
      setLoading(true);
      try {
        await fn();
        await loadPlaylists();
        if (successMessage) {
          MessagePlugin.success(successMessage);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '操作失败';
        MessagePlugin.error(message);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [loadPlaylists]
  );

  const createPlaylist = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const playlist = await audioPlaylistService.createPlaylist(name);
      await loadPlaylists();
      MessagePlugin.success('播放列表已创建');
      return playlist;
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建失败';
      MessagePlugin.error(message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [loadPlaylists]);

  const renamePlaylist = useCallback(
    async (playlistId: string, name: string) =>
      runAndReload(() => audioPlaylistService.renamePlaylist(playlistId, name), '播放列表已重命名'),
    [runAndReload]
  );

  const deletePlaylist = useCallback(
    async (playlistId: string) =>
      runAndReload(() => audioPlaylistService.deletePlaylist(playlistId), '播放列表已删除'),
    [runAndReload]
  );

  const addAssetToPlaylist = useCallback(
    async (assetId: string, playlistId: string) =>
      runAndReload(() => audioPlaylistService.addAssetToPlaylist(assetId, playlistId), '已添加到播放列表'),
    [runAndReload]
  );

  const addItemToPlaylist = useCallback(
    async (item: AudioPlaylistItemRef, playlistId: string) =>
      runAndReload(() => audioPlaylistService.addItemToPlaylist(item, playlistId), '已添加到播放列表'),
    [runAndReload]
  );

  const removeAssetFromPlaylist = useCallback(
    async (assetId: string, playlistId: string) =>
      runAndReload(() => audioPlaylistService.removeAssetFromPlaylist(assetId, playlistId), '已从播放列表移除'),
    [runAndReload]
  );

  const removeItemFromPlaylist = useCallback(
    async (item: AudioPlaylistItemRef, playlistId: string) =>
      runAndReload(() => audioPlaylistService.removeItemFromPlaylist(item, playlistId), '已从播放列表移除'),
    [runAndReload]
  );

  const removeAssetFromAllPlaylists = useCallback(
    async (assetId: string) => {
      try {
        await audioPlaylistService.removeAssetFromAllPlaylists(assetId);
        await loadPlaylists();
      } catch (error) {
        console.error('[AudioPlaylistContext] Failed to cleanup asset from playlists:', error);
      }
    },
    [loadPlaylists]
  );

  const toggleFavorite = useCallback(async (assetId: string) => {
    setLoading(true);
    try {
      const isFavorite = await audioPlaylistService.toggleFavorite(assetId);
      await loadPlaylists();
      MessagePlugin.success(isFavorite ? '已加入收藏' : '已取消收藏');
      return isFavorite;
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏操作失败';
      MessagePlugin.error(message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [loadPlaylists]);

  const favoriteAssetIds = useMemo(
    () =>
      new Set(
        (playlistItems[AUDIO_PLAYLIST_FAVORITES_ID] || [])
          .map((item) => getAudioPlaylistItemRef(item))
          .filter(isAudioPlaylistAssetItemRef)
          .map((item) => item.assetId)
      ),
    [playlistItems]
  );

  const value = useMemo<AudioPlaylistContextValue>(() => ({
    loading,
    playlists,
    playlistItems,
    favoriteAssetIds,
    loadPlaylists,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addItemToPlaylist,
    removeItemFromPlaylist,
    addAssetToPlaylist,
    removeAssetFromPlaylist,
    removeAssetFromAllPlaylists,
    toggleFavorite,
    isFavorite: (assetId: string) => favoriteAssetIds.has(assetId),
    getPlaylistAssetIds: (playlistId: string) =>
      (playlistItems[playlistId] || [])
        .map((item) => getAudioPlaylistItemRef(item))
        .filter(isAudioPlaylistAssetItemRef)
        .map((item) => item.assetId),
    getPlaylistItemRefs: (playlistId: string) =>
      (playlistItems[playlistId] || [])
        .map((item) => getAudioPlaylistItemRef(item))
        .filter((item): item is AudioPlaylistItemRef => !!item),
  }), [
    loading,
    playlists,
    playlistItems,
    favoriteAssetIds,
    loadPlaylists,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addItemToPlaylist,
    removeItemFromPlaylist,
    addAssetToPlaylist,
    removeAssetFromPlaylist,
    removeAssetFromAllPlaylists,
    toggleFavorite,
  ]);

  return (
    <AudioPlaylistContext.Provider value={value}>
      {children}
    </AudioPlaylistContext.Provider>
  );
};

export function useAudioPlaylists(): AudioPlaylistContextValue {
  const context = useContext(AudioPlaylistContext);
  if (!context) {
    throw new Error('useAudioPlaylists must be used within AudioPlaylistProvider');
  }
  return context;
}
