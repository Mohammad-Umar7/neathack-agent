import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /neathack-agent/.
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
