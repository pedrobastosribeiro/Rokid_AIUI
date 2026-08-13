#!/usr/bin/env node
// Repository checks that run on pull requests.
//
// Everything here is deliberately dependency-free: the repo ships no lockfile
// for tooling and no test framework, so these run on a bare Node install.
//
// Usage:
//   node scripts/ci/validate.mjs            # every check
//   node scripts/ci/validate.mjs json links # only the named checks

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: the latter keeps percent-encoding, so a
// checkout under a path with a space resolves to a directory that is not there.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function tracked(...patterns) {
  const out = execSync(`git ls-files -z -- ${patterns.map((p) => `'${p}'`).join(' ')}`, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

const read = (file) => readFileSync(join(REPO_ROOT, file), 'utf8');
const exists = (file) => existsSync(join(REPO_ROOT, file));

// Third-party code is shipped as-is and is not ours to lint.
const isVendored = (file) => file.split(sep).includes('vendor');

// ---------------------------------------------------------------------------

// `.js` is CommonJS or ESM depending on the nearest package.json, so the parse
// goal has to be resolved per file rather than assumed repo-wide.
const typeCache = new Map();
function moduleType(file) {
  let dir = dirname(file);
  for (;;) {
    if (!typeCache.has(dir)) {
      const manifest = dir === '.' ? 'package.json' : `${dir}/package.json`;
      let type = null;
      if (exists(manifest)) {
        try {
          type = JSON.parse(read(manifest)).type || 'commonjs';
        } catch {
          type = null; // A malformed manifest is the json check's problem.
        }
      }
      typeCache.set(dir, type);
    }
    const found = typeCache.get(dir);
    if (found) return found;
    if (dir === '.') return 'commonjs';
    dir = dirname(dir);
  }
}

const SCRATCH = mkdtempSync(join(tmpdir(), 'aiui-ci-'));
let scratchSeq = 0;

function syntaxError(source, ext) {
  const probe = join(SCRATCH, `probe${scratchSeq++}${ext}`);
  writeFileSync(probe, source);
  try {
    execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' });
    return null;
  } catch (error) {
    const stderr = String(error.stderr || '');
    const line = stderr.split('\n').find((l) => /SyntaxError/.test(l));
    return (line || stderr.split('\n')[0] || 'syntax error').trim();
  }
}

// ---------------------------------------------------------------------------

const checks = {
  // Every tracked JSON file parses, plus the JSON embedded in `.ink` files.
  // Catches the hand-edited app.json / index.json / toc.json that the
  // framework loads at runtime.
  json(fail, note) {
    const files = tracked('*.json').filter((f) => f !== 'package-lock.json');
    for (const file of files) {
      try {
        JSON.parse(read(file));
      } catch (error) {
        fail(`${file}: ${error.message}`);
      }
    }

    // An `.ink` page carries its page config in a `<script def>` block. That
    // JSON never reaches a .json file, so nothing above would look at it, yet
    // it holds runtime config such as usingComponents.
    const inkFiles = tracked('*.ink');
    let defBlocks = 0;
    for (const file of inkFiles) {
      const text = read(file);
      const open = text.match(/<script\b[^>]*\bdef\b[^>]*>/);
      if (!open) continue; // A def block is optional.
      const body = text.slice(open.index + open[0].length);
      const end = body.indexOf('</script>');
      if (end === -1) {
        fail(`${file}: <script def> is never closed`);
        continue;
      }
      defBlocks += 1;
      try {
        JSON.parse(body.slice(0, end));
      } catch (error) {
        fail(`${file}: <script def> block: ${error.message}`);
      }
    }

    note(`parsed ${files.length} json files and ${defBlocks} <script def> blocks`);
  },

  // Script sources parse. This is a syntax check only -- it does not resolve
  // imports or type-check.
  syntax(fail, note) {
    let checked = 0;

    for (const file of tracked('*.js', '*.mjs', '*.cjs')) {
      if (isVendored(file)) continue;
      const ext = extname(file);
      const goal =
        ext === '.mjs' ? '.mjs' : ext === '.cjs' ? '.cjs' : moduleType(file) === 'module' ? '.mjs' : '.cjs';
      const error = syntaxError(read(file), goal);
      if (error) fail(`${file} (as ${goal === '.mjs' ? 'esm' : 'commonjs'}): ${error}`);
      checked += 1;
    }

    // `.ink` single-file components keep their logic in a <script setup> block.
    let skippedTs = 0;
    for (const file of tracked('*.ink')) {
      const text = read(file);
      const open = text.match(/<script\s+setup[^>]*>/);
      if (!open) {
        fail(`${file}: no <script setup> block`);
        continue;
      }
      if (/lang=["']ts["']/.test(open[0])) {
        skippedTs += 1;
        continue;
      }
      const body = text.slice(open.index + open[0].length);
      const end = body.indexOf('</script>');
      if (end === -1) {
        fail(`${file}: <script setup> is never closed`);
        continue;
      }
      const error = syntaxError(body.slice(0, end), '.mjs');
      if (error) fail(`${file}: ${error}`);
      checked += 1;
    }

    const tsCount = tracked('*.ts').length;
    note(`checked ${checked} scripts`);
    // Say what was not covered, so a green run is not read as "everything".
    if (skippedTs || tsCount) {
      note(`skipped ${tsCount} .ts files and ${skippedTs} typescript <script setup> blocks (no compiler available)`);
    }
  },

  // Every page and component an app.json declares resolves to a *complete*
  // file set. Bad paths here fail at runtime on the device, not at pack time.
  //
  // A route is satisfied two ways (documentation/0-guide/structure.en-US.md):
  // one `.ink` single-file component, or the multi-file form, where the logic
  // file alone renders nothing without its `.wxml` structure.
  samples(fail, note) {
    const LOGIC_EXT = ['.js', '.ts'];
    const manifests = tracked('samples/*/app.json', 'packages/*/template/app.json');
    let entries = 0;

    const unresolved = (root, route) => {
      if (exists(`${root}/${route}.ink`)) return null;
      const logic = LOGIC_EXT.find((ext) => exists(`${root}/${route}${ext}`));
      if (!logic) return `resolves to no .ink${LOGIC_EXT.map((e) => ` / ${e}`).join('')} file`;
      if (!exists(`${root}/${route}.wxml`)) {
        return `has ${route}${logic} but no ${route}.wxml to render`;
      }
      return null;
    };

    for (const manifest of manifests) {
      const root = dirname(manifest);
      let config;
      try {
        config = JSON.parse(read(manifest));
      } catch {
        continue; // Reported by the json check.
      }

      for (const page of config.pages || []) {
        entries += 1;
        const problem = unresolved(root, page);
        if (problem) fail(`${manifest}: page "${page}" ${problem}`);
      }

      for (const [name, path] of Object.entries(config.usingComponents || {})) {
        entries += 1;
        const problem = unresolved(root, path);
        if (problem) fail(`${manifest}: component "${name}" -> "${path}" ${problem}`);
      }
    }

    note(`resolved ${entries} page and component paths across ${manifests.length} apps`);
  },

  // Relative markdown links and images point at something that exists.
  // Extensionless links are site routes, so the doc extensions are tried too.
  links(fail, note) {
    // Two destination forms: bare, and angle-bracketed -- the latter is the
    // only way to write a destination containing spaces, so it cannot be
    // skipped as if it were markup.
    const LINK = /!?\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;
    const candidates = (target) => [
      target,
      `${target}.md`,
      `${target}.en-US.md`,
      `${target}/index.md`,
      `${target}/index.en-US.md`,
    ];
    const files = tracked('*.md');
    let links = 0;

    for (const file of files) {
      const base = dirname(file);
      for (const match of read(file).matchAll(LINK)) {
        const raw = match[1] !== undefined ? match[1] : match[2];
        if (!raw) continue;
        // Skip external URLs, anchors, and site-absolute routes -- the last
        // are resolved by the docs site, not by the filesystem.
        if (/^(https?:|mailto:|tel:|data:|#)/.test(raw) || raw.startsWith('/')) continue;

        let target;
        try {
          target = decodeURIComponent(raw.split('#')[0]);
        } catch {
          target = raw.split('#')[0];
        }
        if (!target) continue;

        links += 1;
        if (!candidates(target).some((c) => existsSync(resolve(REPO_ROOT, base, c)))) {
          fail(`${file}: "${raw}" matches no file`);
        }
      }
    }

    note(`resolved ${links} relative links across ${files.length} markdown files`);
  },
};

// ---------------------------------------------------------------------------

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !(name in checks));
if (unknown.length) {
  console.error(`Unknown check(s): ${unknown.join(', ')}`);
  console.error(`Available: ${Object.keys(checks).join(', ')}`);
  process.exit(2);
}

const selected = requested.length ? requested : Object.keys(checks);
let failed = 0;

for (const name of selected) {
  const failures = [];
  const notes = [];
  checks[name]((message) => failures.push(message), (message) => notes.push(message));

  if (failures.length) {
    failed += failures.length;
    console.log(`FAIL ${name} (${failures.length})`);
    for (const failure of failures) console.log(`  ${failure}`);
  } else {
    console.log(`ok   ${name}`);
  }
  for (const note of notes) console.log(`     ${note}`);
}

if (failed) {
  console.log(`\n${failed} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
