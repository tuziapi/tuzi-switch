import React from 'react';
import classNames from 'classnames';
import './audio-playlist-chip.scss';

interface AudioPlaylistChipProps {
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  badgeClassName?: string;
  disabled?: boolean;
}

export const AudioPlaylistChip: React.FC<AudioPlaylistChipProps> = ({
  label,
  icon,
  count,
  active = false,
  onClick,
  onContextMenu,
  className,
  badgeClassName,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      className={classNames('audio-playlist-chip', className, {
        'audio-playlist-chip--active': active,
      })}
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
    >
      {icon ? <span className="audio-playlist-chip__icon">{icon}</span> : null}
      <span className="audio-playlist-chip__label">{label}</span>
      {typeof count === 'number' ? (
        <span className={classNames('audio-playlist-chip__count', badgeClassName)}>
          {count}
        </span>
      ) : null}
    </button>
  );
};
