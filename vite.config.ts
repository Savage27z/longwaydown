import { defineConfig } from 'vitest/config';
import { devShots } from './scripts/dev-shots.mjs';

export default defineConfig({
  plugins: [devShots()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 5000,
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
