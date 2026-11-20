'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'verdant-cache', 'mock_profile']);

function collectJsFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectJsFiles(full, out);
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      out.push(full);
    }
  }
}

const files = [];
collectJsFiles(ROOT, files);

let failures = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures++;
    const rel = path.relative(ROOT, file);
    console.error('[FAIL] ' + rel);
    if (err.stderr) console.error(String(err.stderr).trim());
  }
}

console.log('files=' + files.length + ' failures=' + failures);
if (failures > 0) process.exit(1);
