/**
 * 镜头卡片组件
 */

import React from 'react';
import type { VideoShot } from '../../../services/video-analysis-service';
import { RetryImage } from '../../retry-image';

const SHOT_TYPE_COLORS: Record<string, string> = {
  opening: '#3B82F6',
  product: '#F59E0B',
  detail: '#8B5CF6',
  scene: '#10B981',
  cta: '#EF4444',
  other: '#6B7280',
};

const TRANSITION_ICONS: Record<string, string> = {
  cut: '✂️',
  dissolve: '🔀',
  match_cut: '🔗',
  fade_to_black: '⬛',
};

const TRANSITION_LABELS: Record<string, string> = {
  cut: '硬切',
  dissolve: '溶解',
  match_cut: '匹配切',
  fade_to_black: '淡出',
};

export interface ShotCardProps {
  shot?: VideoShot | null;
  index: number;
  compact?: boolean;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

function getShotTypeColor(shot?: VideoShot | null): string {
  const shotType = shot?.type;
  return (shotType && SHOT_TYPE_COLORS[shotType]) || SHOT_TYPE_COLORS.other;
}

export const ShotCard: React.FC<ShotCardProps> = ({
  shot,
  index,
  compact,
  actions,
  children,
}) => {
  if (!shot) {
    return null;
  }

  return (
    <div className="va-shot-card">
      {!actions && !compact && shot.generated_first_frame_url && (
      <div className="va-shot-frame-row">
        <RetryImage
          src={shot.generated_first_frame_url}
          alt="首帧"
          className="va-shot-frame-img"
          showSkeleton={false}
          eager
        />
      </div>
    )}
    <div className="va-shot-header">
      <span
        className="va-shot-badge"
        style={{ backgroundColor: getShotTypeColor(shot) }}
      >
        {shot.label || '未命名镜头'}
      </span>
      <span className="va-shot-time">
        #{index + 1} · {shot.startTime ?? 0}s - {shot.endTime ?? 0}s
      </span>
      {shot.transition_hint && (
        <span className="va-shot-transition">
          {TRANSITION_ICONS[shot.transition_hint] || '→'}{' '}
          {TRANSITION_LABELS[shot.transition_hint] || shot.transition_hint}
        </span>
      )}
      {shot.character_ids && shot.character_ids.length > 0 && (
        <span className="va-shot-characters">{shot.character_ids.join(', ')}</span>
      )}
    </div>
    {!compact && (
      <>
        <p className="va-shot-desc">{shot.description}</p>
        {shot.narration && <p className="va-shot-script">旁白: "{shot.narration}"</p>}
        {shot.dialogue && <p className="va-shot-script">对白: "{shot.dialogue}"</p>}
        {shot.dialogue_speakers && (
          <p className="va-shot-camera">对白角色: {shot.dialogue_speakers}</p>
        )}
        {shot.speech_relation && (
          <p className="va-shot-camera">语音关系: {shot.speech_relation}</p>
        )}
        {shot.camera_movement && (
          <p className="va-shot-camera">运镜: {shot.camera_movement}</p>
        )}
        {shot.first_frame_prompt && (
          <p className="va-shot-prompt">首帧 Prompt: {shot.first_frame_prompt}</p>
        )}
        {shot.last_frame_prompt && (
          <p className="va-shot-prompt">尾帧 Prompt: {shot.last_frame_prompt}</p>
        )}
      </>
    )}
    {children}
    {actions && <div className="va-shot-actions">{actions}</div>}
  </div>
  );
};
