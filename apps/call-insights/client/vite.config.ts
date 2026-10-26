import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  // AppKit serves the client in middleware mode. `pnpm dev:sample` runs Vite on its
  // own with VITE_DATA_SOURCE=fixtures, so the UI works offline with sample data.
  server:
    process.env.VITE_DATA_SOURCE === 'fixtures'
      ? { host: '127.0.0.1', port: 5174, strictPort: true }
      : { middlewareMode: true },
  build: {
    outDir: path.resolve(__dirname, './dist'),
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === 'development',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-dev-runtime', 'react/jsx-runtime'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
