import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './ui'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // index.html stays empty until the main window has a page
      input: path.resolve(__dirname, 'overlay.html'),
    },
  },
})
