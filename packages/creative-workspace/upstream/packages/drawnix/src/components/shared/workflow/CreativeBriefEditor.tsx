import React, { useState, useCallback, useMemo } from 'react';
import { ComboInput } from './ComboInput';
import {
  AUDIENCE_OPTIONS,
  PACING_OPTIONS,
  TARGET_PLATFORM_OPTIONS,
  getCreativeBriefPresetOptions,
  type CreativeBrief,
  type CreativeBriefWorkflow,
} from './creative-brief';
import {
  VISUAL_STYLE_OPTIONS,
  VISUAL_STYLE_PLACEHOLDER,
} from './style-presets';

export interface CreativeBriefEditorProps {
  value?: CreativeBrief | null;
  onChange: (value: CreativeBrief) => void;
  workflow?: CreativeBriefWorkflow;
  videoStyle?: string;
  onVideoStyleChange?: (value: string) => void;
}

export const CreativeBriefEditor: React.FC<CreativeBriefEditorProps> = ({
  value,
  onChange,
  workflow = 'popular_video',
  videoStyle,
  onVideoStyleChange,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const brief = useMemo(() => value || {}, [value]);
  const {
    purposeOptions,
    directorStyleOptions,
    narrativeStyleOptions,
  } = useMemo(() => getCreativeBriefPresetOptions(workflow), [workflow]);

  const updateField = useCallback(
    (field: keyof CreativeBrief, nextValue: string) => {
      onChange({
        ...brief,
        [field]: nextValue,
      });
    },
    [brief, onChange]
  );

  return (
    <div className="va-creative-brief">
      <div className="va-section-header">
        <span className="va-section-title">专业创作 Brief</span>
        <button
          type="button"
          className="va-section-action"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? '收起高级' : '高级'}
        </button>
      </div>
      <div className="va-form-row va-creative-brief-primary">
        <div className="va-brief-field">
          <label className="va-edit-label">视频用途/场景</label>
          <ComboInput
            className="va-style-combo"
            value={brief.purpose || ''}
            onChange={(nextValue) => updateField('purpose', nextValue)}
            options={purposeOptions}
            placeholder="选择用途或场景，也可自定义"
          />
        </div>
        <div className="va-brief-field">
          <label className="va-edit-label">导演风格</label>
          <ComboInput
            className="va-style-combo"
            value={brief.directorStyle || ''}
            onChange={(nextValue) => updateField('directorStyle', nextValue)}
            options={directorStyleOptions}
            placeholder="选择导演风格"
          />
        </div>
      </div>
      <div className="va-brief-field">
        <label className="va-edit-label">叙事/编剧风格</label>
        <ComboInput
          className="va-style-combo"
          value={brief.narrativeStyle || ''}
          onChange={(nextValue) => updateField('narrativeStyle', nextValue)}
          options={narrativeStyleOptions}
          placeholder="选择叙事结构或编剧风格"
        />
      </div>
      {onVideoStyleChange && (
        <div className="va-brief-field">
          <label className="va-edit-label">画面风格</label>
          <ComboInput
            className="va-style-combo"
            value={videoStyle || ''}
            onChange={onVideoStyleChange}
            options={VISUAL_STYLE_OPTIONS}
            placeholder={VISUAL_STYLE_PLACEHOLDER}
          />
        </div>
      )}
      {advancedOpen && (
        <div className="va-creative-brief-advanced">
          <div className="va-form-row">
            <div className="va-brief-field">
              <label className="va-edit-label">目标平台</label>
              <ComboInput
                value={brief.targetPlatform || ''}
                onChange={(nextValue) => updateField('targetPlatform', nextValue)}
                options={TARGET_PLATFORM_OPTIONS}
                placeholder="选择平台"
              />
            </div>
            <div className="va-brief-field">
              <label className="va-edit-label">目标受众</label>
              <ComboInput
                value={brief.audience || ''}
                onChange={(nextValue) => updateField('audience', nextValue)}
                options={AUDIENCE_OPTIONS}
                placeholder="选择受众"
              />
            </div>
          </div>
          <div className="va-brief-field">
            <label className="va-edit-label">节奏策略</label>
            <ComboInput
              value={brief.pacing || ''}
              onChange={(nextValue) => updateField('pacing', nextValue)}
              options={PACING_OPTIONS}
              placeholder="选择节奏策略"
            />
          </div>
          <div className="va-brief-field">
            <label className="va-edit-label">禁忌/负面提示</label>
            <textarea
              className="va-edit-textarea"
              rows={2}
              value={brief.negativePrompt || ''}
              onChange={(event) => updateField('negativePrompt', event.target.value)}
              placeholder="如：不要硬广口吻、不要夸张表情、避免低质感滤镜"
            />
          </div>
        </div>
      )}
    </div>
  );
};
