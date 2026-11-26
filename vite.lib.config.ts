import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The module the story game installs: React, GSAP and three come from the host.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    copyPublicDir: false, // the demo page's favicon stays out of the package
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'ember-runes' },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime', 'gsap', 'three'] },
  },
});
