#!/usr/bin/env node
/**
 * House style check for copy and docs. Fails (exit 1) on characters that read as machine
 * written or break our plain style: em and en dashes, emoji, curly quotes and the ellipsis
 * character. Run from the repo root:  node scripts/copy-lint.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGETS = [
  'apps/app/src',
  'apps/api/src',
  'apps/worker/src',
  'packages',
  'docs',
  'README.md',
  'PLAN.md',
  'apps/app/README.md',
  'apps/app/DESIGN.md',
  'apps/app/PRODUCT.md',
];
const EXTS = new Set(['.ts', '.tsx', '.md', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated', '.expo', 'assets']);

// Built from character codes so this file never contains the characters it bans.
const chars = (...codes) => new RegExp(`[${String.fromCharCode(...codes)}]`, 'g');
const RULES = [
  { name: 'em dash', re: chars(0x2014), hint: 'use a comma, colon or full stop' },
  { name: 'en dash', re: chars(0x2013), hint: 'use "to" for ranges, a hyphen otherwise' },
  { name: 'curly quote', re: chars(0x2018, 0x2019, 0x201c, 0x201d), hint: 'use straight quotes \' and "' },
  { name: 'ellipsis character', re: chars(0x2026), hint: 'use three dots' },
  {
    name: 'emoji',
    re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]|\u{FE0F}/gu,
    hint: 'remove it, use an Icon in UI',
  },
];

function* walk(path) {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (EXTS.has(extname(path))) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(path, name));
  }
}

let problems = 0;
for (const target of TARGETS) {
  for (const file of walk(join(ROOT, target))) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        if (rule.re.test(line)) {
          problems++;
          console.log(`${relative(ROOT, file)}:${i + 1}  ${rule.name} (${rule.hint})`);
        }
      }
    });
  }
}

if (problems) {
  console.log(`\n${problems} copy problem${problems === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log('Copy check passed.');
