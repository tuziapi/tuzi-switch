import { PlaitBoard, PlaitElement, Transforms, getRectangleByElements } from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { PlaitCard, isCardElement } from '../types/card.types';
import { MessagePlugin } from './message-plugin';
import { Node } from 'slate';

const KB_NOTE_DIRECTORY_NAME = '笔记';
const DEFAULT_NOTE_TITLE = '新笔记';
const CONTENT_MERGE_X_TOLERANCE = 24;

function buildCardNoteTitle(cardElement: PlaitCard): string {
  return cardElement.title?.trim() || DEFAULT_NOTE_TITLE;
}

function buildCardNoteContent(cardElement: PlaitCard): string {
  return (cardElement.body || '').trim();
}

async function ensureKnowledgeBaseNoteDirectory() {
  const { knowledgeBaseService } = await import('../services/knowledge-base-service');
  await knowledgeBaseService.initialize();
  const dirs = await knowledgeBaseService.getAllDirectories();
  const existing = dirs.find((dir) => dir.name === KB_NOTE_DIRECTORY_NAME);
  if (existing) {
    return { knowledgeBaseService, directory: existing };
  }
  const directory = await knowledgeBaseService.createDirectory(KB_NOTE_DIRECTORY_NAME);
  return { knowledgeBaseService, directory };
}

function setCardNoteId(board: PlaitBoard, cardId: string, noteId?: string): void {
  const elementIndex = board.children.findIndex((child: any) => child.id === cardId);
  if (elementIndex < 0) return;
  Transforms.setNode(board, { noteId } as Partial<PlaitCard>, [elementIndex]);
}

export function extractElementTextContent(element: PlaitElement): string {
  if (isCardElement(element)) {
    const title = element.title?.trim() ? `# ${element.title.trim()}` : '';
    const body = element.body?.trim() || '';
    return [title, body].filter(Boolean).join('\n\n').trim();
  }

  const texts: string[] = [];

  if ('data' in element && Array.isArray(element.data)) {
    for (const node of element.data) {
      if (Node.isNode(node)) {
        const text = Node.string(node).trim();
        if (text) texts.push(text);
      }
    }
  }

  if ('text' in element) {
    if (typeof element.text === 'string') {
      const text = element.text.trim();
      if (text) texts.push(text);
    } else if (element.text && typeof element.text === 'object' && Node.isNode(element.text)) {
      const text = Node.string(element.text).trim();
      if (text) texts.push(text);
    }
  }

  if ('textContent' in element && typeof element.textContent === 'string') {
    const text = element.textContent.trim();
    if (text) texts.push(text);
  }

  return texts.join('\n').trim();
}

export function isPlainTextElement(element: PlaitElement): boolean {
  return PlaitDrawElement.isDrawElement(element) && PlaitDrawElement.isText(element);
}

export function sortElementsForContentMerge(
  board: PlaitBoard,
  elements: PlaitElement[]
): PlaitElement[] {
  return [...elements].sort((a, b) => {
    const rectA = getRectangleByElements(board, [a], false);
    const rectB = getRectangleByElements(board, [b], false);
    if (Math.abs(rectA.x - rectB.x) <= CONTENT_MERGE_X_TOLERANCE) {
      if (Math.abs(rectA.y - rectB.y) > 0.5) {
        return rectA.y - rectB.y;
      }
      return rectA.x - rectB.x;
    }
    return rectA.x - rectB.x;
  });
}

export async function saveCardToKnowledgeBase(
  board: PlaitBoard,
  cardElement: PlaitCard,
  language: 'zh' | 'en' = 'zh'
): Promise<string | null> {
  if (!cardElement) return null;
  if (cardElement.noteId) return cardElement.noteId;

  try {
    const { knowledgeBaseService, directory } = await ensureKnowledgeBaseNoteDirectory();
    const note = await knowledgeBaseService.createNote(
      buildCardNoteTitle(cardElement),
      directory.id
    );
    const content = buildCardNoteContent(cardElement);
    if (content) {
      await knowledgeBaseService.updateNote(note.id, { content });
    }
    setCardNoteId(board, cardElement.id, note.id);
    return note.id;
  } catch (error) {
    console.error('Failed to create note for card:', error);
    MessagePlugin.error(language === 'zh' ? '保存到知识库失败' : 'Failed to save to knowledge base');
    return null;
  }
}

export async function syncMergedCardKnowledgeBinding(
  noteIds: string[],
  mergedContent: string
): Promise<string | undefined> {
  const uniqueNoteIds = [...new Set(noteIds.filter(Boolean))];
  if (uniqueNoteIds.length === 0) return undefined;

  const { knowledgeBaseService } = await import('../services/knowledge-base-service');
  await knowledgeBaseService.initialize();

  const preservedNoteId = uniqueNoteIds[0];
  await knowledgeBaseService.updateNote(preservedNoteId, { content: mergedContent });

  for (const noteId of uniqueNoteIds.slice(1)) {
    await knowledgeBaseService.deleteNote(noteId);
  }

  return preservedNoteId;
}

export const openCardInKnowledgeBase = async (board: PlaitBoard, cardElement: PlaitCard, language: 'zh' | 'en' = 'zh') => {
  if (!cardElement) return;

  // 如果 Card 已关联笔记，直接打开知识库并定位
  if (cardElement.noteId) {
    window.dispatchEvent(new CustomEvent('kb:open', { detail: { noteId: cardElement.noteId } }));
    return;
  }

  // 否则先在知识库中创建新笔记，再关联
  try {
    const noteId = await saveCardToKnowledgeBase(board, cardElement, language);
    if (!noteId) return;

    // 打开知识库并定位到新笔记
    window.dispatchEvent(new CustomEvent('kb:open', { detail: { noteId } }));
  } catch (error) {
    console.error('Failed to create note for card:', error);
    MessagePlugin.error(language === 'zh' ? '无法打开知识库笔记' : 'Failed to open knowledge base note');
  }
};
