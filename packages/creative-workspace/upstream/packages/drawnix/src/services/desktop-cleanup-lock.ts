let cleaning = false;
let writers = 0;

export function assertDesktopCleanupAvailable(): void {
  if (cleaning) throw new Error('正在清理本地文件，请稍后重试');
}

export function beginDesktopMediaWrite(): () => void {
  if (cleaning) throw new Error('正在清理本地文件，请稍后再导入');
  writers += 1;
  return () => {
    writers -= 1;
  };
}

export function beginDesktopCleanup(): () => void {
  if (cleaning || writers > 0)
    throw new Error('正在导入或清理本地文件，请稍后重试');
  cleaning = true;
  return () => {
    cleaning = false;
  };
}
