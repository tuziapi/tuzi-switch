import type { FileSystemHandle } from 'browser-fs-access';
import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as nativeFileSystemSupported,
} from 'browser-fs-access';
import { MIME_TYPES } from '../constants';
import { writeDesktopBinaryFile } from '../utils/desktop-binary-writer';

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, 'binary'>;

function getErrorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return typeof error === 'string' ? error : '';
}

export function isFileSystemAbortError(error: unknown): boolean {
  const name = getErrorName(error);
  const message = getErrorMessage(error);

  if (name === 'AbortError' || message.startsWith('AbortError:')) {
    return true;
  }

  return (
    message.includes('The user aborted a request') &&
    (message.includes("Failed to execute 'showOpenFilePicker'") ||
      message.includes("Failed to execute 'showSaveFilePicker'") ||
      message.trim() === 'The user aborted a request.')
  );
}

function normalizeFileSystemError(error: unknown): never {
  if (!isFileSystemAbortError(error)) {
    throw error;
  }

  const message =
    getErrorMessage(error).replace(/^AbortError:\s*/, '') ||
    'The user aborted a request.';

  if (typeof DOMException === 'function') {
    throw new DOMException(message, 'AbortError');
  }

  const normalized = new Error(message);
  normalized.name = 'AbortError';
  throw normalized;
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
}

function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  return (window as any).__TUZI_CREATIVE_NATIVE__.invoke(command, args);
}

async function pickDesktopSavePath(fileName: string): Promise<string | null> {
  return tauriInvoke<string | null>('pick_save_location', {
    defaultName: fileName,
  });
}

async function writeBlobToDesktopPath(
  savePath: string,
  blob: Blob
): Promise<void> {
  await writeDesktopBinaryFile(savePath, blob);
}

export const fileOpen = <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  const mimeTypes = opts.extensions?.reduce((mimeTypes, type) => {
    mimeTypes.push(MIME_TYPES[type]);

    return mimeTypes;
  }, [] as string[]);

  const extensions = opts.extensions?.reduce((acc, ext) => {
    if (ext === 'jpg') {
      return acc.concat('.jpg', '.jpeg');
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

  try {
    return _fileOpen({
      description: opts.description,
      extensions,
      mimeTypes,
      multiple: opts.multiple ?? false,
    }).catch(normalizeFileSystemError) as Promise<RetType>;
  } catch (error) {
    normalizeFileSystemError(error);
  }
};

export const fileSave = (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    description: string;
    /** existing FileSystemHandle */
    fileHandle?: FileSystemHandle | null;
  }
) => {
  const fileName = `${opts.name}.${opts.extension}`;
  if (isTauriEnvironment()) {
    return (async () => {
      const savePath = await pickDesktopSavePath(fileName);
      if (!savePath) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      await writeBlobToDesktopPath(savePath, await blob);
      return null;
    })();
  }

  try {
    return _fileSave(
      blob,
      {
        fileName,
        description: opts.description,
        extensions: [`.${opts.extension}`],
      },
      opts.fileHandle as any
    ).catch(normalizeFileSystemError);
  } catch (error) {
    normalizeFileSystemError(error);
  }
};

export type { FileSystemHandle };
export { nativeFileSystemSupported };
