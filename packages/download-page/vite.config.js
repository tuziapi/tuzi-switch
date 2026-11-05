import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', plugins: [react()], css: { postcss: { plugins: [] } }, build: { rollupOptions: { input: 'tuzi-switch.html' } } });
