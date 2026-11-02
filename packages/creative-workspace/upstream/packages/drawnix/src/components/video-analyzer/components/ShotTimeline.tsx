/**
 * 镜头时间线组件
 */

import React from 'react';
import type { VideoShot } from '../types';
import { SHOT_TYPE_COLORS } from '../types';
import { HoverTip } from '../../shared/hover';

interface ShotTimelineProps {
  shots: VideoShot[];
  totalDuration: number;
}

export const ShotTimeline: React.FC<ShotTimelineProps> = ({ shots, totalDuration }) => (
  <div className="va-timeline">
    {shots.filter(Boolean).map((shot) => (
      <HoverTip
        key={shot.id}
        content={`${shot.label || '未命名镜头'} ${shot.startTime ?? 0}s-${shot.endTime ?? 0}s`}
        showArrow={false}
      >
        <div
          className="va-timeline-segment"
          style={{
            flex: Math.max(((shot.endTime ?? 0) - (shot.startTime ?? 0)) / Math.max(totalDuration, 1), 0),
            backgroundColor:
              (shot.type && SHOT_TYPE_COLORS[shot.type]) || SHOT_TYPE_COLORS.other,
          }}
        />
      </HoverTip>
    ))}
  </div>
);
