import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
// jsdom has no layout engine; behavioral geometry is checked in browser tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
afterEach(cleanup);
