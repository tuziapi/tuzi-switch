import React from 'react';
import classNames from 'classnames';
import './image-generation-progress-display.scss';

export type ImageGenerationProgressMode =
  | 'determinate'
  | 'indeterminate'
  | 'hidden';

export type ImageGenerationProgressTone =
  | 'default'
  | 'loading'
  | 'danger'
  | 'success';

export interface ImageGenerationProgressDisplayProps {
  progress?: number | null;
  progressMode: ImageGenerationProgressMode;
  statusText?: string;
  tone?: ImageGenerationProgressTone;
  className?: string;
  compact?: boolean;
  showRing?: boolean;
}

function clampProgress(progress?: number | null): number {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(progress)));
}

export const ImageGenerationProgressDisplay: React.FC<
  ImageGenerationProgressDisplayProps
> = ({
  progress,
  progressMode,
  statusText,
  tone = 'default',
  className,
  compact = false,
  showRing,
}) => {
  const normalizedProgress = clampProgress(progress);
  const isDeterminate = progressMode === 'determinate';
  const shouldShowRing =
    showRing ?? (progressMode !== 'hidden' || tone === 'danger');
  const circumference = 2 * Math.PI * 42;
  const offset = circumference * (1 - normalizedProgress / 100);

  return (
    <div
      className={classNames(
        'image-generation-progress-display',
        `image-generation-progress-display--${tone}`,
        `image-generation-progress-display--${progressMode}`,
        {
          'image-generation-progress-display--compact': compact,
          'image-generation-progress-display--no-ring': !shouldShowRing,
        },
        className
      )}
    >
      {shouldShowRing ? (
        isDeterminate ? (
          <div className="image-generation-progress-display__ring">
            <svg
              viewBox="0 0 100 100"
              className="image-generation-progress-display__ring-svg"
            >
              <circle
                className="image-generation-progress-display__ring-bg"
                cx="50"
                cy="50"
                r="42"
                fill="none"
                strokeWidth="6"
              />
              <circle
                className="image-generation-progress-display__ring-progress"
                cx="50"
                cy="50"
                r="42"
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                style={{
                  strokeDasharray: `${circumference}`,
                  strokeDashoffset: `${offset}`,
                }}
              />
            </svg>
            <div className="image-generation-progress-display__percentage">
              {normalizedProgress}%
            </div>
          </div>
        ) : (
          <div className="image-generation-progress-display__ring image-generation-progress-display__ring--pulse">
            <span className="image-generation-progress-display__pulse" />
          </div>
        )
      ) : null}
      {statusText ? (
        <div className="image-generation-progress-display__status">
          {statusText}
        </div>
      ) : null}
    </div>
  );
};

export default ImageGenerationProgressDisplay;
