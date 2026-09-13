import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served from https://rafsunsheikh.github.io/prometheus/ — the base path has to
// match or every asset URL 404s on Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/prometheus/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
