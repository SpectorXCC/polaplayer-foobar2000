'use strict';

const fs = require('fs');
const path = require('path');

const SUITES_DIR = path.join(__dirname, 'suites');
const files = fs.readdirSync(SUITES_DIR)
  .filter(f => f.endsWith('.test.js'))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('No test suites found in ' + SUITES_DIR);
  process.exit(1);
}

for (const f of files) {
  console.log('=== Suite: ' + f + ' ===');
  const mod = require(path.join(SUITES_DIR, f));
  if (typeof mod.run !== 'function') {
    throw new Error('Test suite ' + f + ' must export a run() function');
  }
  mod.run();
}

console.log('ALL TESTS PASSED!');
