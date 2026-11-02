import { isWheelPointer, PlaitBoard } from '@plait/core';

export const isTemporaryHandMode = (board: PlaitBoard) => {
  return PlaitBoard.getBoardContainer(board).classList.contains(
    'viewport-moving'
  );
};

export const shouldDelegateToHandPointer = (
  board: PlaitBoard,
  event: PointerEvent
) => {
  return isTemporaryHandMode(board) || isWheelPointer(event);
};
