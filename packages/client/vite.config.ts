import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** The short commit the game is built from: Coolify passes it in, a local build asks git. */
function buildCommit(): string {
  const given = process.env.SOURCE_COMMIT;
  if (given && given !== 'local') return given.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; }
}

// `--mode single` bundles the whole game into one HTML file that can be opened or shared directly.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  build: {
    outDir: mode === 'single' ? '../../dist/single' : '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
}));
