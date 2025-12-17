import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
  },
  plugins: [swc.vite()],
});
