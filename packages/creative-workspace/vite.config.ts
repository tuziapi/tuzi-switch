import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import selectorParser from 'postcss-selector-parser';
import path from 'node:path';

const source = path.resolve(__dirname, 'upstream');
// Keep all creative styles within the host workspace container.
function scopeStyles() {
  return {
    postcssPlugin: 'assistant-creative-scope',
    OnceExit(root: any) {
      const scope = 'creative-root';
      // Flatten already-compiled Tailwind 4 layers before the host Tailwind 3 pass.
      root.walkAtRules("layer", (rule: any) => {
        if (rule.nodes) rule.replaceWith(...rule.nodes); else rule.remove();
      });
      root.walkRules((rule: any) => {
        for (let parent = rule.parent; parent; parent = parent.parent) {
          if (parent.type === 'rule' || /keyframes$/.test(parent.name || '')) return;
        }
        rule.selector = selectorParser(selectors => {
          selectors.each(selector => {
            let scoped = false;
            selector.each(node => {
              if ((node.type === 'pseudo' && [':root', ':host'].includes(node.value)) ||
                (node.type === 'tag' && ['html', 'body'].includes(node.value))) {
                node.replaceWith(selectorParser.className({ value: scope }));
                scoped = true;
              }
            });
            if (!scoped && !selector.toString().trimStart().startsWith(`.${scope}`)) {
              selector.prepend(selectorParser.combinator({ value: ' ' }));
              selector.prepend(selectorParser.className({ value: scope }));
            }
          });
        }).processSync(rule.selector);
      });
    },
  };
}

export default defineConfig({
  base: "./",
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
  css: {
    postcss: { plugins: [tailwind(), scopeStyles()] },
    preprocessorOptions: { scss: { silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'], loadPaths: [path.resolve(__dirname, 'node_modules')] } },
  },
  define: {
    "import.meta.env.VITE_TUZI_ASSISTANT": JSON.stringify("true"),
    __APP_VERSION__: JSON.stringify('1.4.2-creative-preview'),
    __OPENTU_DESKTOP_CHANNEL_PROOF__: JSON.stringify('assistant-local-preview'),
    'import.meta.env.VITE_OPENTU_DESKTOP': JSON.stringify('false'),
    'import.meta.env.VITE_TUZI_EMBEDDED_MODE': JSON.stringify('false'),
    'import.meta.env.VITE_OPENTU_SIGNED_UPDATER': JSON.stringify('false'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  worker: { format: 'es' },
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: () => 'creative.js', cssFileName: 'creative-workspace' },
    rollupOptions: { external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/] },
    commonjsOptions: { transformMixedEsModules: true },
    sourcemap: true,
    reportCompressedSize: false,
  },
});
