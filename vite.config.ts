import { copyFileSync, cpSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const OUT_DIR = 'dist';
const OUT_FILE = 'gantt-planner.html';

/**
 * Renames dist/index.html to the deliverable name. When GANTT_COPY_TO is set
 * (e.g. in .env.local), also copies the HTML and docs/ to that folder.
 */
function finalizeOutput(copyTo: string | undefined): Plugin {
  return {
    name: 'gantt-planner:finalize-output',
    apply: 'build',
    closeBundle() {
      const built = resolve(OUT_DIR, OUT_FILE);
      renameSync(resolve(OUT_DIR, 'index.html'), built);
      if (!copyTo) return;
      try {
        copyFileSync(built, resolve(copyTo, OUT_FILE));
        cpSync('docs', resolve(copyTo, 'docs'), { recursive: true });
        console.log(`Copied ${OUT_FILE} and docs/ to ${copyTo}`);
      } catch (err) {
        console.warn(`Could not copy the build to ${copyTo}: ${String(err)}`);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), viteSingleFile(), finalizeOutput(env.GANTT_COPY_TO)],
    build: {
      outDir: OUT_DIR,
      // Inline everything (fonts included) so the HTML works offline via file://
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      modulePreload: { polyfill: false }, // nothing to preload in one file; keeps fetch() out of the bundle
    },
  };
});
