import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

async function main() {
  fs.mkdirSync(DIST, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'edge120'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    sourcemap: false,
    outfile: path.join(DIST, 'app.js'),
    logLevel: 'info'
  });
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
  console.log('Built polaplayer-ui/web -> ' + DIST);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
