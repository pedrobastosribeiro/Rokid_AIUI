#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aixCli = '@yodaos-pkg/aix-cli@0.8.2';
let failed = 0;

function pass(label) {
  console.log(`ok  ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`not ok  ${label}`);
  if (detail) {
    console.error(`      ${String(detail).replace(/\n/g, '\n      ')}`);
  }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function checkJsSyntax(relativePath) {
  const result = run(process.execPath, ['--check', join(root, relativePath)]);
  if (result.status === 0) {
    pass(`syntax ${relativePath}`);
    return;
  }
  fail(`syntax ${relativePath}`, result.stderr || result.stdout);
}

function checkJson(relativePath) {
  try {
    JSON.parse(read(relativePath));
    pass(`json ${relativePath}`);
  } catch (error) {
    fail(`json ${relativePath}`, error);
  }
}

function extractInkBlocks(source) {
  const jsonMatch = source.match(
    /<script type="application\/json" def>\s*([\s\S]*?)<\/script>/,
  );
  const setupMatch = source.match(/<script setup>\s*([\s\S]*?)<\/script>/);
  return {
    json: jsonMatch ? jsonMatch[1] : '',
    setup: setupMatch ? setupMatch[1] : '',
  };
}

function checkInk(relativePath) {
  const source = read(relativePath);
  const { json, setup } = extractInkBlocks(source);
  if (!json || !setup) {
    fail(`ink blocks ${relativePath}`, 'missing def JSON or script setup');
    return;
  }

  try {
    const def = JSON.parse(json);
    if (!def.navigationBarTitleText || !def.description) {
      fail(`ink def ${relativePath}`, 'missing title or description');
    } else {
      pass(`ink def ${relativePath}`);
    }
  } catch (error) {
    fail(`ink def ${relativePath}`, error);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'aiui-ink-'));
  const setupFile = join(tempDir, 'setup.mjs');
  writeFileSync(setupFile, setup);
  const result = run(process.execPath, ['--check', setupFile]);
  if (result.status === 0) {
    pass(`ink setup ${relativePath}`);
  } else {
    fail(`ink setup ${relativePath}`, result.stderr || result.stdout);
  }
}

function checkRequiredFiles() {
  const app = JSON.parse(read('samples/pt-br/app.json'));
  const required = ['samples/pt-br/AGENTS.md', 'samples/pt-br/app.js', 'samples/pt-br/lib/locale.js'];
  for (const page of app.pages || []) {
    required.push(`samples/pt-br/${page}.ink`);
  }
  for (const file of required) {
    try {
      read(file);
      pass(`exists ${file}`);
    } catch (error) {
      fail(`exists ${file}`, error);
    }
  }
}

function checkPtBrInvariants() {
  const ink = read('samples/pt-br/pages/index/index.ink');
  const locale = read('samples/pt-br/lib/locale.js');
  const agents = read('samples/pt-br/AGENTS.md');
  const checks = [
    ['locale TARGET_LOCALE', /export const TARGET_LOCALE = 'pt-BR'/.test(locale)],
    ['ink pins ASR to the target locale', /recognition\.lang = TARGET_LOCALE/.test(ink)],
    ['ink pins TTS to the target locale', /utterance\.lang = TARGET_LOCALE/.test(ink)],
    ['ink starts listening on load', /this\.initializing = false;[\s\S]*this\.startTalk\(\);/.test(ink)],
    ['ink maps ASR failures', /getAsrFailureMessage\(/.test(ink)],
    ['ink guards unload', /this\.pageActive = false/.test(ink)],
    ['agents.md is the glasses voice', /voz dos óculos Rokid/.test(agents)],
  ];
  for (const [label, ok] of checks) {
    if (ok) {
      pass(label);
    } else {
      fail(label, 'invariant not found');
    }
  }
}

function checkDocs() {
  for (const file of [
    'documentation/0-guide/basic/ai/locale.md',
    'documentation/0-guide/basic/ai/locale.en-US.md',
  ]) {
    const source = read(file);
    if (!source.includes('../../../../samples/pt-br')) {
      fail(`docs link ${file}`, 'missing repository-relative samples/pt-br link');
    } else {
      pass(`docs link ${file}`);
    }
    if (/github\.com\/.+\/cursor\//.test(source)) {
      fail(`docs link ${file}`, 'points at a review-branch URL');
    }
  }
}

function checkWhitespace(relativePaths) {
  for (const relativePath of relativePaths) {
    const lines = read(relativePath).split('\n');
    const bad = [];
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) {
        bad.push(index + 1);
      }
    });
    if (bad.length) {
      fail(`whitespace ${relativePath}`, `trailing space on lines ${bad.join(', ')}`);
    } else {
      pass(`whitespace ${relativePath}`);
    }
  }
}

function packPtBrSample() {
  const output = join(tmpdir(), `pt-br-${Date.now()}.aix`);
  const pack = run('npx', [
    '--yes',
    aixCli,
    'pack',
    './samples/pt-br',
    '-o',
    output,
    '--engine',
    '^0.14.0',
  ]);
  if (pack.status !== 0) {
    fail('aix pack samples/pt-br', pack.stderr || pack.stdout);
    return;
  }
  pass('aix pack samples/pt-br');

  const list = run('npx', ['--yes', aixCli, 'list', output]);
  if (list.status !== 0) {
    fail('aix list pt-br.aix', list.stderr || list.stdout);
    return;
  }
  const required = [
    'AGENTS.md',
    'VERSION',
    'app.js',
    'app.json',
    'lib/locale.js',
    'pages/index/index.ink',
  ];
  const missing = required.filter((name) => !list.stdout.includes(name));
  if (missing.length) {
    fail('aix list contents', `missing ${missing.join(', ')}\n${list.stdout}`);
    return;
  }
  pass('aix list contents');
}

checkJsSyntax('samples/pt-br/lib/locale.js');
checkJsSyntax('samples/pt-br/app.js');
checkJsSyntax('packages/create-aiui-agent/index.js');
checkJson('samples/pt-br/app.json');
checkJson('documentation/toc.json');
checkJson('documentation/toc.en-US.json');
checkInk('samples/pt-br/pages/index/index.ink');
checkRequiredFiles();
checkPtBrInvariants();
checkDocs();
checkWhitespace([
  'samples/pt-br/lib/locale.js',
  'samples/pt-br/pages/index/index.ink',
  'samples/pt-br/app.js',
  'samples/pt-br/app.json',
  'samples/pt-br/AGENTS.md',
  'documentation/0-guide/basic/ai/locale.md',
  'documentation/0-guide/basic/ai/locale.en-US.md',
]);
packPtBrSample();

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log('\nall checks passed');
