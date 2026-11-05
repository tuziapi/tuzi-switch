import {
  BOARD_TO_ON_CHANGE,
  ListRender,
  PlaitElement,
  Viewport,
  createBoard,
  withBoard,
  withHandPointer,
  withHistory,
  withHotkey,
  withMoving,
  withOptions,
  withRelatedFragment,
  withSelection,
  PlaitBoard,
  type PlaitPlugin,
  type PlaitBoardOptions,
  type Selection,
  ThemeColorMode,
  BOARD_TO_AFTER_CHANGE,
  PlaitOperation,
  PlaitTheme,
  isFromScrolling,
  setIsFromScrolling,
  setIsFromViewportChange,
  updateViewportOffset,
  initializeViewBox,
  initializeViewportContainer,
  withI18n,
  updateViewBox,
  FLUSHING,
  BoardTransforms,
  clearSelectedElement,
} from '@plait/core';
import { BoardChangeData } from './plugins/board';
import { useCallback, useEffect, useRef, useState } from 'react';
import { withReact } from './plugins/with-react';
import { withImage, withText } from '@plait/common';
import { BoardContext, BoardContextValue } from './hooks/use-board';
import React from 'react';
import { withPinchZoom } from './plugins/with-pinch-zoom-plugin';
import {
  ignoreUpcomingViewportScroll,
  refreshSelectedElementActiveSections,
  refreshSelectedElementActiveSectionsForViewportChange,
} from './utils/viewport';

export type WrapperProps = {
  value: PlaitElement[];
  children: React.ReactNode;
  options: PlaitBoardOptions;
  plugins: PlaitPlugin[];
  viewport?: Viewport;
  theme?: PlaitTheme;
  onChange?: (data: BoardChangeData) => void;
  onSelectionChange?: (selection: Selection | null) => void;
  onValueChange?: (value: PlaitElement[]) => void;
  onViewportChange?: (value: Viewport) => void;
  onThemeChange?: (value: ThemeColorMode) => void;
};

export const Wrapper: React.FC<WrapperProps> = ({
  value,
  children,
  options,
  plugins,
  viewport,
  theme,
  onChange,
  onSelectionChange,
  onValueChange,
  onViewportChange,
  onThemeChange,
}) => {
  const [context, setContext] = useState<BoardContextValue>(() => {
    const board = initializeBoard(value, options, plugins, viewport, theme);
    const listRender = initializeListRender(board);
    return {
      v: 0,
      board,
      listRender,
    };
  });

  const { board, listRender } = context;

  const onContextChange = useCallback(() => {
    if (onChange) {
      const data: BoardChangeData = {
        children: board.children,
        operations: board.operations,
        viewport: board.viewport,
        selection: board.selection,
        theme: board.theme,
      };
      onChange(data);
    }

    const hasSelectionChanged = board.operations.some((o) =>
      PlaitOperation.isSetSelectionOperation(o)
    );
    const hasViewportChanged = board.operations.some((o) =>
      PlaitOperation.isSetViewportOperation(o)
    );
    const hasThemeChanged = board.operations.some((o) =>
      PlaitOperation.isSetThemeOperation(o)
    );
    const hasChildrenChanged =
      board.operations.length > 0 &&
      !board.operations.every(
        (o) =>
          PlaitOperation.isSetSelectionOperation(o) ||
          PlaitOperation.isSetViewportOperation(o) ||
          PlaitOperation.isSetThemeOperation(o)
      );

    if (onValueChange && hasChildrenChanged) {
      onValueChange(board.children);
    }

    if (onSelectionChange && hasSelectionChanged) {
      onSelectionChange(board.selection);
    }

    if (onViewportChange && hasViewportChanged) {
      onViewportChange(board.viewport);
    }

    if (onThemeChange && hasThemeChanged) {
      onThemeChange(board.theme.themeColorMode);
    }

    setContext((prevContext) => ({
      v: prevContext.v + 1,
      board,
      listRender,
    }));
  }, [
    board,
    onChange,
    onSelectionChange,
    onValueChange,
    onViewportChange,
    onThemeChange,
  ]);

  useEffect(() => {
    BOARD_TO_ON_CHANGE.set(board, () => {
      const isOnlySetSelection =
        board.operations.length &&
        board.operations.every((op) => op.type === 'set_selection');
      if (isOnlySetSelection) {
        listRender.update(board.children, {
          board: board,
          parent: board,
          parentG: PlaitBoard.getElementHost(board),
        });
        return;
      }
      const isSetViewport =
        board.operations.length &&
        board.operations.some((op) => op.type === 'set_viewport');
      if (isSetViewport && isFromScrolling(board)) {
        setIsFromScrolling(board, false);
        listRender.update(board.children, {
          board: board,
          parent: board,
          parentG: PlaitBoard.getElementHost(board),
        });
        refreshSelectedElementActiveSectionsForViewportChange(board);
        return;
      }
      listRender.update(board.children, {
        board: board,
        parent: board,
        parentG: PlaitBoard.getElementHost(board),
      });
      if (isSetViewport) {
        initializeViewBox(board);
      } else {
        updateViewBox(board);
      }
      updateViewportOffset(board);
      if (isSetViewport) {
        refreshSelectedElementActiveSectionsForViewportChange(board);
      } else {
        refreshSelectedElementActiveSections(board);
      }
    });

    BOARD_TO_AFTER_CHANGE.set(board, () => {
      onContextChange();
    });

    return () => {
      BOARD_TO_ON_CHANGE.delete(board);
      BOARD_TO_AFTER_CHANGE.delete(board);
    };
  }, [board]);

  const isFirstRender = useRef(true);
  const prevViewportRef = useRef<Viewport | undefined>(viewport);

  // 处理 viewport prop 变化（用于恢复保存的视图状态）
  useEffect(() => {
    const prevViewport = prevViewportRef.current;
    prevViewportRef.current = viewport;

    // 如果本次同时替换 children，等待 children 更新后再同步视口，避免用旧内容计算滚动范围
    const hasPendingValueUpdate = value !== board.children;

    // 如果外部传入了有效的 viewport，且与当前不同，则应用它
    if (viewport && !FLUSHING.get(board) && !hasPendingValueUpdate) {
      if (!isSameViewport(prevViewport, viewport)) {
        board.viewport = viewport;
        syncViewportContainer(board, 'viewport-prop-change');
      }
    }
  }, [viewport, board, value]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (value !== context.board.children && !FLUSHING.get(board)) {
      board.children = value;
      resetBoardHistory(board);
      clearSelectedElement(board);
      board.selection = null;
      listRender.update(board.children, {
        board: board,
        parent: board,
        parentG: PlaitBoard.getElementHost(board),
      });
      // 只有当没有传入 viewport 时才自动适配视图
      // 如果传入了 viewport，说明是恢复保存的视图，不应该重置
      if (!viewport) {
        BoardTransforms.fitViewport(board);
      } else {
        board.viewport = viewport;
        syncViewportContainer(board, 'value-with-viewport-change');
      }
    }
  }, [value, viewport]);

  return (
    <BoardContext.Provider value={context}>{children}</BoardContext.Provider>
  );
};

const initializeBoard = (
  value: PlaitElement[],
  options: PlaitBoardOptions,
  plugins: PlaitPlugin[],
  viewport?: Viewport,
  theme?: PlaitTheme
) => {
  let board = withRelatedFragment(
    withHotkey(
      withHandPointer(
        withHistory(
          withSelection(
            withMoving(
              withBoard(
                withI18n(
                  withOptions(
                    withReact(withImage(withText(createBoard(value, options))))
                  )
                )
              )
            )
          )
        )
      )
    )
  );
  plugins.forEach((plugin: any) => {
    board = plugin(board);
  });
  withPinchZoom(board);

  if (viewport) {
    board.viewport = viewport;
  }

  if (theme) {
    board.theme = theme;
  }

  return board;
};

const resetBoardHistory = (board: PlaitBoard) => {
  board.history.undos = [];
  board.history.redos = [];
};

const initializeListRender = (board: PlaitBoard) => {
  const listRender = new ListRender(board);
  return listRender;
};

const VIEWPORT_RESTORE_FRAMES = 30;
const VIEWPORT_RESTORE_MIN_FRAMES = 6;
const VIEWPORT_RESTORE_TOLERANCE = 2;
const VIEWPORT_RESTORE_VERSION = new WeakMap<PlaitBoard, number>();
const VIEWPORT_RESTORE_INTERACTION_CLEANUP = new WeakMap<
  PlaitBoard,
  () => void
>();

const syncViewportContainer = (board: PlaitBoard, reason: string) => {
  initializeViewportContainer(board);
  initializeViewBox(board);
  updateViewportOffset(board);
  refreshSelectedElementActiveSectionsForViewportChange(board);
  stabilizeViewportOffset(board, reason);
};

const isSameViewport = (a?: Viewport, b?: Viewport) => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.zoom === b.zoom &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.origination?.[0] === b.origination?.[0] &&
    a.origination?.[1] === b.origination?.[1]
  );
};

const VIEWPORT_DEBUG_KEY = 'aitu_debug_viewport';

const isViewportDebugEnabled = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('debugViewport') === '1' ||
      window.localStorage.getItem(VIEWPORT_DEBUG_KEY) === 'true'
    );
  } catch {
    return false;
  }
};

const summarizeViewport = (viewport?: Viewport) => ({
  zoom: viewport?.zoom,
  originX: viewport?.origination?.[0],
  originY: viewport?.origination?.[1],
  offsetX: viewport?.offsetX,
  offsetY: viewport?.offsetY,
});

const getViewportDomSnapshot = (board: PlaitBoard) => {
  try {
    const viewportContainer = PlaitBoard.getViewportContainer(board);
    const host = PlaitBoard.getHost(board);
    return {
      domScrollLeft: viewportContainer.scrollLeft,
      domScrollTop: viewportContainer.scrollTop,
      domScrollWidth: viewportContainer.scrollWidth,
      domScrollHeight: viewportContainer.scrollHeight,
      domClientWidth: viewportContainer.clientWidth,
      domClientHeight: viewportContainer.clientHeight,
      domOffsetWidth: viewportContainer.offsetWidth,
      domOffsetHeight: viewportContainer.offsetHeight,
      styleWidth: viewportContainer.style.width,
      styleHeight: viewportContainer.style.height,
      viewBox: host.getAttribute('viewBox'),
      svgWidth: host.style.width,
      svgHeight: host.style.height,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const getExpectedViewportScroll = (board: PlaitBoard) => {
  try {
    const origin = board.viewport?.origination;
    if (!origin) {
      return null;
    }
    const viewBox = PlaitBoard.getHost(board).getAttribute('viewBox');
    if (!viewBox) {
      return null;
    }
    const [viewBoxX, viewBoxY] = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number(value));
    if (!Number.isFinite(viewBoxX) || !Number.isFinite(viewBoxY)) {
      return null;
    }
    const zoom = board.viewport.zoom;
    return {
      targetScrollLeft: (origin[0] - viewBoxX) * zoom,
      targetScrollTop: (origin[1] - viewBoxY) * zoom,
    };
  } catch {
    return null;
  }
};

const stabilizeViewportOffset = (board: PlaitBoard, reason: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  const version = (VIEWPORT_RESTORE_VERSION.get(board) ?? 0) + 1;
  VIEWPORT_RESTORE_VERSION.set(board, version);
  attachViewportRestoreInteractionCancel(board, reason);
  let frame = 0;
  const run = () => {
    if (VIEWPORT_RESTORE_VERSION.get(board) !== version) {
      return;
    }

    const target = getExpectedViewportScroll(board);
    if (!target) {
      logViewportDebug('wrapper:restore-scroll', board, {
        reason,
        status: 'no-target',
        attempts: frame + 1,
      });
      clearViewportRestoreInteractionCancel(board);
      setIsFromViewportChange(board, false);
      refreshSelectedElementActiveSectionsForViewportChange(board);
      return;
    }

    const viewportContainer = PlaitBoard.getViewportContainer(board);
    const deltaLeft = Math.abs(
      viewportContainer.scrollLeft - target.targetScrollLeft
    );
    const deltaTop = Math.abs(
      viewportContainer.scrollTop - target.targetScrollTop
    );
    const needsRestore =
      deltaLeft > VIEWPORT_RESTORE_TOLERANCE ||
      deltaTop > VIEWPORT_RESTORE_TOLERANCE;

    if (needsRestore) {
      restoreViewportContainerScroll(board, target);
    }
    refreshSelectedElementActiveSectionsForViewportChange(board);

    const afterDeltaLeft = Math.abs(
      viewportContainer.scrollLeft - target.targetScrollLeft
    );
    const afterDeltaTop = Math.abs(
      viewportContainer.scrollTop - target.targetScrollTop
    );
    const isStable =
      afterDeltaLeft <= VIEWPORT_RESTORE_TOLERANCE &&
      afterDeltaTop <= VIEWPORT_RESTORE_TOLERANCE;
    const shouldContinue =
      frame + 1 < VIEWPORT_RESTORE_FRAMES &&
      (!isStable || frame + 1 < VIEWPORT_RESTORE_MIN_FRAMES);

    if (!shouldContinue) {
      logViewportDebug('wrapper:restore-scroll', board, {
        reason,
        status: isStable ? 'ok' : 'mismatch',
        attempts: frame + 1,
        ...target,
        deltaLeft: afterDeltaLeft,
        deltaTop: afterDeltaTop,
      });
      clearViewportRestoreInteractionCancel(board);
      setIsFromViewportChange(board, false);
      return;
    }

    frame += 1;
    scheduleViewportRestoreFrame(run);
  };

  scheduleViewportRestoreFrame(run);
};

const scheduleViewportRestoreFrame = (callback: () => void) => {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
};

const restoreViewportContainerScroll = (
  board: PlaitBoard,
  target: { targetScrollLeft: number; targetScrollTop: number }
) => {
  const viewportContainer = PlaitBoard.getViewportContainer(board);
  setIsFromViewportChange(board, true);
  viewportContainer.scrollLeft = target.targetScrollLeft;
  viewportContainer.scrollTop = target.targetScrollTop;

  const deltaLeft = Math.abs(
    viewportContainer.scrollLeft - target.targetScrollLeft
  );
  const deltaTop = Math.abs(
    viewportContainer.scrollTop - target.targetScrollTop
  );

  if (
    deltaLeft > VIEWPORT_RESTORE_TOLERANCE ||
    deltaTop > VIEWPORT_RESTORE_TOLERANCE
  ) {
    updateViewportOffset(board);
  }
  refreshSelectedElementActiveSectionsForViewportChange(board);
};

const attachViewportRestoreInteractionCancel = (
  board: PlaitBoard,
  reason: string
) => {
  clearViewportRestoreInteractionCancel(board);

  const cancel = (event: Event) => {
    cancelViewportRestore(board, reason, event);
  };
  const options = { capture: true, passive: true };

  window.addEventListener('wheel', cancel, options);
  window.addEventListener('pointerdown', cancel, options);
  window.addEventListener('touchstart', cancel, options);
  window.addEventListener('keydown', cancel, options);

  VIEWPORT_RESTORE_INTERACTION_CLEANUP.set(board, () => {
    window.removeEventListener('wheel', cancel, options);
    window.removeEventListener('pointerdown', cancel, options);
    window.removeEventListener('touchstart', cancel, options);
    window.removeEventListener('keydown', cancel, options);
  });
};

const cancelViewportRestore = (
  board: PlaitBoard,
  reason: string,
  event?: Event
) => {
  VIEWPORT_RESTORE_VERSION.set(
    board,
    (VIEWPORT_RESTORE_VERSION.get(board) ?? 0) + 1
  );
  clearViewportRestoreInteractionCancel(board);
  if (isZoomWheelEvent(event)) {
    ignoreUpcomingViewportScroll(board, 2);
  }
  setIsFromViewportChange(board, false);
  logViewportDebug('wrapper:restore-scroll', board, {
    reason,
    status: 'cancelled-by-user',
  });
};

const isZoomWheelEvent = (event?: Event): event is WheelEvent => {
  return (
    typeof WheelEvent !== 'undefined' &&
    event instanceof WheelEvent &&
    (event.ctrlKey || event.metaKey)
  );
};

const clearViewportRestoreInteractionCancel = (board: PlaitBoard) => {
  const cleanup = VIEWPORT_RESTORE_INTERACTION_CLEANUP.get(board);
  if (!cleanup) {
    return;
  }
  cleanup();
  VIEWPORT_RESTORE_INTERACTION_CLEANUP.delete(board);
};

const logViewportDebug = (
  stage: string,
  board: PlaitBoard,
  extra?: Record<string, unknown>
) => {
  if (!isViewportDebugEnabled()) {
    return;
  }
};

const formatDebugPayload = (payload: Record<string, unknown>): string => {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (typeof value === 'number') {
        return `${key}=${Number.isInteger(value) ? value : value.toFixed(3)}`;
      }
      if (typeof value === 'string' || typeof value === 'boolean') {
        return `${key}=${value}`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(' ');
};
