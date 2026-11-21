'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['views', 'ui', 'data'];
const TARGET_FILES = ['app.js'];

function isCjkCode(cp) {
  return (cp >= 0x3000 && cp <= 0x303F) ||
         (cp >= 0x3400 && cp <= 0x4DBF) ||
         (cp >= 0x4E00 && cp <= 0x9FFF) ||
         (cp >= 0xFF00 && cp <= 0xFFEF);
}

function findCjkInString(str) {
  for (let i = 0; i < str.length; i++) {
    if (isCjkCode(str.charCodeAt(i))) return true;
  }
  return false;
}

function placeholdersOf(str) {
  const out = new Set();
  const re = /\{(\d+)\}/g;
  let m;
  while ((m = re.exec(str))) out.add(m[1]);
  return Array.from(out).sort();
}

function loadI18nTables() {
  const i18nPath = path.join(ROOT, 'core', 'i18n.js');
  const src = fs.readFileSync(i18nPath, 'utf8');
  const sandbox = {
    LANGUAGE_MODE: 'en',
    ActiveXObject: function () {
      return { RegRead() { return 'en-US'; } };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'core/i18n.js' });
  return sandbox.LANGS;
}

const REGEX_PREV_KEYWORDS = new Set([
  'return', 'throw', 'case', 'delete', 'void', 'typeof', 'instanceof', 'in', 'new', 'else', 'do'
]);

const REGEX_PREV_CHARS = new Set(['(', '[', '{', ',', ';', ':', '!', '&', '|', '?', '=', '+', '-', '*', '%', '^', '~', '<', '>']);

// Tokenize just enough JS syntax to skip comments & regex literals and extract string literals + T('key') calls.
function scanJsFile(src) {
  const strings = [];
  const tCalls = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let canStartRegex = true;
  let prevIdent = '';
  let recentCall = ''; // tracks 'T' followed by '('

  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }

    // Line comment
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // String literal
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      const startLine = line;
      let raw = quote;
      i++;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) {
          raw += c + src[i + 1];
          if (src[i + 1] === '\n') line++;
          i += 2;
          continue;
        }
        if (c === '\n') { line++; raw += c; i++; break; }
        raw += c;
        i++;
        if (c === quote) break;
      }
      let value = '';
      try {
        value = vm.runInNewContext(raw);
      } catch (e) {
        value = raw.slice(1, -1);
      }
      strings.push({ line: startLine, raw, value: String(value) });
      if (recentCall === 'T(') {
        tCalls.push({ line: startLine, key: String(value) });
        recentCall = '';
      }
      canStartRegex = false;
      prevIdent = '';
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex) {
      i++;
      let inClass = false;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
        else if (c === '\n') { line++; i++; break; }
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++;
      canStartRegex = false;
      prevIdent = '';
      recentCall = '';
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_$]/.test(ch)) {
      let id = ch;
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) { id += src[i]; i++; }
      prevIdent = id;
      recentCall = (id === 'T') ? 'T' : '';
      canStartRegex = REGEX_PREV_KEYWORDS.has(id);
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++;
      canStartRegex = false;
      prevIdent = '';
      recentCall = '';
      continue;
    }

    // Punctuators
    if (ch === '(' && recentCall === 'T') recentCall = 'T(';
    else if (recentCall === 'T(' && (ch === ',' || ch === ')')) recentCall = '';
    else recentCall = '';

    prevIdent = '';
    if (ch === ')' || ch === ']') canStartRegex = false;
    else canStartRegex = REGEX_PREV_CHARS.has(ch);
    i++;
  }

  return { strings, tCalls };
}

function collectRuntimeFiles() {
  const out = [];
  for (const dir of TARGET_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.js')) out.push(path.join(abs, ent.name));
    }
  }
  for (const f of TARGET_FILES) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) out.push(abs);
  }
  return out;
}

function main() {
  let failures = 0;
  function fail(msg) {
    failures++;
    console.error('[FAIL] ' + msg);
  }

  // JSplitter may read BOM-less include() scripts through the Windows ANSI code page.
  // Keep the translation dictionary ASCII on disk; Unicode escapes decode identically in JS.
  const dictionary = fs.readFileSync(path.join(ROOT, 'core', 'i18n.js'), 'utf8');
  dictionary.split(/\r?\n/).forEach((line, i) => {
    if (/[^\x00-\x7f]/.test(line)) fail('core/i18n.js:' + (i + 1) + ': use Unicode escapes instead of raw non-ASCII characters');
  });

  const langs = loadI18nTables();
  if (!langs || !langs.en || !langs['zh-CN']) {
    fail('core/i18n.js must define LANGS["en"] and LANGS["zh-CN"]');
    process.exit(1);
  }

  const enKeys = Object.keys(langs.en).sort();
  const zhKeys = Object.keys(langs['zh-CN']).sort();
  const enSet = new Set(enKeys);
  const zhSet = new Set(zhKeys);

  for (const k of enKeys) {
    if (!zhSet.has(k)) fail('Missing key in LANGS["zh-CN"]: ' + k);
    if (typeof langs.en[k] !== 'string' || !langs.en[k].length) fail('Empty or non-string LANGS["en"] key: ' + k);
  }
  for (const k of zhKeys) {
    if (!enSet.has(k)) fail('Missing key in LANGS["en"]: ' + k);
    if (typeof langs['zh-CN'][k] !== 'string' || !langs['zh-CN'][k].length) fail('Empty or non-string LANGS["zh-CN"] key: ' + k);
  }
  for (const k of enKeys) {
    if (!zhSet.has(k)) continue;
    const pEn = placeholdersOf(langs.en[k]).join(',');
    const pZh = placeholdersOf(langs['zh-CN'][k]).join(',');
    if (pEn !== pZh) fail('Placeholder mismatch for key "' + k + '": en={' + pEn + '} vs zh-CN={' + pZh + '}');
  }

  const files = collectRuntimeFiles();
  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    const src = fs.readFileSync(abs, 'utf8');
    const { strings, tCalls } = scanJsFile(src);

    for (const st of strings) {
      if (findCjkInString(st.value)) {
        fail(rel + ':' + st.line + ': hardcoded CJK string literal outside core/i18n.js -> ' + st.raw);
      }
    }

    for (const tc of tCalls) {
      if (!enSet.has(tc.key) || !zhSet.has(tc.key)) {
        fail(rel + ':' + tc.line + ': unknown T(\'' + tc.key + '\') key');
      }
    }
  }

  console.log('i18n keys=' + enKeys.length + ' scannedFiles=' + files.length + ' failures=' + failures);
  if (failures > 0) process.exit(1);
}

main();
