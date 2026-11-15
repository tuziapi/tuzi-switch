export const DRAWER_PIN_KEYS = {
  project: 'drawnix-drawer-pin-project',
  toolbox: 'drawnix-drawer-pin-toolbox',
  task: 'drawnix-drawer-pin-task',
} as const;

export type DrawerPinKey =
  (typeof DRAWER_PIN_KEYS)[keyof typeof DRAWER_PIN_KEYS];

export function getDrawerPinned(key: DrawerPinKey): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function setDrawerPinned(key: DrawerPinKey, pinned: boolean): void {
  try {
    localStorage.setItem(key, String(pinned));
  } catch {
    // 忽略 localStorage 错误
  }
}
