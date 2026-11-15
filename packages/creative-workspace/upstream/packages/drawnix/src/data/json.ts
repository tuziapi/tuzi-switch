import { PlaitBoard } from '@plait/core';
import { MIME_TYPES, VERSIONS } from '../constants';
import { fileOpen, fileSave, isFileSystemAbortError } from './filesystem';
import { DrawnixExportedData, DrawnixExportedType } from './types';
import { loadFromBlob, normalizeFile } from './blob';
import { collectEmbeddedMediaFromElements } from './embedded-media';
export { isValidDrawnixData } from './drawnix-data-validation';
export { collectEmbeddedMediaFromElements } from './embedded-media';

export const getDefaultName = () => {
  const time = new Date().getTime();
  return time.toString();
};

export const saveAsJSON = async (
  board: PlaitBoard,
  name: string = getDefaultName()
) => {
  const serialized = await serializeAsJSONAsync(board);
  const blob = new Blob([serialized], {
    type: MIME_TYPES.drawnix,
  });

  try {
    const fileHandle = await fileSave(blob, {
      name,
      extension: 'drawnix',
      description: 'Drawnix file',
    });
    return { fileHandle };
  } catch (error) {
    if (isFileSystemAbortError(error)) {
      return { fileHandle: null };
    }
    throw error;
  }
};

export const loadFromJSON = async (board: PlaitBoard) => {
  try {
    const file = await fileOpen({
      description: 'Drawnix files',
      // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
      // gets resolved. Else, iOS users cannot open `.drawnix` files.
      // extensions: ["json", "drawnix", "png", "svg"],
    });
    return loadFromBlob(board, await normalizeFile(file));
  } catch (error) {
    if (isFileSystemAbortError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * 同步序列化（向后兼容，不包含嵌入式媒体）
 */
export const serializeAsJSON = (board: PlaitBoard): string => {
  const data = {
    type: DrawnixExportedType.drawnix,
    version: VERSIONS.drawnix,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
  };

  return JSON.stringify(data, null, 2);
};

/**
 * 异步序列化（包含嵌入式媒体数据）
 * 用于保存文件时，将虚拟 URL 对应的媒体数据内嵌到文件中
 */
export const serializeAsJSONAsync = async (board: PlaitBoard): Promise<string> => {
  const embeddedMedia = await collectEmbeddedMediaFromElements(board.children);

  const data: DrawnixExportedData = {
    type: DrawnixExportedType.drawnix,
    version: VERSIONS.drawnix,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
    embeddedMedia,
  };

  return JSON.stringify(data, null, 2);
};
