import type { PlaitBoard } from "@plait/core";
export type BatchReservation = {
  x: number;
  y: number;
  width: number;
  height: number;
};
const reservations = new WeakMap<PlaitBoard, Set<BatchReservation>>();
export function getBatchReservations(board: PlaitBoard): BatchReservation[] {
  return [...(reservations.get(board) ?? [])];
}
export function reserveImageBatch(
  board: PlaitBoard,
  rect: BatchReservation,
): () => void {
  let entries = reservations.get(board);
  if (!entries) {
    entries = new Set();
    reservations.set(board, entries);
  }
  entries.add(rect);
  return () => {
    entries.delete(rect);
  };
}
