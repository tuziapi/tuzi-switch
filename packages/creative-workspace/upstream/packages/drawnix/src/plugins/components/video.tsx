import React, { useRef, useEffect, useState } from 'react';
import classNames from 'classnames';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import { Play } from 'lucide-react';
import { RetryImage } from '../../components/retry-image';

export interface VideoItem {
  url: string;
  width?: number;
  height?: number;
  poster?: string;
  videoType?: string;
}

export interface VideoProps {
  videoItem: VideoItem;
  isFocus?: boolean;
  isSelected?: boolean;
  readonly?: boolean;
  visible?: boolean;
}

export const Video: React.FC<VideoProps> = (props) => {
  // A new source needs a fresh player, including its loading/error state.
  const url = props.videoItem.url?.replace('#video', '') || '';
  const [playingSource, setPlayingSource] = useState<string>();
  const [activatedSource, setActivatedSource] = useState<string>();
  return props.visible === false && playingSource !== url && activatedSource !== url ? (
    <div style={{ width: '100%', height: '100%', background: '#000' }} />
  ) : (
    <VideoPlayer key={url} {...props} url={url}
      onActivated={(active) => setActivatedSource((current) =>
        active ? url : current === url ? undefined : current)}
      onPlaybackChange={(playing) => {
        setPlayingSource((current) => playing ? url : current === url ? undefined : current);
        if (!playing) setActivatedSource((current) => current === url ? undefined : current);
      }} />
  );
};

const VideoPlayer: React.FC<VideoProps & {
  url: string;
  onActivated: (active: boolean) => void;
  onPlaybackChange: (playing: boolean) => void;
}> = (props) => {
  const {
    videoItem,
    url,
    isFocus = false,
    isSelected = false,
    readonly = false,
  } = props;
  const { poster } = videoItem;
  const [activated, setActivated] = useState(!poster);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playOnLoad = useRef(false);
  const fallbackBlobUrlRef = useRef<string | null>(null);
  const fallbackAttemptedRef = useRef(false);
  const fallbackPendingRef = useRef(false);
  const loadAttemptRef = useRef(0);
  const [videoError, setVideoError] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(url));
  const [playbackUrl, setPlaybackUrl] = useState(url);
  const [playing, setPlaying] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);

  useEffect(() => {
    if (videoRef.current && !videoRef.current.getAttribute('src')) videoRef.current.src = url;
    return () => {
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {
          // Continue releasing owned URLs even if the media element is detached.
        }
      }
      // Ignore pending cache reads after this source is removed.
      loadAttemptRef.current += 1;
      if (fallbackBlobUrlRef.current) {
        URL.revokeObjectURL(fallbackBlobUrlRef.current);
        fallbackBlobUrlRef.current = null;
      }
    };
  }, [url]);

  const handleVideoError = async () => {
    if (fallbackPendingRef.current) return;
    const attempt = loadAttemptRef.current;
    if (isVirtualMediaUrl(url) && !fallbackAttemptedRef.current) {
      fallbackAttemptedRef.current = true;
      fallbackPendingRef.current = true;
      setIsLoading(true);
      try {
        const { unifiedCacheService } = await import(
          '../../services/unified-cache-service'
        );
        if (attempt !== loadAttemptRef.current) return;
        const cachedBlob = await unifiedCacheService.getCachedBlob(url, {
          allowNetwork: false,
        });
        if (attempt !== loadAttemptRef.current) return;
        if (cachedBlob?.size) {
          const blobUrl = URL.createObjectURL(cachedBlob);
          fallbackBlobUrlRef.current = blobUrl;
          setPlaybackUrl(blobUrl);
          return;
        }
      } catch {
        // Cache failures use the same visible error as a failed media request.
      } finally {
        fallbackPendingRef.current = false;
      }
    }
    if (attempt === loadAttemptRef.current) {
      setIsLoading(false);
      setVideoError(true);
      props.onActivated(false);
    }
  };

  const stopCanvasPropagation = (e: React.SyntheticEvent) => {
    if (readonly) {
      e.stopPropagation();
    }
  };

  const handleVideoClick = (e: React.MouseEvent) => {
    if (readonly) {
      e.stopPropagation();
      // 在只读模式下，点击视频在新窗口打开
      e.preventDefault();
      window.open(playbackUrl, '_blank');
    }
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    borderRadius: '4px',
    overflow: 'hidden',
  };

  const dragSurface = !readonly && (
    <div data-canvas-media-drag="true" title="拖动画面移动视频，下方控件播放"
      style={{ position: 'absolute', inset: '0 0 44px', zIndex: 2, cursor: 'move', touchAction: 'none' }} />
  );

  if (!activated && poster) {
    return (
      <div style={containerStyle}>
        <RetryImage src={poster} alt="" showSkeleton={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        {!readonly && <div data-canvas-media-drag="true" title="拖动画面移动视频"
          style={{ position: 'absolute', inset: 0, cursor: 'move', touchAction: 'none' }} />}
        <button type="button" aria-label="播放视频" data-slideshow-media-control="true"
          onPointerDown={event => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (readonly) window.open(url, '_blank');
            else { playOnLoad.current = true; props.onActivated(true); setActivated(true); }
          }}
          style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 48, height: 48, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,.55)',
            display: 'grid', placeItems: 'center', color: '#fff', cursor: 'pointer' }}>
          <Play size={25} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (videoError) {
    return (
      <div
        style={containerStyle}
        data-slideshow-media-control="true"
        onClick={handleVideoClick}
        onPointerDown={stopCanvasPropagation}
        onPointerUp={stopCanvasPropagation}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#666',
          backgroundColor: '#f5f5f5',
          cursor: readonly ? 'pointer' : 'default',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>🎬</div>
          <div style={{ fontSize: '14px', textAlign: 'center', padding: '0 16px' }}>
            Video failed to load
          </div>
          {readonly && (
            <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
              Click to open in new window
            </div>
          )}
        </div>
        {dragSurface}
      </div>
    );
  }

  return (
    <div
      style={containerStyle}
      data-slideshow-media-control="true"
      onClick={handleVideoClick}
      onPointerDown={stopCanvasPropagation}
      onPointerUp={stopCanvasPropagation}
    >
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          zIndex: 1,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            <div style={{ fontSize: '14px' }}>Loading video...</div>
          </div>
        </div>
      )}
      <video
        ref={(video) => { if (video) videoRef.current = video; }}
        data-slideshow-media-control="true"
        src={playbackUrl || undefined}
        poster={poster}
        width="100%"
        height="100%"
        controls={!readonly}
        muted
        playsInline
        preload="metadata"
        draggable={false}
        className={classNames('video-origin', {
          'video-origin--focus': isFocus,
          'video-origin--selected': isSelected,
        })}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        onPointerDown={stopCanvasPropagation}
        onPointerUp={stopCanvasPropagation}
        onLoadedData={() => {
          setIsLoading(false);
          setVideoError(false);
          if (playOnLoad.current) {
            playOnLoad.current = false;
            const attempt = loadAttemptRef.current;
            void videoRef.current?.play().catch(() => {
              if (attempt === loadAttemptRef.current) props.onActivated(false);
            });
          } else {
            props.onActivated(false);
          }
        }}
        onLoadedMetadata={() => setIsLoading(false)}
        onPlay={() => { setPlaying(true); setPlayFailed(false); props.onPlaybackChange(true); }}
        onPause={() => { setPlaying(false); props.onPlaybackChange(false); }}
        onEnded={() => { setPlaying(false); props.onPlaybackChange(false); }}
        onError={handleVideoError}
      />
      {dragSurface}
      {!readonly && !playing && (
        <button type="button" aria-label={playFailed ? '重试播放视频' : '播放视频'}
          data-slideshow-media-control="true"
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            playOnLoad.current = true;
            props.onActivated(true);
            setPlayFailed(false);
            const attempt = loadAttemptRef.current;
            void videoRef.current?.play().then(() => {
              if (attempt === loadAttemptRef.current) playOnLoad.current = false;
            }).catch(() => {
              if (attempt === loadAttemptRef.current) setPlayFailed(true);
            });
          }}
          style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 3, width: 52, height: 52, borderRadius: '50%', border: 0,
            background: 'rgba(0,0,0,.65)', display: 'grid', placeItems: 'center', color: '#fff', cursor: 'pointer' }}>
          <Play size={27} aria-hidden="true" />
        </button>
      )}
      {readonly && (
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          pointerEvents: 'none',
        }}>
          🎬 Video
        </div>
      )}
    </div>
  );
};
