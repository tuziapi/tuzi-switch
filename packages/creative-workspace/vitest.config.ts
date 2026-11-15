import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const source = path.resolve(__dirname, 'upstream');
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@drawnix/drawnix/runtime', replacement: `${source}/packages/drawnix/src/runtime.ts` },
      { find: '@drawnix/drawnix', replacement: `${source}/packages/drawnix/src/index.ts` },
      { find: '@aitu/utils', replacement: `${source}/packages/utils/src/index.ts` },
      { find: '@plait-board/react-board', replacement: `${source}/packages/react-board/src/index.ts` },
      { find: '@plait-board/react-text', replacement: `${source}/packages/react-text/src/index.ts` },
      { find: /^tdesign-react$/, replacement: `${source}/packages/drawnix/src/utils/tdesign.ts` },
    ],
  },
  css: { postcss: { plugins: [] } },
  define: { __APP_VERSION__: JSON.stringify('1.5.0') },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['upstream/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.test.ts'],
    setupFiles: ['./test-setup.ts'],
    maxWorkers: 2,
    minWorkers: 1,
  },
});
