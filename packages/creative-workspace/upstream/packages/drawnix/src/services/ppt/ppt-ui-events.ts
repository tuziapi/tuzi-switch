export type PPTEditorViewMode = 'slides' | 'outline';

export interface PPTEditorOpenEventDetail {
  viewMode?: PPTEditorViewMode;
}

export const PPT_EDITOR_OPEN_EVENT = 'aitu:ppt-editor-open';
export const PPT_EDITOR_VIEW_MODE_STORAGE_KEY = 'aitu:ppt-editor-view-mode';

const PROJECT_DRAWER_ACTIVE_TAB_KEY = 'project-drawer-active-tab';
const PROJECT_DRAWER_PPT_EDIT_TAB = 'frames';

export function loadPPTEditorViewMode(): PPTEditorViewMode {
  if (typeof window === 'undefined') {
    return 'slides';
  }
  try {
    const cached = window.localStorage.getItem(PPT_EDITOR_VIEW_MODE_STORAGE_KEY);
    return cached === 'outline' ? 'outline' : 'slides';
  } catch {
    return 'slides';
  }
}

export function savePPTEditorViewMode(viewMode: PPTEditorViewMode): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(PPT_EDITOR_VIEW_MODE_STORAGE_KEY, viewMode);
  } catch {
    // Ignore storage errors.
  }
}

export function requestOpenPPTEditor(
  detail: PPTEditorOpenEventDetail = {}
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      PROJECT_DRAWER_ACTIVE_TAB_KEY,
      PROJECT_DRAWER_PPT_EDIT_TAB
    );
    if (detail.viewMode) {
      savePPTEditorViewMode(detail.viewMode);
    }
  } catch {
    // Ignore storage errors.
  }

  window.dispatchEvent(new CustomEvent(PPT_EDITOR_OPEN_EVENT, { detail }));
}
