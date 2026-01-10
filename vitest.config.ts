import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
  },
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@brawltome/database': path.resolve(
        __dirname,
        'libs/database/src/index.ts'
      ),
      '@brawltome/bhapi-client': path.resolve(
        __dirname,
        'libs/bhapi-client/src/index.ts'
      ),
      '@brawltome/shared-utils': path.resolve(
        __dirname,
        'libs/shared-utils/src/index.ts'
      ),
      '@brawltome/shared-types': path.resolve(
        __dirname,
        'libs/shared-types/src/index.ts'
      ),
      '@brawltome/ui': path.resolve(__dirname, 'libs/ui/src/index.ts'),
    },
  },
});
