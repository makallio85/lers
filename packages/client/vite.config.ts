import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` bundles the whole game into one HTML file that can be opened or shared directly.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? '../../dist/single' : '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
}));
