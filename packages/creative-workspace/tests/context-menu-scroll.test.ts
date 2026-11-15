import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenu } from '../upstream/packages/drawnix/src/components/shared/ContextMenu';
afterEach(cleanup);
const state = { x: 20, y: 20, payload: 'synthetic' };
const items = [{ key: 'one', label: 'Action' }];
it('keeps existing menus dismissing on scroll by default', () => {
  const close = vi.fn();
  render(React.createElement(ContextMenu, { state, items, onClose: close }));
  fireEvent.scroll(document);
  expect(close).toHaveBeenCalledOnce();
});
it('ignores layout scroll only when opted in; closes on deliberate wheel and touch scrolling', () => {
  const close = vi.fn();
  render(React.createElement(ContextMenu, { state, items, onClose: close, closeOnScroll: false }));
  fireEvent.scroll(document);
  expect(close).not.toHaveBeenCalled();
  fireEvent.wheel(document, { deltaY: 40 });
  fireEvent.touchMove(document);
  expect(close).toHaveBeenCalledTimes(2);
});
it('removes alternative dismissal listeners on unmount', () => {
  const close = vi.fn();
  const view = render(React.createElement(ContextMenu, { state, items, onClose: close, closeOnScroll: false }));
  view.unmount();
  fireEvent.wheel(document);
  fireEvent.touchMove(document);
  expect(close).not.toHaveBeenCalled();
});
