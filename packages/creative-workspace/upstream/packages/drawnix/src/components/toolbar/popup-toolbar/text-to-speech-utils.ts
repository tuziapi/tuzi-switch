import type { PlaitBoard, PlaitElement } from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { MindElement } from '@plait/mind';
import { getCardBodyElement } from '../../card-element/CardElement';
import { markdownToPlainText } from '../../../hooks/useTextToSpeech';
import { isCardElement } from '../../../types/card.types';
import { sortElementsByPosition } from '../../../utils/selection-utils';
import {
  createReadingPlaybackSource,
  type ReadingPlaybackSource,
} from '../../../services/reading-playback-source';

export interface CanvasSpeechTextResult {
  text: string;
  source: 'selection' | 'element' | null;
  title?: string;
  sourceId?: string;
  origin?: ReadingPlaybackSource['origin'];
}

function normalizeSpeechText(text: string): string {
  return markdownToPlainText(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTextFromNode(node: unknown): string {
  if (!node) return '';

  if (typeof node === 'string') {
    return node;
  }

  if (Array.isArray(node)) {
    return node
      .map((item) => extractTextFromNode(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof node !== 'object') {
    return '';
  }

  const current = node as {
    text?: unknown;
    children?: unknown;
    data?: unknown;
  };

  const parts: string[] = [];

  if (typeof current.text === 'string') {
    parts.push(current.text);
  }

  if (Array.isArray(current.children)) {
    parts.push(extractTextFromNode(current.children));
  }

  if (Array.isArray(current.data)) {
    parts.push(extractTextFromNode(current.data));
  }

  return parts.filter(Boolean).join('\n');
}

function getSelectedTextWithinElement(element: HTMLElement | null): string {
  if (!element || typeof window === 'undefined') {
    return '';
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) {
    return '';
  }

  return selection.toString().trim();
}

function extractElementSpeechText(board: PlaitBoard, element: PlaitElement): string {
  if (isCardElement(element)) {
    return [element.title, element.body].filter(Boolean).join('\n\n');
  }

  if (MindElement.isMindElement(board, element)) {
    return extractTextFromNode((element as { data?: unknown }).data);
  }

  if (PlaitDrawElement.isDrawElement(element)) {
    const drawElement = element as {
      text?: unknown;
      data?: unknown;
      textContent?: unknown;
    };

    const text = extractTextFromNode(drawElement.text);
    if (text) return text;

    const data = extractTextFromNode(drawElement.data);
    if (data) return data;

    if (typeof drawElement.textContent === 'string') {
      return drawElement.textContent;
    }
  }

  const genericElement = element as { text?: unknown; data?: unknown };
  return extractTextFromNode(genericElement.text) || extractTextFromNode(genericElement.data);
}

export function getCanvasSpeechText(
  board: PlaitBoard,
  selectedElements: PlaitElement[]
): CanvasSpeechTextResult {
  if (selectedElements.length === 0) {
    return { text: '', source: null, title: '' };
  }

  if (selectedElements.length === 1 && isCardElement(selectedElements[0])) {
    const card = selectedElements[0];
    const selectedText = normalizeSpeechText(
      getSelectedTextWithinElement(getCardBodyElement(card.id))
    );
    if (selectedText) {
      return {
        text: selectedText,
        source: 'selection',
        title: card.title || '卡片朗读',
        sourceId: `card:${card.id}:selection`,
        origin: {
          kind: 'card',
          id: card.id,
        },
      };
    }
  }

  const firstElement = selectedElements[0];
  const firstCard = selectedElements.length === 1 && isCardElement(firstElement) ? firstElement : null;

  const text = normalizeSpeechText(
    selectedElements
      .map((element) => extractElementSpeechText(board, element))
      .filter(Boolean)
      .join('\n\n')
  );

  return {
    text,
    source: text ? 'element' : null,
    title: firstCard?.title || (selectedElements.length === 1 ? '画布朗读' : `已选 ${selectedElements.length} 个元素`),
    sourceId:
      selectedElements.length === 1
        ? `${selectedElements[0].type}:${selectedElements[0].id}`
        : `selection:${selectedElements.map((element) => element.id).sort().join('|')}`,
    origin: firstCard
      ? {
          kind: 'card',
          id: firstCard.id,
        }
      : undefined,
  };
}

export function createCanvasReadingPlaybackSource(
  result: CanvasSpeechTextResult
): ReadingPlaybackSource | null {
  if (!result.text || !result.sourceId) {
    return null;
  }

  return createReadingPlaybackSource({
    elementId: result.sourceId,
    title: result.title,
    content: result.text,
    origin: result.origin || {
      kind: 'card',
      id: result.sourceId,
    },
  });
}

export function createCanvasReadingPlaybackQueue(
  board: PlaitBoard,
  currentResult: CanvasSpeechTextResult
): ReadingPlaybackSource[] {
  const currentSource = createCanvasReadingPlaybackSource(currentResult);
  if (!currentSource) {
    return [];
  }

  if (!board.children || !currentResult.origin || currentResult.origin.kind !== 'card') {
    return [currentSource];
  }

  const cardElements = sortElementsByPosition(
    board,
    board.children.filter(isCardElement)
  );

  if (cardElements.length <= 1) {
    return [currentSource];
  }

  return cardElements
    .map((card) => {
      if (card.id === currentResult.origin?.id) {
        return currentSource;
      }

      return createReadingPlaybackSource({
        elementId: `card:${card.id}`,
        title: card.title || '卡片朗读',
        content: [card.title, card.body].filter(Boolean).join('\n\n'),
        origin: {
          kind: 'card',
          id: card.id,
        },
      });
    })
    .filter((item): item is ReadingPlaybackSource => Boolean(item));
}
