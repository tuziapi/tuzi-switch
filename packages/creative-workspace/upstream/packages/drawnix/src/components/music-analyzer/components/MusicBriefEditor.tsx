import React, { useCallback, useMemo } from 'react';
import { ComboInput } from '../../shared/workflow';
import type { MusicBrief } from '../music-brief';
import {
  MUSIC_BRIEF_ENERGY_OPTIONS,
  MUSIC_BRIEF_GENRE_OPTIONS,
  MUSIC_BRIEF_LYRIC_GOAL_OPTIONS,
  MUSIC_BRIEF_PURPOSE_OPTIONS,
  MUSIC_BRIEF_VOCAL_OPTIONS,
  normalizeMusicBrief,
} from '../music-brief';

interface MusicBriefEditorProps {
  value?: MusicBrief | null;
  onChange: (value: MusicBrief) => void;
}

interface BriefFieldConfig {
  key: keyof MusicBrief;
  label: string;
  placeholder: string;
  options: string[];
}

const FIELD_CONFIGS: BriefFieldConfig[] = [
  {
    key: 'purpose',
    label: '音乐用途',
    placeholder: '普通歌曲创作 / 短视频爆点 / 广告歌',
    options: MUSIC_BRIEF_PURPOSE_OPTIONS,
  },
  {
    key: 'genreStyle',
    label: '核心曲风',
    placeholder: 'Mozart Classical / Mandopop / R&B',
    options: MUSIC_BRIEF_GENRE_OPTIONS,
  },
  {
    key: 'vocalStyle',
    label: '人声/唱法',
    placeholder: 'female vocal（女声）/ rap vocal（说唱人声）',
    options: MUSIC_BRIEF_VOCAL_OPTIONS,
  },
  {
    key: 'energyMood',
    label: '情绪能量',
    placeholder: '高能上扬 / 深夜情绪化 / 克制高级',
    options: MUSIC_BRIEF_ENERGY_OPTIONS,
  },
  {
    key: 'lyricGoal',
    label: '歌词目标',
    placeholder: '副歌第一句要有记忆点',
    options: MUSIC_BRIEF_LYRIC_GOAL_OPTIONS,
  },
];

export const MusicBriefEditor: React.FC<MusicBriefEditorProps> = ({
  value,
  onChange,
}) => {
  const brief = useMemo(() => normalizeMusicBrief(value), [value]);

  const updateField = useCallback(
    (key: keyof MusicBrief, nextValue: string) => {
      onChange(
        normalizeMusicBrief({
          ...brief,
          [key]: nextValue,
        })
      );
    },
    [brief, onChange]
  );

  return (
    <div className="ma-music-brief">
      <div className="ma-card-header">
        <span>歌曲定位</span>
        <span className="ma-muted">用于约束歌词与 Suno 标签</span>
      </div>
      <div className="ma-music-brief-grid">
        {FIELD_CONFIGS.map((field) => (
          <label className="ma-field" key={field.key}>
            <span>{field.label}</span>
            <ComboInput
              className="ma-brief-combo"
              value={brief[field.key] || ''}
              onChange={(nextValue) => updateField(field.key, nextValue)}
              options={field.options}
              placeholder={field.placeholder}
            />
          </label>
        ))}
      </div>
    </div>
  );
};
