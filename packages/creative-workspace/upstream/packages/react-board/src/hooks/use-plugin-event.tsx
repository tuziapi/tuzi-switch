import {
  BOARD_TO_MOVING_POINT,
  BOARD_TO_MOVING_POINT_IN_BOARD,
  PlaitBoard,
  WritableClipboardOperationType,
  deleteFragment,
  getClipboardData,
  hasInputOrTextareaTarget,
  setFragment,
  toHostPoint,
  toViewBoxPoint,
} from '@plait/core';
import { useEventListener } from './use-event-listener';

const hasEditableTarget = (target: EventTarget | null) => {
  if (hasInputOrTextareaTarget(target)) {
    return true;
  }
  return (
    target instanceof Element && !!target.closest('[contenteditable="true"]')
  );
};

const useBoardPluginEvent = (
  board: PlaitBoard,
  viewportContainerRef: React.RefObject<HTMLDivElement>,
  hostRef: React.RefObject<SVGSVGElement>
) => {
  useEventListener(
    'pointerdown',
    (event) => {
      board.pointerDown(event);
    },
    { target: hostRef }
  );

  useEventListener(
    'pointermove',
    (event) => {
      BOARD_TO_MOVING_POINT_IN_BOARD.set(board, [event.x, event.y]);
      board.pointerMove(event);
    },
    { target: viewportContainerRef }
  );

  useEventListener(
    'pointerleave',
    (event) => {
      BOARD_TO_MOVING_POINT_IN_BOARD.delete(board);
      board.pointerLeave(event);
    },
    { target: viewportContainerRef }
  );

  useEventListener(
    'pointerup',
    (event) => {
      board.pointerUp(event);
    },
    { target: viewportContainerRef }
  );

  useEventListener(
    'dblclick',
    (event) => {
      if (PlaitBoard.isFocus(board) && !PlaitBoard.hasBeenTextEditing(board)) {
        board.dblClick(event);
      }
    },
    { target: hostRef }
  );

  useEventListener('pointermove', (event) => {
    BOARD_TO_MOVING_POINT.set(board, [event.x, event.y]);
    board.globalPointerMove(event);
  });

  useEventListener('pointerup', (event) => {
    board.globalPointerUp(event);
  });

  useEventListener('keydown', (event) => {
    board.globalKeyDown(event);
    if (
      PlaitBoard.isFocus(board) &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      !hasInputOrTextareaTarget(event.target)
    ) {
      board.keyDown(event);
    }
  });

  useEventListener('keyup', (event) => {
    if (PlaitBoard.isFocus(board) && !PlaitBoard.hasBeenTextEditing(board)) {
      board?.keyUp(event);
    }
  });

  useEventListener('copy', (event) => {
    if (
      PlaitBoard.isFocus(board) &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      !hasEditableTarget(event.target)
    ) {
      event.preventDefault();
      setFragment(
        board,
        WritableClipboardOperationType.copy,
        event.clipboardData
      );
    }
  });

  useEventListener('paste', async (clipboardEvent) => {
    if (
      PlaitBoard.isFocus(board) &&
      !PlaitBoard.isReadonly(board) &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      !hasEditableTarget(clipboardEvent.target)
    ) {
      const mousePoint = PlaitBoard.getMovingPointInBoard(board);
      if (mousePoint) {
        const targetPoint = toViewBoxPoint(
          board,
          toHostPoint(board, mousePoint[0], mousePoint[1])
        );
        const clipboardData = await getClipboardData(
          clipboardEvent.clipboardData
        );
        board.insertFragment(
          clipboardData,
          targetPoint,
          WritableClipboardOperationType.paste
        );
      }
    }
  });

  useEventListener('cut', (event) => {
    if (
      PlaitBoard.isFocus(board) &&
      !PlaitBoard.isReadonly(board) &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      !hasEditableTarget(event.target)
    ) {
      event.preventDefault();
      setFragment(
        board,
        WritableClipboardOperationType.cut,
        event.clipboardData
      );
      deleteFragment(board);
    }
  });

  useEventListener(
    'drop',
    (event) => {
      if (!PlaitBoard.isReadonly(board)) {
        event.preventDefault();
        board.drop(event);
      }
    },
    { target: viewportContainerRef }
  );

  useEventListener(
    'dragover',
    (event) => {
      event.preventDefault();
    },
    { target: viewportContainerRef }
  );
};

export default useBoardPluginEvent;
