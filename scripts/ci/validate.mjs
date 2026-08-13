#!/usr/bin/env node
// Repository checks that run on pull requests.
//
// Everything here is deliberately dependency-free: the repo ships no lockfile
// for tooling and no test framework, so these run on a bare Node install.
//
// Usage:
//   node scripts/ci/validate.mjs            # every check
//   node scripts/ci/validate.mjs json links # only the named checks

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: the latter keeps percent-encoding, so a
// checkout under a path with a space resolves to a directory that is not there.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// execFileSync, not a shell string: pathspecs like *.json would need quoting to
// survive a POSIX shell, and those quotes are literal characters to cmd.exe, so
// on Windows git would match nothing and every check would pass over zero files.
function tracked(...patterns) {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...patterns], {
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

// An `.ink` page or component keeps its config in a `<script def>` block, so
// that JSON never reaches a .json file. Returns null when there is no block;
// otherwise `config` is null if it is malformed and `error` says why.
function readInkDef(file) {
  const text = read(file);
  const open = text.match(/<script\b[^>]*\bdef\b[^>]*>/);
  if (!open) {
    return null;
  }
  const body = text.slice(open.index + open[0].length);
  const end = body.indexOf('</script>');
  if (end === -1) {
    return { config: null, error: new Error('<script def> is never closed') };
  }
  try {
    return { config: JSON.parse(body.slice(0, end)), error: null };
  } catch (error) {
    return { config: null, error };
  }
}

// The app root is the nearest ancestor holding an app.json. Component paths in
// a page config resolve from there, not from the page's own directory.
function appRootFor(file) {
  let dir = dirname(file);
  for (;;) {
    if (exists(`${dir}/app.json`)) {
      return dir;
    }
    if (dir === '.' || dir === sep || dir === '') {
      return null;
    }
    dir = dirname(dir);
  }
}

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
    // package-lock.json is included: a conflicted merge can leave it malformed,
    // and every `npm ci` downstream fails before anything else gets a chance.
    const files = tracked('*.json');
    for (const file of files) {
      try {
        JSON.parse(read(file));
      } catch (error) {
        fail(`${file}: ${error.message}`);
      }
    }

    let defBlocks = 0;
    for (const file of tracked('*.ink')) {
      const def = readInkDef(file);
      if (!def) continue; // A def block is optional.
      defBlocks += 1;
      if (def.error) {
        fail(`${file}: <script def> block: ${def.error.message}`);
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

    // A host package, not a path in this repo.
    const isPackageSpecifier = (path) => path.startsWith('@');

    const checkComponents = (source, root, usingComponents) => {
      for (const [name, path] of Object.entries(usingComponents || {})) {
        if (isPackageSpecifier(path)) continue;
        entries += 1;
        const problem = unresolved(root, path);
        if (problem) fail(`${source}: component "${name}" -> "${path}" ${problem}`);
      }
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

      checkComponents(manifest, root, config.usingComponents);
    }

    // usingComponents is not only an app-level key: a page or a component can
    // declare its own, in an `.ink` def block or a sibling index.json. Those
    // paths resolve from the app root too, and nothing above would see them.
    let pageConfigs = 0;
    for (const file of tracked('samples/**/*.ink', 'packages/*/template/**/*.ink')) {
      const def = readInkDef(file);
      if (!def || !def.config) continue; // Missing or malformed: the json check has it.
      const root = appRootFor(file);
      if (!root) continue;
      pageConfigs += 1;
      checkComponents(file, root, def.config.usingComponents);
    }

    for (const file of tracked('samples/**/index.json', 'packages/*/template/**/index.json')) {
      let config;
      try {
        config = JSON.parse(read(file));
      } catch {
        continue; // Reported by the json check.
      }
      const root = appRootFor(file);
      if (!root) continue;
      pageConfigs += 1;
      checkComponents(file, root, config.usingComponents);
    }

    note(
      `resolved ${entries} page and component paths across ` +
        `${manifests.length} apps and ${pageConfigs} page configs`,
    );
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
