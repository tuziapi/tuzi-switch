/**
 * useTextToSpeech - 语音朗读 Hook
 *
 * 使用 Web Speech API 将 Markdown 文本转为语音朗读
 * 支持播放、暂停、停止控制
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { ttsSettings, type TtsSettings } from '../utils/settings-manager';

export interface TextToSpeechState {
  /** 是否正在朗读 */
  isSpeaking: boolean;
  /** 是否已暂停 */
  isPaused: boolean;
  /** 是否支持语音合成 */
  isSupported: boolean;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  selectedVoice: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  voicesByLanguage: {},
};

const LANGUAGE_VOICE_FALLBACKS: Array<{
  code: string;
  aliases: string[];
  pattern: RegExp;
}> = [
  { code: 'ja-JP', aliases: ['ja', 'ja-jp'], pattern: /[\u3040-\u30ff]/g },
  { code: 'ko-KR', aliases: ['ko', 'ko-kr'], pattern: /[\uac00-\ud7af]/g },
  {
    code: 'zh-CN',
    aliases: ['zh', 'zh-cn', 'zh-hans', 'cmn'],
    pattern: /[\u4e00-\u9fff]/g,
  },
  {
    code: 'ru-RU',
    aliases: ['ru', 'ru-ru'],
    pattern: /[\u0400-\u04ff]/g,
  },
  {
    code: 'ar-SA',
    aliases: ['ar', 'ar-sa'],
    pattern: /[\u0600-\u06ff]/g,
  },
  {
    code: 'en-US',
    aliases: ['en', 'en-us'],
    pattern: /[A-Za-z]/g,
  },
];

export function normalizeVoiceLanguageKey(language: string): string {
  return language.trim().toLowerCase().split('-')[0] || 'zh';
}

export function inferSpeechLanguage(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return 'zh-CN';
  }

  let bestMatch = LANGUAGE_VOICE_FALLBACKS[2];
  let bestCount = 0;

  LANGUAGE_VOICE_FALLBACKS.forEach((candidate) => {
    const matches = normalized.match(candidate.pattern);
    const count = matches?.length || 0;
    if (count > bestCount) {
      bestCount = count;
      bestMatch = candidate;
    }
  });

  return bestMatch.code;
}

export function resolveVoice(
  voices: SpeechSynthesisVoice[],
  settings: TtsSettings,
  language: string
): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }

  const normalizedLanguage = language.toLowerCase();
  const baseLanguage = normalizeVoiceLanguageKey(normalizedLanguage);
  const languageMeta =
    LANGUAGE_VOICE_FALLBACKS.find(
      (candidate) =>
        candidate.code.toLowerCase() === normalizedLanguage ||
        candidate.aliases.includes(normalizedLanguage) ||
        candidate.aliases.includes(baseLanguage)
    ) || null;

  const configuredVoiceUri =
    settings.voicesByLanguage?.[baseLanguage] || settings.selectedVoice;
  if (configuredVoiceUri) {
    const configuredVoice = voices.find(
      (voice) => voice.voiceURI === configuredVoiceUri
    );
    if (configuredVoice) {
      return configuredVoice;
    }
  }

  const exactVoice = voices.find(
    (voice) => voice.lang.toLowerCase() === normalizedLanguage
  );
  if (exactVoice) {
    return exactVoice;
  }

  const aliasVoice = voices.find((voice) => {
    const voiceLanguage = voice.lang.toLowerCase();
    const voiceBaseLanguage = normalizeVoiceLanguageKey(voiceLanguage);
    return (
      voiceBaseLanguage === baseLanguage ||
      languageMeta?.aliases.some(
        (alias) =>
          voiceLanguage === alias || voiceLanguage.startsWith(`${alias}-`)
      ) === true
    );
  });
  if (aliasVoice) {
    return aliasVoice;
  }

  return voices.find((voice) => voice.default) || voices[0] || null;
}

/**
 * 将 Markdown 文本转换为纯文本（去除语法标记）
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    // 移除代码块
    .replace(/```[\s\S]*?```/g, '')
    // 移除行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 移除图片
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // 移除链接，保留文本
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 移除标题标记
    .replace(/^#{1,6}\s+/gm, '')
    // 移除粗体/斜体
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // 移除删除线
    .replace(/~~(.+?)~~/g, '$1')
    // 移除无序列表标记
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // 移除有序列表标记
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // 移除引用标记
    .replace(/^>\s+/gm, '')
    // 移除分隔线
    .replace(/^[-*_]{3,}$/gm, '')
    // 移除 HTML 标签
    .replace(/<[^>]+>/g, '')
    // 压缩多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function useTextToSpeech() {
  const [state, setState] = useState<TextToSpeechState>({
    isSpeaking: false,
    isPaused: false,
    isSupported: typeof window !== 'undefined' && 'speechSynthesis' in window,
  });
  const [settings, setSettings] = useState<TtsSettings>(() => {
    const persisted = ttsSettings.get();
    return {
      ...DEFAULT_TTS_SETTINGS,
      ...(persisted || {}),
      voicesByLanguage: persisted?.voicesByLanguage || {},
    };
  });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const handleSettingsChange = (nextSettings: TtsSettings) => {
      setSettings({
        ...DEFAULT_TTS_SETTINGS,
        ...(nextSettings || {}),
        voicesByLanguage: nextSettings?.voicesByLanguage || {},
      });
    };

    ttsSettings.addListener(handleSettingsChange);

    return () => {
      ttsSettings.removeListener(handleSettingsChange);
      if (stateRef.current.isSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = useCallback(
    (content: string, preferredLanguage?: string) => {
      if (!state.isSupported) return;

      window.speechSynthesis.cancel();

      const plainText = markdownToPlainText(content);
      if (!plainText) return;

      const utterance = new SpeechSynthesisUtterance(plainText);
      const speechLanguage = preferredLanguage || inferSpeechLanguage(plainText);
      utterance.lang = speechLanguage;
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      utterance.volume = settings.volume;

      const voices = window.speechSynthesis.getVoices();
      const resolvedVoice = resolveVoice(voices, settings, speechLanguage);
      if (resolvedVoice) {
        utterance.voice = resolvedVoice;
      }

      utterance.onend = () => {
        setState((prev) => ({ ...prev, isSpeaking: false, isPaused: false }));
        utteranceRef.current = null;
      };

      utterance.onerror = () => {
        setState((prev) => ({ ...prev, isSpeaking: false, isPaused: false }));
        utteranceRef.current = null;
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setState((prev) => ({ ...prev, isSpeaking: true, isPaused: false }));
    },
    [settings, state.isSupported]
  );

  const pause = useCallback(() => {
    if (!state.isSupported) return;
    window.speechSynthesis.pause();
    setState((prev) => ({ ...prev, isPaused: true }));
  }, [state.isSupported]);

  const resume = useCallback(() => {
    if (!state.isSupported) return;
    window.speechSynthesis.resume();
    setState((prev) => ({ ...prev, isPaused: false }));
  }, [state.isSupported]);

  const stop = useCallback(() => {
    if (!state.isSupported) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setState((prev) => ({ ...prev, isSpeaking: false, isPaused: false }));
  }, [state.isSupported]);

  return {
    ...state,
    speak,
    pause,
    resume,
    stop,
  };
}
