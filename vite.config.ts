import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The demo page (index.html). The library build lives in vite.lib.config.ts.
export default defineConfig({
  plugins: [react()],
  base: './',
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
