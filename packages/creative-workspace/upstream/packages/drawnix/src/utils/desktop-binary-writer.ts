export type DesktopBinaryPayload = Blob | Uint8Array;

export type DesktopBinaryWriter = (
  path: string,
  payload: DesktopBinaryPayload
) => Promise<void>;

let desktopBinaryWriter: DesktopBinaryWriter | null = null;

export function setDesktopBinaryWriter(writer: DesktopBinaryWriter): void {
  desktopBinaryWriter = writer;
}

export async function writeDesktopBinaryFile(
  path: string,
  payload: DesktopBinaryPayload
): Promise<void> {
  if (!desktopBinaryWriter) {
    throw new Error('Desktop binary writer is not initialized');
  }
  await desktopBinaryWriter(path, payload);
}
