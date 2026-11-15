import React from 'react';
import {
  ModelDropdown,
  type ModelDropdownProps,
} from '../../ai-input-bar/ModelDropdown';

export interface VideoDurationOption {
  label: string;
  value: number | string;
}

export interface VideoParametersRowProps {
  selectedModel: string;
  selectedSelectionKey?: string | null;
  onSelectModel: ModelDropdownProps['onSelect'];
  models: ModelDropdownProps['models'];
  segmentDuration: number;
  durationOptions: VideoDurationOption[];
  onSegmentDurationChange: (value: number) => void;
  disabled?: boolean;
  placement?: ModelDropdownProps['placement'];
  placeholder?: string;
  title?: string;
  modelLabel?: string;
  segmentLabel?: string;
  targetDuration?: number;
  targetDurationLabel?: string;
  onTargetDurationChange?: (value: number) => void;
  targetDurationMin?: number;
  targetDurationMax?: number;
  overflowText?: React.ReactNode;
  className?: string;
}

export const VideoParametersRow: React.FC<VideoParametersRowProps> = ({
  selectedModel,
  selectedSelectionKey,
  onSelectModel,
  models,
  segmentDuration,
  durationOptions,
  onSegmentDurationChange,
  disabled = false,
  placement = 'auto',
  placeholder = '选择视频模型',
  title = '视频参数',
  modelLabel = '视频模型',
  segmentLabel = '单段',
  targetDuration,
  targetDurationLabel = '目标时长',
  onTargetDurationChange,
  targetDurationMin = 5,
  targetDurationMax = 300,
  overflowText,
  className = '',
}) => (
  <div className={`va-video-parameters-row ${className}`}>
    <div className="va-section-header">
      <span className="va-section-title">{title}</span>
    </div>
    <div className="va-model-select va-video-parameters-row__controls">
      <label className="va-model-label">{modelLabel}</label>
      <ModelDropdown
        variant="form"
        selectedModel={selectedModel}
        selectedSelectionKey={selectedSelectionKey}
        onSelect={onSelectModel}
        models={models}
        placement={placement}
        disabled={disabled}
        placeholder={placeholder}
      />
      {onTargetDurationChange && targetDuration != null && (
        <div className="va-target-duration-input">
          <label className="va-model-label">{targetDurationLabel}</label>
          <input
            className="va-form-input"
            type="number"
            min={targetDurationMin}
            max={targetDurationMax}
            value={targetDuration}
            onChange={(event) => {
              const value = Number(event.target.value);
              onTargetDurationChange(Number.isFinite(value) ? value : 0);
            }}
            disabled={disabled}
          />
        </div>
      )}
      <div className="va-segment-duration-select">
        <label className="va-model-label">{segmentLabel}</label>
        <select
          className="va-form-select"
          value={String(segmentDuration)}
          onChange={(event) =>
            onSegmentDurationChange(parseInt(event.target.value, 10))
          }
          disabled={disabled || durationOptions.length <= 1}
        >
          {durationOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {overflowText && (
        <span className="va-duration-overflow">{overflowText}</span>
      )}
    </div>
  </div>
);
