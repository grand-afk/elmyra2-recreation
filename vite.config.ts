import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from GitHub Pages at /elmyra2-recreation/
export default defineConfig({
  base: process.env.PAGES_BASE ?? '/elmyra2-recreation/',
  plugins: [react()],
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
