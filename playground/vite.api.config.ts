import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22', outDir: 'dist-api', emptyOutDir: true, minify: false,
    lib: { entry: { api: 'src/api/index.ts', cli: 'src/api/cli.js' }, formats: ['es'] },
    rollupOptions: {
      external: ['node:fs', 'node:process'],
      output: { entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
