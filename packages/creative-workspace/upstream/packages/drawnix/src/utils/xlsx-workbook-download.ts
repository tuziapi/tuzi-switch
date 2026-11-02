import { smartDownload } from './download-utils';
import { isTauriEnvironment } from './tauri-env';

export async function downloadXlsxWorkbook(
  bytes: ArrayBuffer,
  filename: string
): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  try {
    const result = await smartDownload([{ url, type: 'file', filename }]);
    return result.downloadedCount > 0;
  } finally {
    if (isTauriEnvironment()) {
      URL.revokeObjectURL(url);
    } else {
      // Browser downloads can still be consuming the object URL after a click.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
}
