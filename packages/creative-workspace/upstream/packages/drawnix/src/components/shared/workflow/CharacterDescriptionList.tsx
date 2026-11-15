import React from 'react';
import type { VideoCharacter } from '../../../services/video-analysis-service';

export interface CharacterDescriptionListProps {
  characters: VideoCharacter[];
  onChange: (characterId: string, description: string) => void;
  placeholder?: string;
}

export function estimateCharacterDescriptionRows(
  text: string | undefined,
  charsPerLine = 30
): number {
  if (!text) return 1;
  const lines = text.split('\n');
  let total = 0;
  for (const line of lines) {
    total += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  return Math.max(1, total);
}

export function autoResizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

export const CharacterDescriptionList: React.FC<CharacterDescriptionListProps> = ({
  characters,
  onChange,
  placeholder = '主体外貌描述（英文，用于文生图）',
}) => {
  if (characters.length === 0) {
    return null;
  }

  return (
    <div className="va-characters">
      {characters.map((character) => (
        <div key={character.id} className="va-character-item">
          <div className="va-character-info" style={{ flex: 1 }}>
            <span className="va-character-name">{character.name}</span>
            <textarea
              ref={autoResizeTextarea}
              className="va-edit-textarea va-auto-resize"
              rows={estimateCharacterDescriptionRows(character.description)}
              value={character.description}
              onChange={(event) => onChange(character.id, event.target.value)}
              onInput={(event) => autoResizeTextarea(event.currentTarget)}
              placeholder={placeholder}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
